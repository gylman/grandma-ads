import { checkContentSafety } from '../../domain/moderation';
import {
  createAgentEnsIdentities,
  createCampaignEnsEvent,
  createCampaignEnsIdentity,
  createCampaignEnsIdentityRecord,
  createOnchainAdEnsIdentity,
  createUserEnsIdentity,
  createUserEnsName,
  ensIdentityFromCampaignEvent,
} from '../../domain/ens';
import { CampaignStatus } from '../../domain/types';
import { verifyPostSnapshot } from '../../domain/verification';
import { resolveEnsCcipRead } from '../services/ensCcipService';
import { AgentGateway } from '../ports/agentGateway';
import { BlockchainGateway } from '../ports/blockchainGateway';
import { CampaignRepository, CreateDraftCampaignInput, SubmitPostInput } from '../ports/campaignRepository';
import { ChannelRepository, RegisterChannelInput } from '../ports/channelRepository';
import { DevWalletGateway } from '../ports/devWalletGateway';
import { DevWalletRepository } from '../ports/devWalletRepository';
import { UpsertUserInput, UserRepository } from '../ports/userRepository';

export type AppUseCases = ReturnType<typeof createAppUseCases>;

export function createAppUseCases(dependencies: {
  users: UserRepository;
  channels: ChannelRepository;
  campaigns: CampaignRepository;
  agent: AgentGateway;
  blockchain: BlockchainGateway;
  devWallets: DevWalletRepository;
  devWalletGateway: DevWalletGateway;
  tokenDecimalsByAddress?: Record<string, number>;
  usdcTokenAddress?: string;
  usdtTokenAddress?: string;
  daiTokenAddress?: string;
  wbtcTokenAddress?: string;
  escrowContractAddress: `0x${string}`;
  chainId: number;
  ensRootName: string;
  agentAddress?: string | null;
}) {
  const { users, channels, campaigns, agent, blockchain, devWallets, devWalletGateway } = dependencies;
  const tokenDecimalsByAddress = dependencies.tokenDecimalsByAddress ?? {};
  const ensRootName = dependencies.ensRootName;
  const verifierEnsName = `verifier.${ensRootName}`;
  const majorTokens = [
    { symbol: 'USDC', address: dependencies.usdcTokenAddress ?? '', decimals: 6 },
    { symbol: 'USDT', address: dependencies.usdtTokenAddress ?? '', decimals: 6 },
    { symbol: 'DAI', address: dependencies.daiTokenAddress ?? '', decimals: 18 },
    { symbol: 'WBTC', address: dependencies.wbtcTokenAddress ?? '', decimals: 8 },
  ];

  function resolveMajorTokenBySymbol(symbol: string) {
    const normalized = symbol.toUpperCase();
    const token = majorTokens.find((candidate) => candidate.symbol === normalized && /^0x[a-fA-F0-9]{40}$/.test(candidate.address));
    if (!token) return null;
    return {
      ...token,
      address: token.address as `0x${string}`,
    };
  }

  async function ensureDevWallet(telegramUserId: string, telegramUsername?: string | null) {
    const existing = await devWallets.findByTelegramUserId(telegramUserId);
    if (existing) {
      await ensureUserEnsIdentity({
        walletAddress: existing.address,
        telegramUserId,
        telegramUsername,
      });
      return existing;
    }

    const wallet = await devWallets.save(await devWalletGateway.createWallet(telegramUserId));
    await ensureUserEnsIdentity({
      walletAddress: wallet.address,
      telegramUserId,
      telegramUsername,
    });
    return wallet;
  }

  async function ensureUserEnsIdentity(input: UpsertUserInput) {
    const existing = input.telegramUserId ? await users.findByTelegramUserId(input.telegramUserId) : await users.findByWallet(input.walletAddress);
    const ensName =
      input.ensName ??
      existing?.ensName ??
      createUserEnsName({
        rootName: ensRootName,
        telegramUsername: input.telegramUsername ?? existing?.telegramUsername,
        walletAddress: input.walletAddress,
      });

    return users.upsert({
      ...input,
      telegramUsername: input.telegramUsername ?? existing?.telegramUsername ?? null,
      ensName,
    });
  }

  async function appendCampaignEnsEvent(
    campaignId: string,
    type: 'LOCKED' | 'STARTED' | 'COMPLETED' | 'REFUNDED' | 'VERIFIED',
    txHash: `0x${string}` | string | null,
    agentEnsName = verifierEnsName,
  ) {
    const campaign = await campaigns.findById(campaignId);
    if (!campaign) throw new Error('Campaign not found');

    const event = createCampaignEnsEvent({
      campaign,
      type,
      txHash,
      agentEnsName,
    });

    return campaigns.patch(campaign.id, {
      ensEvents: [...(campaign.ensEvents ?? []), event],
    });
  }

  async function collectEnsRecords() {
    const [allUsers, allCampaigns] = await Promise.all([users.list(), campaigns.list()]);
    return [
      ...createAgentEnsIdentities(ensRootName, dependencies.agentAddress ?? null),
      ...allUsers.map(createUserEnsIdentity).filter((record): record is NonNullable<typeof record> => record !== null),
      ...allCampaigns.flatMap((campaign) => [
        createCampaignEnsIdentityRecord(campaign),
        ...(campaign.ensEvents ?? []).map(ensIdentityFromCampaignEvent),
      ]).filter((record): record is NonNullable<typeof record> => record !== null),
    ];
  }

  async function fundDevCampaignFromBalance(telegramUserId: string, campaignId: string) {
    const wallet = await devWallets.findByTelegramUserId(telegramUserId);
    if (!wallet) throw new Error('No dev wallet exists yet. Use /dev_create_wallet first.');

    let campaign = await campaigns.findById(campaignId);
    if (!campaign) throw new Error('Campaign not found');
    if (campaign.advertiserUserId === pendingAdvertiserUserId(telegramUserId)) {
      const existingUser = await users.findByTelegramUserId(telegramUserId);
      const user = await ensureUserEnsIdentity({
        walletAddress: wallet.address,
        telegramUserId,
        telegramUsername: existingUser?.telegramUsername,
      });
      campaign = await campaigns.patch(campaign.id, {
        advertiserUserId: user.id,
        advertiserWalletAddress: wallet.address,
        advertiserEnsName: user.ensName,
      });
    }
    if (campaign.advertiserWalletAddress.toLowerCase() !== wallet.address.toLowerCase()) {
      throw new Error('Only the campaign advertiser can fund this campaign.');
    }
    if (!campaign.posterWalletAddress || !/^0x[a-fA-F0-9]{40}$/.test(campaign.posterWalletAddress)) {
      throw new Error('Campaign poster wallet is missing.');
    }

    const balances = await devWalletGateway.getMajorBalances(wallet);
    const tokenBalance = balances.find((balance) => balance.address?.toLowerCase() === campaign.tokenAddress.toLowerCase());
    if (!tokenBalance) {
      throw new Error('That campaign token is not configured on the server yet.');
    }

    const amount = parseTokenAmount(campaign.amount, tokenDecimalsByAddress[campaign.tokenAddress.toLowerCase()] ?? 6);
    const availableInEscrow = tokenBalance.escrowBalance ?? 0n;
    if (availableInEscrow < amount) {
      throw new Error(
        `You do not have enough available ${tokenBalance.symbol} in escrow for this campaign. Needed ${campaign.amount}, available ${formatTokenAmount(
          availableInEscrow,
          tokenBalance.decimals,
        )}. Deposit first, then try again.`,
      );
    }

    const authorizationMessage = formatCreateCampaignAuthorizationMessage(campaign, tokenBalance.symbol);

    let result;
    let signature: `0x${string}`;
    let nonce: bigint;
    let deadline: bigint;
    try {
      nonce = await blockchain.getCampaignNonce(wallet.address);
      deadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);
      const authorization = {
        advertiser: wallet.address,
        poster: campaign.posterWalletAddress as `0x${string}`,
        token: campaign.tokenAddress as `0x${string}`,
        amount,
        durationSeconds: BigInt(campaign.durationSeconds),
        nonce,
        deadline,
      };
      signature = await devWalletGateway.signCreateCampaignAuthorization(wallet, {
        verifyingContract: dependencies.escrowContractAddress,
        chainId: dependencies.chainId,
        authorization,
      });

      result = await blockchain.createCampaignFromBalanceBySig({
        advertiserWalletAddress: wallet.address,
        posterWalletAddress: campaign.posterWalletAddress as `0x${string}`,
        tokenAddress: campaign.tokenAddress as `0x${string}`,
        amount,
        durationSeconds: authorization.durationSeconds,
        nonce,
        deadline,
        signature,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('function "nonces" reverted') || message.includes('function "createCampaignFromBalanceBySig"')) {
        throw new Error('The deployed escrow contract is still the old version. Redeploy the contract, update ESCROW_CONTRACT_ADDRESS, and try again.');
      }
      if (message.includes('InsufficientBalance') || message.includes('0xf4d678b8')) {
        throw new Error(`You do not have enough available ${tokenBalance.symbol} in escrow for this campaign.`);
      }
      if (message.includes('InvalidSignature') || message.includes('SignatureExpired')) {
        throw new Error('I could not authorize that gasless campaign lock. Please try again.');
      }
      throw new Error('I could not relay the campaign funding on-chain. Please try again.');
    }

    let updated = campaign;
    if (updated.status === 'DRAFT') updated = await campaigns.advance(updated.id, 'AWAITING_FUNDS');
    if (updated.status === 'AWAITING_FUNDS') updated = await campaigns.advance(updated.id, 'FUNDED');
    const onchainIdentity = createOnchainAdEnsIdentity({
      rootName: ensRootName,
      onchainCampaignId: result.onchainCampaignId,
    });

    updated = await campaigns.patch(updated.id, {
      onchainCampaignId: result.onchainCampaignId.toString(),
      ensLabel: onchainIdentity.ensLabel,
      ensName: onchainIdentity.ensName,
    });
    updated = await appendCampaignEnsEvent(updated.id, 'LOCKED', result.txHash);

    return {
      campaign: updated,
      txHash: result.txHash,
      onchainCampaignId: result.onchainCampaignId,
      authorizationMessage,
      authorizationSignature: signature!,
      authorizationDeadline: deadline!,
      authorizationNonce: nonce!,
    };
  }

  return {
    health() {
      return { ok: true, service: 'grandma-ads-server' };
    },

    async upsertUser(input: UpsertUserInput) {
      return ensureUserEnsIdentity(input);
    },

    async getUserByWallet(walletAddress: string) {
      return users.findByWallet(walletAddress);
    },

    async getUserById(userId: string) {
      return users.findById(userId);
    },

    getBalance(walletAddress: string, tokenAddress?: string) {
      return blockchain.getBalance(walletAddress, tokenAddress);
    },

    async registerChannel(input: RegisterChannelInput) {
      return channels.register(input);
    },

    async listChannels(ownerUserId?: string) {
      return channels.list(ownerUserId);
    },

    async verifyChannel(channelId: string, postUrl?: string) {
      return channels.updateStatus(channelId, 'VERIFIED', postUrl);
    },

    async extractCampaignIntake(message: string) {
      return agent.analyzeCampaignRequest(message);
    },

    async createDraftCampaign(input: CreateDraftCampaignInput) {
      const safety = checkContentSafety(input.requestedText);
      if (!safety.allowed) {
        const error = new Error('Campaign content is blocked');
        error.name = 'ContentBlockedError';
        throw error;
      }

      const advertiser = await users.findById(input.advertiserUserId);
      const advertiserEnsName =
        input.advertiserEnsName ??
        advertiser?.ensName ??
        createUserEnsName({
          rootName: ensRootName,
          telegramUsername: advertiser?.telegramUsername,
          walletAddress: input.advertiserWalletAddress,
        });
      const identity = createCampaignEnsIdentity({
        rootName: ensRootName,
        userEnsName: advertiserEnsName,
        telegramUsername: advertiser?.telegramUsername,
      });

      return campaigns.createDraft({
        ...input,
        id: input.id ?? identity.id,
        ensLabel: input.ensLabel ?? identity.ensLabel,
        ensName: input.ensName ?? identity.ensName,
        advertiserEnsName,
      });
    },

    async createCampaignDraftFromMessage(input: {
      advertiserUserId: string;
      advertiserWalletAddress: string;
      telegramUsername?: string | null;
      tokenAddress: string;
      message: string;
      requestedImageFileId?: string | null;
    }) {
      const recommendation = await agent.analyzeCampaignRequest(input.message);
      if (!recommendation.safety.allowed) {
        return { status: 'BLOCKED' as const, recommendation };
      }

      if (recommendation.intake.missingFields.length > 0) {
        return { status: 'NEEDS_INPUT' as const, recommendation };
      }

      const targetChannel = recommendation.intake.targetChannel;
      if (!targetChannel) return { status: 'NEEDS_INPUT' as const, recommendation };

      const channel = await channels.findVerifiedByUsername(targetChannel);
      if (!channel) {
        return { status: 'CHANNEL_NOT_VERIFIED' as const, recommendation };
      }

      const poster = await users.findById(channel.ownerUserId);
      if (!poster) {
        return { status: 'POSTER_NOT_FOUND' as const, recommendation };
      }

      const advertiserEnsName = createUserEnsName({
        rootName: ensRootName,
        telegramUsername: input.telegramUsername,
        walletAddress: /^0x[a-fA-F0-9]{40}$/.test(input.advertiserWalletAddress)
          ? input.advertiserWalletAddress
          : '0x0000000000000000000000000000000000000000',
      });
      const identity = createCampaignEnsIdentity({
        rootName: ensRootName,
        userEnsName: advertiserEnsName,
        telegramUsername: input.telegramUsername,
      });

      const campaign = await campaigns.createDraft({
        id: identity.id,
        advertiserUserId: input.advertiserUserId,
        advertiserWalletAddress: input.advertiserWalletAddress,
        advertiserEnsName,
        posterUserId: poster.id,
        posterWalletAddress: poster.walletAddress,
        posterEnsName: poster.ensName,
        channelId: channel.id,
        targetTelegramChannelUsername: `@${channel.telegramChannelUsername ?? targetChannel.replace(/^@/, '')}`,
        tokenAddress: input.tokenAddress,
        amount: recommendation.intake.amount ?? '',
        durationSeconds: recommendation.intake.durationSeconds ?? 0,
        requestedText: recommendation.intake.adText ?? input.message,
        requestedImageFileId: input.requestedImageFileId ?? null,
        ensLabel: identity.ensLabel,
        ensName: identity.ensName,
      });

      const updatedCampaign = await campaigns.patch(campaign.id, {
        approvedText: recommendation.recommendedAdText,
      });

      return { status: 'CREATED' as const, recommendation, campaign: updatedCampaign, channel, poster };
    },

    async listEnsRecords() {
      return {
        rootName: ensRootName,
        records: await collectEnsRecords(),
      };
    },

    async resolveEnsName(name: string) {
      const normalizedName = name.trim().toLowerCase();
      return (await collectEnsRecords()).find((record) => record.name.toLowerCase() === normalizedName) ?? null;
    },

    async resolveEnsCcipRead(input: { sender: string; data: string }) {
      return resolveEnsCcipRead({
        ...input,
        records: await collectEnsRecords(),
      });
    },

    async listCampaigns() {
      return campaigns.list();
    },

    async getCampaign(campaignId: string) {
      return campaigns.findById(campaignId);
    },

    async getCampaignByOnchainId(onchainCampaignId: string) {
      const campaignList = await campaigns.list();
      return campaignList.find((campaign) => campaign.onchainCampaignId === onchainCampaignId) ?? null;
    },

    async findAwaitingPostCampaignForPoster(telegramUserId: string, channelUsername: string) {
      const wallet = await devWallets.findByTelegramUserId(telegramUserId);
      if (!wallet) throw new Error('No dev wallet exists yet. Use /dev_create_wallet first.');

      const awaiting = await campaigns.listByPosterWalletAndStatus(wallet.address, 'AWAITING_POST');
      const normalizedChannel = channelUsername.replace(/^@/, '').toLowerCase();

      return (
        awaiting
          .filter((campaign) => campaign.targetTelegramChannelUsername?.replace(/^@/, '').toLowerCase() === normalizedChannel)
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null
      );
    },

    async findCampaignBySubmittedPost(channelUsername: string, messageId: string) {
      return campaigns.findBySubmittedPost(channelUsername, messageId, ['ACTIVE', 'COMPLETED', 'FAILED', 'REFUNDED']);
    },

    async listFinalizableCampaigns(now = new Date()) {
      return (await campaigns.list()).filter((campaign) => {
        return campaign.status === 'ACTIVE' && campaign.endsAt !== null && campaign.endsAt.getTime() <= now.getTime();
      });
    },

    async advanceCampaign(campaignId: string, status: CampaignStatus) {
      return campaigns.advance(campaignId, status);
    },

    async generatePosterOffer(campaignId: string) {
      const campaign = await campaigns.findById(campaignId);
      if (!campaign) return null;
      return agent.generatePosterOffer(campaign);
    },

    async reviseCampaignCopy(campaignId: string, instruction?: string | null) {
      const campaign = await campaigns.findById(campaignId);
      if (!campaign) throw new Error('Campaign not found');

      const suggestion = await agent.suggestAdCopy({ campaign, instruction });
      const safety = checkContentSafety(suggestion.text);
      if (!safety.allowed) {
        const error = new Error(`Suggested copy was blocked: ${safety.reasons.join(', ')}`);
        error.name = 'ContentBlockedError';
        throw error;
      }

      const updated = await campaigns.patch(campaignId, {
        approvedText: suggestion.text,
      });
      return { campaign: updated, suggestion };
    },

    async fundDevCampaignFromBalance(telegramUserId: string, campaignId: string) {
      return fundDevCampaignFromBalance(telegramUserId, campaignId);
    },

    async markCampaignOffered(campaignId: string) {
      const campaign = await campaigns.findById(campaignId);
      if (!campaign) throw new Error('Campaign not found');
      if (campaign.status === 'OFFERED') return campaign;
      if (campaign.status !== 'FUNDED') {
        throw new Error('Campaign must be funded before sending an offer.');
      }
      return campaigns.advance(campaignId, 'OFFERED');
    },

    async fundDevCampaignAndMarkOffered(telegramUserId: string, campaignId: string) {
      let campaign = await campaigns.findById(campaignId);
      if (!campaign) throw new Error('Campaign not found');

      let funding:
        | {
            txHash: `0x${string}`;
            onchainCampaignId: bigint;
            authorizationMessage: string;
            authorizationSignature: `0x${string}`;
          }
        | null = null;

      if (campaign.status === 'DRAFT' || campaign.status === 'AWAITING_FUNDS') {
        const funded = await fundDevCampaignFromBalance(telegramUserId, campaignId);
        campaign = funded.campaign;
        funding = {
          txHash: funded.txHash,
          onchainCampaignId: funded.onchainCampaignId,
          authorizationMessage: funded.authorizationMessage,
          authorizationSignature: funded.authorizationSignature,
        };
      }

      if (campaign.status === 'FUNDED') {
        campaign = await campaigns.advance(campaign.id, 'OFFERED');
      }

      if (campaign.status !== 'OFFERED') {
        throw new Error(`Campaign cannot be offered from ${campaign.status}.`);
      }

      return { campaign, funding };
    },

    async acceptCampaignOffer(telegramUserId: string, campaignId: string) {
      const wallet = await devWallets.findByTelegramUserId(telegramUserId);
      if (!wallet) throw new Error('No dev wallet exists yet. Use /dev_create_wallet first.');

      const campaign = await campaigns.findById(campaignId);
      if (!campaign) throw new Error('Campaign not found');
      if (campaign.posterWalletAddress?.toLowerCase() !== wallet.address.toLowerCase()) {
        throw new Error('Only the poster can accept this campaign.');
      }

      let updated = campaign;
      if (updated.status === 'OFFERED' || updated.status === 'NEGOTIATING') updated = await campaigns.advance(updated.id, 'ACCEPTED');
      if (updated.status === 'ACCEPTED') updated = await campaigns.advance(updated.id, 'AWAITING_POST');
      return updated;
    },

    async rejectCampaignOffer(telegramUserId: string, campaignId: string) {
      const wallet = await devWallets.findByTelegramUserId(telegramUserId);
      if (!wallet) throw new Error('No dev wallet exists yet. Use /dev_create_wallet first.');

      const campaign = await campaigns.findById(campaignId);
      if (!campaign) throw new Error('Campaign not found');
      if (campaign.posterWalletAddress?.toLowerCase() !== wallet.address.toLowerCase()) {
        throw new Error('Only the poster can reject this campaign.');
      }

      return campaigns.advance(campaignId, 'REJECTED');
    },

    async suggestCounterReply(
      campaignId: string,
      counterMessage: string,
      roles?: { senderRole: 'ADVERTISER' | 'POSTER'; recipientRole: 'ADVERTISER' | 'POSTER' },
    ) {
      const campaign = await campaigns.findById(campaignId);
      if (!campaign) throw new Error('Campaign not found');
      const suggestion = await agent.suggestCounterReply({
        campaign,
        counterMessage,
        senderRole: roles?.senderRole ?? 'POSTER',
        recipientRole: roles?.recipientRole ?? 'ADVERTISER',
      });
      const updated = campaign.status === 'OFFERED' ? await campaigns.advance(campaignId, 'NEGOTIATING') : campaign;
      return { campaign: updated, suggestion };
    },

    async acceptCounterOffer(campaignId: string, amount: string, durationSeconds: number) {
      const campaign = await campaigns.findById(campaignId);
      if (!campaign) throw new Error('Campaign not found');
      if (campaign.status !== 'NEGOTIATING') throw new Error('Campaign is not negotiating.');

      const updated = await campaigns.patch(campaignId, { amount, durationSeconds });
      return campaigns.advance(updated.id, 'OFFERED');
    },

    async rejectCounterOfferAsAdvertiser(telegramUserId: string, campaignId: string) {
      const wallet = await devWallets.findByTelegramUserId(telegramUserId);
      if (!wallet) throw new Error('No dev wallet exists yet. Use /dev_create_wallet first.');

      const campaign = await campaigns.findById(campaignId);
      if (!campaign) throw new Error('Campaign not found');
      if (campaign.advertiserWalletAddress.toLowerCase() !== wallet.address.toLowerCase()) {
        throw new Error('Only the advertiser can reject this counter proposal.');
      }

      let txHash: `0x${string}` | null = null;
      if (campaign.onchainCampaignId) {
        txHash = await blockchain.refundCampaign(BigInt(campaign.onchainCampaignId));
      }

      let updated = await campaigns.advance(campaign.id, 'REFUNDED');
      if (txHash) {
        updated = await appendCampaignEnsEvent(updated.id, 'REFUNDED', txHash);
      }
      return { campaign: updated, txHash };
    },

    async submitPostForVerification(input: SubmitPostInput) {
      return campaigns.submitPostForVerification(input);
    },

    async finalizeCampaignAtEnd(input: {
      campaignId: string;
      observedText?: string | null;
      observedImageHash?: string | null;
      now?: Date;
    }) {
      const now = input.now ?? new Date();
      const campaign = await campaigns.findById(input.campaignId);
      if (!campaign) throw new Error('Campaign not found');
      if (campaign.status !== 'ACTIVE') throw new Error('Campaign is not active.');
      if (!campaign.endsAt || campaign.endsAt.getTime() > now.getTime()) throw new Error('Campaign has not reached its final check time yet.');
      if (!campaign.submittedPostUrl) throw new Error('Campaign does not have a submitted post URL.');

      const output = await campaigns.submitPostForVerification({
        campaignId: campaign.id,
        submittedPostUrl: campaign.submittedPostUrl,
        observedText: input.observedText,
        observedImageHash: input.observedImageHash,
        type: 'FINAL',
      });

      let txHash: `0x${string}` | null = null;
      let updated = await campaigns.findById(campaign.id);
      if (!updated) throw new Error('Campaign not found after final check.');

      if (output.check.status === 'PASSED') {
        if (updated.onchainCampaignId) {
          txHash = await blockchain.completeCampaign(BigInt(updated.onchainCampaignId));
        }
        updated = await campaigns.advance(updated.id, 'COMPLETED');
        updated = await appendCampaignEnsEvent(updated.id, 'COMPLETED', txHash);
        return { campaign: updated, check: output.check, result: output.result, settlement: 'COMPLETED' as const, txHash };
      }

      if (updated.onchainCampaignId) {
        txHash = await blockchain.refundCampaign(BigInt(updated.onchainCampaignId));
        updated = await campaigns.advance(updated.id, 'REFUNDED');
        updated = await appendCampaignEnsEvent(updated.id, 'REFUNDED', txHash);
        return { campaign: updated, check: output.check, result: output.result, settlement: 'REFUNDED' as const, txHash };
      }

      updated = await campaigns.advance(updated.id, 'FAILED');
      return { campaign: updated, check: output.check, result: output.result, settlement: 'FAILED' as const, txHash };
    },

    async submitCampaignPostUrlFromPoster(input: {
      telegramUserId: string;
      campaignId: string;
      submittedPostUrl: string;
      observedText?: string | null;
    }) {
      const wallet = await devWallets.findByTelegramUserId(input.telegramUserId);
      if (!wallet) throw new Error('No dev wallet exists yet. Use /dev_create_wallet first.');

      const campaign = await campaigns.findById(input.campaignId);
      if (!campaign) throw new Error('Campaign not found');
      if (campaign.posterWalletAddress?.toLowerCase() !== wallet.address.toLowerCase()) {
        throw new Error('Only the poster can submit the post URL for this campaign.');
      }

      let updated = campaign;
      if (updated.status === 'AWAITING_POST') updated = await campaigns.advance(updated.id, 'VERIFYING_POST');

      const output = await campaigns.submitPostForVerification({
        campaignId: updated.id,
        submittedPostUrl: input.submittedPostUrl,
        observedText: input.observedText,
      });

      let campaignAfterVerification = await campaigns.findById(updated.id);
      if (output.check.status === 'PASSED' && campaignAfterVerification?.onchainCampaignId) {
        const alreadyStarted = campaignAfterVerification.ensEvents.some((event) => event.type === 'STARTED');
        if (!alreadyStarted) {
          const txHash = await blockchain.startCampaign(BigInt(campaignAfterVerification.onchainCampaignId));
          campaignAfterVerification = await appendCampaignEnsEvent(campaignAfterVerification.id, 'STARTED', txHash);
        }
      }

      return { campaign: campaignAfterVerification, ...output };
    },

    async handleObservedCampaignPostEdit(input: { channelUsername: string; messageId: string; observedText?: string | null }) {
      const campaign = await campaigns.findBySubmittedPost(input.channelUsername, input.messageId, ['ACTIVE']);
      if (!campaign) return null;

      const result = verifyPostSnapshot({
        submittedPostUrl: campaign.submittedPostUrl ?? `https://t.me/${input.channelUsername.replace(/^@/, '')}/${input.messageId}`,
        expectedChannelUsername: campaign.targetTelegramChannelUsername,
        expectedText: campaign.approvedText,
        observedText: input.observedText,
        expectedImageHash: campaign.approvedImageHash,
      });

      if (result.passed) {
        return { campaign, result, status: 'UNCHANGED' as const };
      }

      let txHash: `0x${string}` | null = null;
      if (campaign.onchainCampaignId) {
        txHash = await blockchain.refundCampaign(BigInt(campaign.onchainCampaignId));
      }

      let updated = await campaigns.advance(campaign.id, 'FAILED');
      if (txHash) {
        updated = await campaigns.advance(updated.id, 'REFUNDED');
        updated = await appendCampaignEnsEvent(updated.id, 'REFUNDED', txHash);
      }

      return { campaign: updated, result, status: txHash ? ('REFUNDED' as const) : ('FAILED' as const), txHash };
    },

    async ensureDevWallet(telegramUserId: string, telegramUsername?: string | null) {
      return ensureDevWallet(telegramUserId, telegramUsername);
    },

    async getDevWallet(telegramUserId: string) {
      return devWallets.findByTelegramUserId(telegramUserId);
    },

    async getDevWalletBalance(telegramUserId: string) {
      const wallet = await devWallets.findByTelegramUserId(telegramUserId);
      if (!wallet) throw new Error('No dev wallet exists yet. Use /dev_create_wallet first.');
      return devWalletGateway.getBalance(wallet);
    },

    async getDevWalletMajorBalances(telegramUserId: string) {
      const wallet = await devWallets.findByTelegramUserId(telegramUserId);
      if (!wallet) throw new Error('No dev wallet exists yet. Use /dev_create_wallet first.');
      const balances = await devWalletGateway.getMajorBalances(wallet);
      return { wallet, balances };
    },

    async clearDevState(telegramUserId: string) {
      const wallet = await devWallets.findByTelegramUserId(telegramUserId);
      const user = await users.findByTelegramUserId(telegramUserId);

      await campaigns.deleteByParticipant({ advertiserUserId: pendingAdvertiserUserId(telegramUserId) });

      if (wallet) {
        await campaigns.deleteByParticipant({
          advertiserWalletAddress: wallet.address,
          posterWalletAddress: wallet.address,
        });
      }

      if (user) {
        await channels.deleteByOwnerUserId(user.id);
        await campaigns.deleteByParticipant({
          advertiserUserId: user.id,
          posterUserId: user.id,
        });
        await users.deleteByTelegramUserId(telegramUserId);
      }

      await devWallets.deleteByTelegramUserId(telegramUserId);
    },

    async signDevWalletMessage(telegramUserId: string, message: string) {
      const wallet = await devWallets.findByTelegramUserId(telegramUserId);
      if (!wallet) throw new Error('No dev wallet exists yet. Use /dev_create_wallet first.');
      const signature = await devWalletGateway.signMessage(wallet, message);
      return { wallet, message, signature };
    },

    async mintDevWalletMockToken(telegramUserId: string, tokenSymbol: string, amount: bigint) {
      const wallet = await ensureDevWallet(telegramUserId);
      const token = resolveMajorTokenBySymbol(tokenSymbol);
      if (!token) {
        throw new Error(`${tokenSymbol.toUpperCase()} is not configured on the server yet.`);
      }
      const txHash = await devWalletGateway.mintMockToken(token.address, wallet.address, amount);
      return { wallet, token, txHash };
    },

    async depositDevWalletToken(telegramUserId: string, tokenSymbol: string, amount: bigint) {
      const wallet = await devWallets.findByTelegramUserId(telegramUserId);
      if (!wallet) throw new Error('No dev wallet exists yet. Use /dev_create_wallet first.');

      const balances = await devWalletGateway.getMajorBalances(wallet);
      const tokenBalance = balances.find((balance) => balance.symbol === tokenSymbol.toUpperCase());
      if (!tokenBalance?.address) {
        throw new Error(`${tokenSymbol.toUpperCase()} is not configured on the server yet.`);
      }
      if (tokenBalance.walletBalance < amount) {
        throw new Error(
          `You do not have enough ${tokenBalance.symbol} in the wallet. Needed ${formatTokenAmount(amount, tokenBalance.decimals)}, wallet has ${formatTokenAmount(
            tokenBalance.walletBalance,
            tokenBalance.decimals,
          )}.`,
        );
      }

      try {
        const nonce = await blockchain.getTokenPermitNonce(tokenBalance.address, wallet.address);
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);
        const signature = await devWalletGateway.signTokenPermitAuthorization(wallet, {
          tokenAddress: tokenBalance.address,
          tokenName: permitTokenName(tokenBalance.symbol),
          chainId: dependencies.chainId,
          authorization: {
            owner: wallet.address,
            spender: dependencies.escrowContractAddress,
            value: amount,
            nonce,
            deadline,
          },
        });
        const txHash = await blockchain.depositWithPermit({
          ownerWalletAddress: wallet.address,
          tokenAddress: tokenBalance.address,
          amount,
          deadline,
          signature,
        });
        return { wallet, token: tokenBalance, txHash, signature, deadline };
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message.includes('function "depositWithPermit"') || message.includes('function "nonces" reverted')) {
          throw new Error('The deployed local contracts are still the old version. Redeploy the token and escrow contracts, update the addresses, and try again.');
        }
        if (message.includes('InvalidSignature') || message.includes('SignatureExpired')) {
          throw new Error('I could not authorize that gasless deposit. Please try /dev_deposit again.');
        }
        if (message.includes('InsufficientAllowance') || message.includes('SafeERC20CallFailed')) {
          throw new Error('The token permit was not accepted by the current token contract. Redeploy the latest local contracts and try again.');
        }
        throw new Error(`I could not relay that ${tokenBalance.symbol} deposit to escrow. Please try again.`);
      }
    },

    async withdrawDevWalletToken(telegramUserId: string, tokenSymbol: string, amount: bigint) {
      const wallet = await devWallets.findByTelegramUserId(telegramUserId);
      if (!wallet) throw new Error('No dev wallet exists yet. Use /dev_create_wallet first.');

      const balances = await devWalletGateway.getMajorBalances(wallet);
      const nativeBalance = balances.find((balance) => balance.isNative)?.walletBalance ?? 0n;
      const tokenBalance = balances.find((balance) => balance.symbol === tokenSymbol.toUpperCase());
      const availableInEscrow = tokenBalance?.escrowBalance ?? 0n;

      if (!tokenBalance?.address) {
        throw new Error(`${tokenSymbol.toUpperCase()} is not configured on the server yet.`);
      }
      if (availableInEscrow < amount) {
        throw new Error(
          `You do not have enough available ${tokenBalance.symbol} in escrow. Needed ${formatTokenAmount(amount, tokenBalance.decimals)}, available ${formatTokenAmount(
            availableInEscrow,
            tokenBalance.decimals,
          )}.`,
        );
      }
      if (nativeBalance === 0n) {
        throw new Error('This wallet has no ETH for gas yet. Send a small amount of ETH to it, then try /dev_withdraw again.');
      }

      try {
        const txHash = await devWalletGateway.withdraw(wallet, tokenBalance.address, amount);
        return { wallet, token: tokenBalance, txHash };
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message.includes('insufficient funds')) {
          throw new Error('This wallet does not have enough ETH to cover gas for the withdrawal.');
        }
        if (message.includes('Cannot infer a transaction type')) {
          throw new Error('I could not prepare the withdrawal transaction. Restart the server and try /dev_withdraw again.');
        }
        throw new Error(`I could not withdraw that ${tokenBalance.symbol} from escrow. Please try again.`);
      }
    },
  };
}

