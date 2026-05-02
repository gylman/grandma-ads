import { createCampaign, transitionCampaign } from '../../domain/campaign';
import { verifyPostSnapshot } from '../../domain/verification';
import { CampaignRepository, CreateDraftCampaignInput, PatchCampaignInput, SubmitPostInput } from '../../application/ports/campaignRepository';
import { ChannelRepository, RegisterChannelInput, RegisterChannelOutcome } from '../../application/ports/channelRepository';
import { DevWallet, DevWalletRepository } from '../../application/ports/devWalletRepository';
import { UpsertUserInput, UserRepository } from '../../application/ports/userRepository';
import { Campaign, CampaignStatus, Channel, ChannelStatus, User, VerificationCheck } from '../../domain/types';

let nextId = 1;

function id(prefix: string): string {
  return `${prefix}_${nextId++}`;
}

export function createInMemoryRepositories(): {
  users: UserRepository;
  channels: ChannelRepository;
  campaigns: CampaignRepository;
  devWallets: DevWalletRepository;
} {
  const users = new Map<string, User>();
  const channels = new Map<string, Channel>();
  const campaigns = new Map<string, Campaign>();
  const verificationChecks = new Map<string, VerificationCheck>();
  const devWallets = new Map<string, DevWallet>();

  return {
    users: {
      async upsert(input: UpsertUserInput): Promise<User> {
        const normalizedWallet = input.walletAddress.toLowerCase();
        const existing = [...users.values()].find((user) => user.walletAddress.toLowerCase() === normalizedWallet);
        const now = new Date();

        if (existing) {
          const updated = {
            ...existing,
            telegramUserId: input.telegramUserId ?? existing.telegramUserId,
            telegramUsername: input.telegramUsername ?? existing.telegramUsername,
            updatedAt: now,
          };
          users.set(updated.id, updated);
          return updated;
        }

        const user: User = {
          id: id('usr'),
          walletAddress: input.walletAddress,
          telegramUserId: input.telegramUserId ?? null,
          telegramUsername: input.telegramUsername ?? null,
          createdAt: now,
          updatedAt: now,
        };
        users.set(user.id, user);
        return user;
      },

      async findByWallet(walletAddress: string): Promise<User | null> {
        return [...users.values()].find((user) => user.walletAddress.toLowerCase() === walletAddress.toLowerCase()) ?? null;
      },

      async findById(userId: string): Promise<User | null> {
        return users.get(userId) ?? null;
      },

      async findByTelegramUserId(telegramUserId: string): Promise<User | null> {
        return [...users.values()].find((user) => user.telegramUserId === telegramUserId) ?? null;
      },

      async deleteByTelegramUserId(telegramUserId: string): Promise<void> {
        for (const [id, user] of users) {
          if (user.telegramUserId === telegramUserId) {
            users.delete(id);
          }
        }
      },
    },

    channels: {
      async register(input: RegisterChannelInput): Promise<RegisterChannelOutcome> {
        const normalizedUsername = normalizeChannelUsername(input.telegramChannelUsername);
        const existingVerified = [...channels.values()].find(
          (channel) => normalizeChannelUsername(channel.telegramChannelUsername ?? channel.telegramChannelId) === normalizedUsername && channel.status === 'VERIFIED',
        );
        if (existingVerified) return { channel: existingVerified, status: 'ALREADY_VERIFIED' };

        const existingPending = [...channels.values()].find(
          (channel) =>
            normalizeChannelUsername(channel.telegramChannelUsername ?? channel.telegramChannelId) === normalizedUsername &&
            channel.ownerUserId === input.ownerUserId &&
            channel.status === 'PENDING',
        );
        if (existingPending) return { channel: existingPending, status: 'PENDING_EXISTS' };

        const now = new Date();
        const shortOwner = input.ownerUserId.replace(/\W/g, '').slice(-6).toUpperCase();
        const channel: Channel = {
          id: id('chn'),
          telegramChannelId: input.telegramChannelUsername,
          telegramChannelUsername: normalizedUsername,
          title: input.title ?? null,
          ownerUserId: input.ownerUserId,
          verificationCode: `AD_VERIFY_${Math.random().toString(36).slice(2, 8).toUpperCase()}_${shortOwner}`,
          verificationPostUrl: null,
          verifiedAt: null,
          status: 'PENDING',
          createdAt: now,
          updatedAt: now,
        };
        channels.set(channel.id, channel);
        return { channel, status: 'CREATED' };
      },

      async updateStatus(channelId: string, status: ChannelStatus, verificationPostUrl?: string): Promise<Channel> {
        const channel = channels.get(channelId);
        if (!channel) throw new Error('Channel not found');

        const updated: Channel = {
          ...channel,
          status,
          verificationPostUrl: verificationPostUrl ?? channel.verificationPostUrl,
          verifiedAt: status === 'VERIFIED' ? new Date() : channel.verifiedAt,
          updatedAt: new Date(),
        };
        channels.set(channelId, updated);
        return updated;
      },

      async findVerifiedByUsername(telegramChannelUsername: string): Promise<Channel | null> {
        const normalizedUsername = normalizeChannelUsername(telegramChannelUsername);
        return (
          [...channels.values()].find(
            (channel) => normalizeChannelUsername(channel.telegramChannelUsername ?? channel.telegramChannelId) === normalizedUsername && channel.status === 'VERIFIED',
          ) ?? null
        );
      },

      async list(ownerUserId?: string): Promise<Channel[]> {
        const list = [...channels.values()];
        return ownerUserId ? list.filter((channel) => channel.ownerUserId === ownerUserId) : list;
      },

      async deleteByOwnerUserId(ownerUserId: string): Promise<void> {
        for (const [id, channel] of channels) {
          if (channel.ownerUserId === ownerUserId) {
            channels.delete(id);
          }
        }
      },
    },

    campaigns: {
      async createDraft(input: CreateDraftCampaignInput): Promise<Campaign> {
        const campaign = createCampaign({ ...input, id: id('cmp') });
        campaigns.set(campaign.id, campaign);
        return campaign;
      },

      async list(): Promise<Campaign[]> {
        return [...campaigns.values()];
      },

      async listByPosterWalletAndStatus(posterWalletAddress: string, status: CampaignStatus): Promise<Campaign[]> {
        return [...campaigns.values()].filter(
          (campaign) => campaign.posterWalletAddress?.toLowerCase() === posterWalletAddress.toLowerCase() && campaign.status === status,
        );
      },

      async findBySubmittedPost(channelUsername: string, messageId: string, statuses: CampaignStatus[]): Promise<Campaign | null> {
        const normalizedChannel = normalizeChannelUsername(channelUsername);
        return (
          [...campaigns.values()].find(
            (campaign) =>
              statuses.includes(campaign.status) &&
              campaign.submittedMessageId === messageId &&
              normalizeChannelUsername(campaign.targetTelegramChannelUsername ?? '') === normalizedChannel,
          ) ?? null
        );
      },

      async findById(campaignId: string): Promise<Campaign | null> {
        return campaigns.get(campaignId) ?? null;
      },

      async patch(campaignId: string, patch: PatchCampaignInput): Promise<Campaign> {
        const campaign = campaigns.get(campaignId);
        if (!campaign) throw new Error('Campaign not found');

        const updated: Campaign = { ...campaign, ...patch, updatedAt: new Date() };
        campaigns.set(campaignId, updated);
        return updated;
      },

      async advance(campaignId, nextStatus): Promise<Campaign> {
        const campaign = campaigns.get(campaignId);
        if (!campaign) throw new Error('Campaign not found');

        const updated = transitionCampaign(campaign, nextStatus);
        campaigns.set(campaignId, updated);
        return updated;
      },

      async submitPostForVerification(input: SubmitPostInput) {
        const campaign = campaigns.get(input.campaignId);
        if (!campaign) throw new Error('Campaign not found');

        const result = verifyPostSnapshot({
          submittedPostUrl: input.submittedPostUrl,
          expectedChannelUsername: campaign.targetTelegramChannelUsername,
          expectedText: campaign.approvedText,
          observedText: input.observedText,
          expectedImageHash: campaign.approvedImageHash,
          observedImageHash: input.observedImageHash,
        });

        const check: VerificationCheck = {
          id: id('chk'),
          campaignId: campaign.id,
          type: input.type ?? 'INITIAL',
          status: result.passed ? 'PASSED' : 'FAILED',
          reason: result.reason,
          checkedAt: new Date(),
          rawResultJson: result,
        };

        verificationChecks.set(check.id, check);
        campaigns.set(campaign.id, {
          ...campaign,
          submittedPostUrl: input.submittedPostUrl,
          submittedMessageId: result.messageId,
          status: result.passed ? 'ACTIVE' : 'AWAITING_POST',
          startsAt: result.passed ? new Date() : campaign.startsAt,
          endsAt: result.passed ? new Date(Date.now() + campaign.durationSeconds * 1000) : campaign.endsAt,
          updatedAt: new Date(),
        });

        return { check, result };
      },

      async deleteByParticipant(input): Promise<void> {
        for (const [id, campaign] of campaigns) {
          const matches =
            (input.advertiserUserId && campaign.advertiserUserId === input.advertiserUserId) ||
            (input.advertiserWalletAddress &&
              campaign.advertiserWalletAddress.toLowerCase() === input.advertiserWalletAddress.toLowerCase()) ||
            (input.posterUserId && campaign.posterUserId === input.posterUserId) ||
            (input.posterWalletAddress &&
              campaign.posterWalletAddress?.toLowerCase() === input.posterWalletAddress.toLowerCase());

          if (matches) {
            campaigns.delete(id);
          }
        }
      },
    },

    devWallets: {
      async findByTelegramUserId(telegramUserId: string): Promise<DevWallet | null> {
        return devWallets.get(telegramUserId) ?? null;
      },

      async save(wallet: DevWallet): Promise<DevWallet> {
        devWallets.set(wallet.telegramUserId, wallet);
        return wallet;
      },

      async deleteByTelegramUserId(telegramUserId: string): Promise<void> {
        devWallets.delete(telegramUserId);
      },
    },
  };
}

function normalizeChannelUsername(value: string): string {
  return value.trim().replace(/^@/, '').toLowerCase();
}
