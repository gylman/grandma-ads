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
}) {
  const { users, channels, campaigns, agent, blockchain, devWallets, devWalletGateway } = dependencies;

  async function ensureDevWallet(telegramUserId: string) {
    const existing = await devWallets.findByTelegramUserId(telegramUserId);
    if (existing) return existing;

    return await devWallets.save(devWalletGateway.generateWallet(telegramUserId));
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
      if (!wallet) throw new Error('No dev wallet exists yet. Use /dev_wallet first.');

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
      const wallet = await devWallets.findByTelegramUserId(telegramUserId);
      if (!wallet) throw new Error('No dev wallet exists yet. Use /dev_wallet first.');

      const campaign = await campaigns.findById(campaignId);
      if (!campaign) throw new Error('Campaign not found');
      if (campaign.advertiserWalletAddress.toLowerCase() !== wallet.address.toLowerCase()) {
        throw new Error('Only the campaign advertiser can fund this campaign.');
      }
      if (!campaign.posterWalletAddress || !/^0x[a-fA-F0-9]{40}$/.test(campaign.posterWalletAddress)) {
        throw new Error('Campaign poster wallet is missing.');
      }

      const result = await devWalletGateway.createCampaignFromBalance(wallet, {
        posterWalletAddress: campaign.posterWalletAddress as `0x${string}`,
        amount: parseUsdcAmount(campaign.amount),
        durationSeconds: BigInt(campaign.durationSeconds),
      });

      let updated = campaign;
      if (updated.status === 'DRAFT') updated = await campaigns.advance(updated.id, 'AWAITING_FUNDS');
      if (updated.status === 'AWAITING_FUNDS') updated = await campaigns.advance(updated.id, 'FUNDED');

      updated = await campaigns.patch(updated.id, {
        onchainCampaignId: result.onchainCampaignId.toString(),
      });

      return { campaign: updated, txHash: result.txHash, onchainCampaignId: result.onchainCampaignId };
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

    async acceptCampaignOffer(telegramUserId: string, campaignId: string) {
      const wallet = await devWallets.findByTelegramUserId(telegramUserId);
      if (!wallet) throw new Error('No dev wallet exists yet. Use /dev_wallet first.');

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
      if (!wallet) throw new Error('No dev wallet exists yet. Use /dev_wallet first.');

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
      if (!wallet) throw new Error('No dev wallet exists yet. Use /dev_wallet first.');

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
      if (!wallet) throw new Error('No dev wallet exists yet. Use /dev_wallet first.');
      return devWalletGateway.getBalance(wallet);
    },

    async mintDevWalletMockUsdc(telegramUserId: string, amount: bigint) {
      const wallet = await ensureDevWallet(telegramUserId);
      const txHash = await devWalletGateway.mintMockUsdc(wallet.address, amount);
      return { wallet, txHash };
    },

    async depositDevWalletMockUsdc(telegramUserId: string, amount: bigint) {
      const wallet = await devWallets.findByTelegramUserId(telegramUserId);
      if (!wallet) throw new Error('No dev wallet exists yet. Use /dev_wallet first.');

      const approvalTxHash = await devWalletGateway.approveEscrow(wallet, amount);
      const depositTxHash = await devWalletGateway.deposit(wallet, amount);
      return { wallet, approvalTxHash, depositTxHash };
    },

    async withdrawDevWalletMockUsdc(telegramUserId: string, amount: bigint) {
      const wallet = await devWallets.findByTelegramUserId(telegramUserId);
      if (!wallet) throw new Error('No dev wallet exists yet. Use /dev_wallet first.');

      const txHash = await devWalletGateway.withdraw(wallet, amount);
      return { wallet, txHash };
    },
  };
}

function parseUsdcAmount(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole || '0') * 1_000_000n + BigInt(fraction.padEnd(6, '0').slice(0, 6) || '0');
}