function parseTokenAmount(value: string, decimals: number): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0').slice(0, decimals) || '0');
}

function formatTokenAmount(value: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = value % divisor;
  if (fraction === 0n) return whole.toString();

  const paddedFraction = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toString()}.${paddedFraction}`;
}

function permitTokenName(symbol: string): string {
  switch (symbol.toUpperCase()) {
    case 'USDT':
      return 'Mock USDT';
    case 'USDC':
    default:
      return 'Mock USDC';
  }
}

function pendingAdvertiserUserId(telegramUserId: string): string {
  return `telegram:${telegramUserId}`;
}

function formatCreateCampaignAuthorizationMessage(
  campaign: { id: string; ensName?: string | null; amount: string; targetTelegramChannelUsername: string | null; durationSeconds: number },
  tokenSymbol: string,
): string {
  return [
    'Authorize Grandma Ads to lock funds for this campaign.',
    `Campaign: ${campaign.id}`,
    campaign.ensName ? `ENS: ${campaign.ensName}` : null,
    `Target channel: ${campaign.targetTelegramChannelUsername ?? 'not set'}`,
    `Amount: ${campaign.amount} ${tokenSymbol}`,
    `Duration: ${formatDuration(campaign.durationSeconds)}`,
    'The poster is paid only if the approved ad is published and verification passes.',
  ].filter((line): line is string => line !== null).join('\n');
}

function formatDuration(durationSeconds: number): string {
  if (durationSeconds % 86_400 === 0) return `${durationSeconds / 86_400}d`;
  if (durationSeconds % 3_600 === 0) return `${durationSeconds / 3_600}h`;
  return `${durationSeconds}s`;
}
