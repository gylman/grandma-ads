import { checkContentSafety } from '../../domain/moderation';
import { CampaignStatus } from '../../domain/types';
import { verifyPostSnapshot } from '../../domain/verification';
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
}) {
  const { users, channels, campaigns, agent, blockchain, devWallets, devWalletGateway } = dependencies;
  const tokenDecimalsByAddress = dependencies.tokenDecimalsByAddress ?? {};

  async function ensureDevWallet(telegramUserId: string) {
    const existing = await devWallets.findByTelegramUserId(telegramUserId);
    if (existing) return existing;

    return await devWallets.save(await devWalletGateway.createWallet(telegramUserId));
  }

  async function fundDevCampaignFromBalance(telegramUserId: string, campaignId: string) {
    const wallet = await devWallets.findByTelegramUserId(telegramUserId);
    if (!wallet) throw new Error('No dev wallet exists yet. Use /dev_create_wallet first.');

    let campaign = await campaigns.findById(campaignId);
    if (!campaign) throw new Error('Campaign not found');
    if (campaign.advertiserUserId === pendingAdvertiserUserId(telegramUserId)) {
      const user = await users.upsert({
        walletAddress: wallet.address,
        telegramUserId,
      });
      campaign = await campaigns.patch(campaign.id, {
        advertiserUserId: user.id,
        advertiserWalletAddress: wallet.address,
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

    const nativeBalance = balances.find((balance) => balance.isNative);
    if (!nativeBalance || nativeBalance.walletBalance === 0n) {
      throw new Error('This wallet has no native ETH for transaction gas. Add a small amount of ETH, then try again.');
    }

    let result;
    try {
      result = await devWalletGateway.createCampaignFromBalance(wallet, {
        posterWalletAddress: campaign.posterWalletAddress as `0x${string}`,
        tokenAddress: campaign.tokenAddress as `0x${string}`,
        amount,
        durationSeconds: BigInt(campaign.durationSeconds),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('InsufficientBalance') || message.includes('0xf4d678b8')) {
        throw new Error(`You do not have enough available ${tokenBalance.symbol} in escrow for this campaign.`);
      }
      throw new Error('I could not lock funds on-chain for this campaign. Please check your balances and try again.');
    }

    let updated = campaign;
    if (updated.status === 'DRAFT') updated = await campaigns.advance(updated.id, 'AWAITING_FUNDS');
    if (updated.status === 'AWAITING_FUNDS') updated = await campaigns.advance(updated.id, 'FUNDED');

    updated = await campaigns.patch(updated.id, {
      onchainCampaignId: result.onchainCampaignId.toString(),
    });

    return { campaign: updated, txHash: result.txHash, onchainCampaignId: result.onchainCampaignId };
  }

  return {
    health() {
      return { ok: true, service: 'grandma-ads-server' };
    },

    async upsertUser(input: UpsertUserInput) {
      return users.upsert(input);
    },

    async getUserByWallet(walletAddress: string) {
      return users.findByWallet(walletAddress);
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

      return campaigns.createDraft(input);
    },

    async createCampaignDraftFromMessage(input: { advertiserUserId: string; advertiserWalletAddress: string; tokenAddress: string; message: string }) {
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

      const campaign = await campaigns.createDraft({
        advertiserUserId: input.advertiserUserId,
        advertiserWalletAddress: input.advertiserWalletAddress,
        posterUserId: poster.id,
        posterWalletAddress: poster.walletAddress,
        channelId: channel.id,
        targetTelegramChannelUsername: `@${channel.telegramChannelUsername ?? targetChannel.replace(/^@/, '')}`,
        tokenAddress: input.tokenAddress,
        amount: recommendation.intake.amount ?? '',
        durationSeconds: recommendation.intake.durationSeconds ?? 0,
        requestedText: recommendation.intake.adText ?? input.message,
      });

      const updatedCampaign = await campaigns.patch(campaign.id, {
        approvedText: recommendation.recommendedAdText,
      });

      return { status: 'CREATED' as const, recommendation, campaign: updatedCampaign, channel, poster };
    },

    async listCampaigns() {
      return campaigns.list();
    },

    async getCampaign(campaignId: string) {
      return campaigns.findById(campaignId);
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
          }
        | null = null;

      if (campaign.status === 'DRAFT' || campaign.status === 'AWAITING_FUNDS') {
        const funded = await fundDevCampaignFromBalance(telegramUserId, campaignId);
        campaign = funded.campaign;
        funding = {
          txHash: funded.txHash,
          onchainCampaignId: funded.onchainCampaignId,
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

    async suggestCounterReply(campaignId: string, counterMessage: string) {
      const campaign = await campaigns.findById(campaignId);
      if (!campaign) throw new Error('Campaign not found');
      const suggestion = await agent.suggestCounterReply({ campaign, counterMessage });
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

    async submitPostForVerification(input: SubmitPostInput) {
      return campaigns.submitPostForVerification(input);
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

      return { campaign: await campaigns.findById(updated.id), ...output };
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
      }

      return { campaign: updated, result, status: txHash ? ('REFUNDED' as const) : ('FAILED' as const), txHash };
    },

    async ensureDevWallet(telegramUserId: string) {
      return ensureDevWallet(telegramUserId);
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

    async mintDevWalletMockUsdc(telegramUserId: string, amount: bigint) {
      const wallet = await ensureDevWallet(telegramUserId);
      const txHash = await devWalletGateway.mintMockUsdc(wallet.address, amount);
      return { wallet, txHash };
    },

    async depositDevWalletMockUsdc(telegramUserId: string, amount: bigint) {
      const wallet = await devWallets.findByTelegramUserId(telegramUserId);
      if (!wallet) throw new Error('No dev wallet exists yet. Use /dev_create_wallet first.');

      const approvalTxHash = await devWalletGateway.approveEscrow(wallet, amount);
      const depositTxHash = await devWalletGateway.deposit(wallet, amount);
      return { wallet, approvalTxHash, depositTxHash };
    },

    async withdrawDevWalletMockUsdc(telegramUserId: string, amount: bigint) {
      const wallet = await devWallets.findByTelegramUserId(telegramUserId);
      if (!wallet) throw new Error('No dev wallet exists yet. Use /dev_create_wallet first.');

      const txHash = await devWalletGateway.withdraw(wallet, amount);
      return { wallet, txHash };
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

function pendingAdvertiserUserId(telegramUserId: string): string {
  return `telegram:${telegramUserId}`;
}
