import { randomUUID } from 'node:crypto';
import { Connection, Schema, createConnection } from 'mongoose';
import { CreateDraftCampaignInput, PatchCampaignInput, SubmitPostInput } from '../../../application/ports/campaignRepository';
import { RegisterChannelInput, RegisterChannelOutcome } from '../../../application/ports/channelRepository';
import { DevWallet } from '../../../application/ports/devWalletRepository';
import { PersistenceAdapterPort } from '../../../application/ports/persistence';
import { UpsertUserInput } from '../../../application/ports/userRepository';
import { AppConfig } from '../../../config';
import { createCampaign, transitionCampaign } from '../../../domain/campaign';
import { Campaign, CampaignEnsEvent, CampaignStatus, Channel, ChannelStatus, User, VerificationCheck } from '../../../domain/types';
import { verifyPostSnapshot } from '../../../domain/verification';

type UserDocument = User & {
  walletAddressLower: string;
};

type ChannelDocument = Channel & {
  telegramChannelUsernameLower: string;
};

type Models = ReturnType<typeof createModels>;

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

export async function createMongoPersistenceAdapter(config: AppConfig): Promise<PersistenceAdapterPort> {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required when PERSISTENCE_MODE=mongodb');
  }

  const connection = await createConnection(config.databaseUrl, {
    dbName: config.databaseName,
  }).asPromise();
  const models = createModels(connection);
  await Promise.all(Object.values(models).map((model) => model.init()));

  return {
    repositories: {
      users: {
        async upsert(input: UpsertUserInput): Promise<User> {
          const normalizedWallet = input.walletAddress.toLowerCase();
          const now = new Date();
          const existing = await models.User.findOne({ walletAddressLower: normalizedWallet }).lean<UserDocument | null>();

          if (existing) {
            const updated: UserDocument = {
              ...existing,
              telegramUserId: input.telegramUserId ?? existing.telegramUserId,
              telegramUsername: input.telegramUsername ?? existing.telegramUsername,
              ensName: input.ensName ?? existing.ensName,
              updatedAt: now,
            };

            await models.User.updateOne(
              { id: existing.id },
              {
                $set: {
                  telegramUserId: updated.telegramUserId,
                  telegramUsername: updated.telegramUsername,
                  ensName: updated.ensName,
                  updatedAt: updated.updatedAt,
                },
              },
            );

            return toUser(updated);
          }

          const created: UserDocument = {
            id: id('usr'),
            walletAddress: input.walletAddress,
            walletAddressLower: normalizedWallet,
            telegramUserId: input.telegramUserId ?? null,
            telegramUsername: input.telegramUsername ?? null,
            ensName: input.ensName ?? null,
            createdAt: now,
            updatedAt: now,
          };

          await models.User.create(created);
          return toUser(created);
        },

        async findByWallet(walletAddress: string): Promise<User | null> {
          const user = await models.User.findOne({ walletAddressLower: walletAddress.toLowerCase() }).lean<UserDocument | null>();
          return user ? toUser(user) : null;
        },

        async list(): Promise<User[]> {
          const users = await models.User.find({}).sort({ createdAt: -1 }).lean<UserDocument[]>();
          return users.map(toUser);
        },

        async findById(userId: string): Promise<User | null> {
          const user = await models.User.findOne({ id: userId }).lean<UserDocument | null>();
          return user ? toUser(user) : null;
        },

        async findByTelegramUserId(telegramUserId: string): Promise<User | null> {
          const user = await models.User.findOne({ telegramUserId }).lean<UserDocument | null>();
          return user ? toUser(user) : null;
        },

        async findByEnsName(ensName: string): Promise<User | null> {
          const user = await models.User.findOne({ ensName: ensName.toLowerCase() }).lean<UserDocument | null>();
          return user ? toUser(user) : null;
        },

        async deleteByTelegramUserId(telegramUserId: string): Promise<void> {
          await models.User.deleteMany({ telegramUserId });
        },
      },

      channels: {
        async register(input: RegisterChannelInput): Promise<RegisterChannelOutcome> {
          const normalizedUsername = normalizeChannelUsername(input.telegramChannelUsername);
          const existingVerified = await models.Channel.findOne({
            telegramChannelUsernameLower: normalizedUsername,
            status: 'VERIFIED',
          }).lean<ChannelDocument | null>();
          if (existingVerified) return { channel: toChannel(existingVerified), status: 'ALREADY_VERIFIED' };

          const existingPending = await models.Channel.findOne({
            telegramChannelUsernameLower: normalizedUsername,
            ownerUserId: input.ownerUserId,
            status: 'PENDING',
          }).lean<ChannelDocument | null>();
          if (existingPending) return { channel: toChannel(existingPending), status: 'PENDING_EXISTS' };

          const now = new Date();
          const shortOwner = input.ownerUserId.replace(/\W/g, '').slice(-6).toUpperCase();
          const channel: ChannelDocument = {
            id: id('chn'),
            telegramChannelId: input.telegramChannelUsername,
            telegramChannelUsername: normalizedUsername,
            telegramChannelUsernameLower: normalizedUsername,
            title: input.title ?? null,
            ownerUserId: input.ownerUserId,
            verificationCode: `AD_VERIFY_${Math.random().toString(36).slice(2, 8).toUpperCase()}_${shortOwner}`,
            verificationPostUrl: null,
            verifiedAt: null,
            status: 'PENDING',
            createdAt: now,
            updatedAt: now,
          };

          await models.Channel.create(channel);
          return { channel: toChannel(channel), status: 'CREATED' };
        },

        async updateStatus(channelId: string, status: ChannelStatus, verificationPostUrl?: string): Promise<Channel> {
          const channel = await models.Channel.findOne({ id: channelId }).lean<ChannelDocument | null>();
          if (!channel) throw new Error('Channel not found');

          const updated: Channel = {
            ...toChannel(channel),
            status,
            verificationPostUrl: verificationPostUrl ?? channel.verificationPostUrl,
            verifiedAt: status === 'VERIFIED' ? new Date() : channel.verifiedAt,
            updatedAt: new Date(),
          };

          await models.Channel.updateOne(
            { id: channelId },
            {
              $set: {
                status: updated.status,
                verificationPostUrl: updated.verificationPostUrl,
                verifiedAt: updated.verifiedAt,
                updatedAt: updated.updatedAt,
              },
            },
          );

          return updated;
        },

        async findVerifiedByUsername(telegramChannelUsername: string): Promise<Channel | null> {
          const channel = await models.Channel.findOne({
            telegramChannelUsernameLower: normalizeChannelUsername(telegramChannelUsername),
            status: 'VERIFIED',
          }).lean<ChannelDocument | null>();
          return channel ? toChannel(channel) : null;
        },

        async list(ownerUserId?: string): Promise<Channel[]> {
          const filter = ownerUserId ? { ownerUserId } : {};
          const channels = await models.Channel.find(filter).sort({ createdAt: -1 }).lean<ChannelDocument[]>();
          return channels.map(toChannel);
        },

        async deleteByOwnerUserId(ownerUserId: string): Promise<void> {
          await models.Channel.deleteMany({ ownerUserId });
        },
      },

      campaigns: {
        async createDraft(input: CreateDraftCampaignInput): Promise<Campaign> {
          const campaign = createCampaign({ ...input, id: input.id ?? id('cmp') });
          await models.Campaign.create(campaign);
          return campaign;
        },

        async list(): Promise<Campaign[]> {
          const campaigns = await models.Campaign.find({}).sort({ createdAt: -1 }).lean<Campaign[]>();
          return campaigns.map(toCampaign);
        },

        async listByPosterWalletAndStatus(posterWalletAddress: string, status: CampaignStatus): Promise<Campaign[]> {
          const campaigns = await models.Campaign.find({ posterWalletAddress, status }).sort({ updatedAt: -1 }).lean<Campaign[]>();
          return campaigns.map(toCampaign);
        },

        async findBySubmittedPost(channelUsername: string, messageId: string, statuses: CampaignStatus[]): Promise<Campaign | null> {
          const normalizedChannel = normalizeChannelUsername(channelUsername);
          const candidates = await models.Campaign.find({ submittedMessageId: messageId, status: { $in: statuses } })
            .sort({ updatedAt: -1 })
            .lean<Campaign[]>();
          const campaign =
            candidates.find((candidate) => normalizeChannelUsername(candidate.targetTelegramChannelUsername ?? '') === normalizedChannel) ?? null;
          return campaign ? toCampaign(campaign) : null;
        },

        async findById(campaignId: string): Promise<Campaign | null> {
          const campaign = await models.Campaign.findOne({ id: campaignId }).lean<Campaign | null>();
          return campaign ? toCampaign(campaign) : null;
        },

        async patch(campaignId: string, patch: PatchCampaignInput): Promise<Campaign> {
          const update = { ...patch, updatedAt: new Date() };
          const campaign = await models.Campaign.findOneAndUpdate({ id: campaignId }, { $set: update }, { new: true }).lean<Campaign | null>();
          if (!campaign) throw new Error('Campaign not found');
          return toCampaign(campaign);
        },

        async advance(campaignId: string, nextStatus: CampaignStatus): Promise<Campaign> {
          const campaign = await models.Campaign.findOne({ id: campaignId }).lean<Campaign | null>();
          if (!campaign) throw new Error('Campaign not found');

          const updated = transitionCampaign(toCampaign(campaign), nextStatus);
          await models.Campaign.replaceOne({ id: campaignId }, updated);
          return updated;
        },

        async submitPostForVerification(input: SubmitPostInput) {
          const campaign = await models.Campaign.findOne({ id: input.campaignId }).lean<Campaign | null>();
          if (!campaign) throw new Error('Campaign not found');

          const domainCampaign = toCampaign(campaign);
          const result = verifyPostSnapshot({
            submittedPostUrl: input.submittedPostUrl,
            expectedChannelUsername: domainCampaign.targetTelegramChannelUsername,
            expectedText: domainCampaign.approvedText,
            observedText: input.observedText,
            expectedImageHash: domainCampaign.approvedImageHash,
            observedImageHash: input.observedImageHash,
          });

          const check: VerificationCheck = {
            id: id('chk'),
            campaignId: domainCampaign.id,
            type: input.type ?? 'INITIAL',
            status: result.passed ? 'PASSED' : 'FAILED',
            reason: result.reason,
            checkedAt: new Date(),
            rawResultJson: result,
          };

          const updatedCampaign: Campaign = {
            ...domainCampaign,
            submittedPostUrl: input.submittedPostUrl,
            submittedMessageId: result.messageId,
            status: result.passed ? 'ACTIVE' : 'AWAITING_POST',
            startsAt: result.passed ? new Date() : domainCampaign.startsAt,
            endsAt: result.passed ? new Date(Date.now() + domainCampaign.durationSeconds * 1000) : domainCampaign.endsAt,
            updatedAt: new Date(),
          };

          await models.VerificationCheck.create(check);
          await models.Campaign.replaceOne({ id: domainCampaign.id }, updatedCampaign);

          return { check, result };
        },

        async deleteByParticipant(input): Promise<void> {
          const or: Array<Record<string, string>> = [];
          if (input.advertiserUserId) or.push({ advertiserUserId: input.advertiserUserId });
          if (input.advertiserWalletAddress) or.push({ advertiserWalletAddress: input.advertiserWalletAddress });
          if (input.posterUserId) or.push({ posterUserId: input.posterUserId });
          if (input.posterWalletAddress) or.push({ posterWalletAddress: input.posterWalletAddress });

          if (or.length === 0) return;
          await models.Campaign.deleteMany({ $or: or } as never);
        },
      },

      devWallets: {
        async findByTelegramUserId(telegramUserId: string): Promise<DevWallet | null> {
          const wallet = await models.DevWallet.findOne({ telegramUserId }).lean<DevWallet | null>();
          return wallet ? toDevWallet(wallet) : null;
        },

        async save(wallet: DevWallet): Promise<DevWallet> {
          await models.DevWallet.updateOne({ telegramUserId: wallet.telegramUserId }, { $set: wallet }, { upsert: true });
          return wallet;
        },

        async deleteByTelegramUserId(telegramUserId: string): Promise<void> {
          await models.DevWallet.deleteMany({ telegramUserId });
        },
      },
    },
    async close() {
      await connection.close();
    },
  };
}

function createModels(connection: Connection) {
  const userSchema = new Schema<UserDocument>(
    {
      id: { type: String, required: true, unique: true },
      telegramUserId: { type: String, default: null },
      telegramUsername: { type: String, default: null },
      walletAddress: { type: String, required: true },
      walletAddressLower: { type: String, required: true, unique: true },
      ensName: { type: String, default: null, index: true },
      createdAt: { type: Date, required: true },
      updatedAt: { type: Date, required: true },
    },
    { versionKey: false },
  );

  const channelSchema = new Schema<ChannelDocument>(
    {
      id: { type: String, required: true, unique: true },
      telegramChannelId: { type: String, required: true },
      telegramChannelUsername: { type: String, default: null },
      telegramChannelUsernameLower: { type: String, required: true, index: true },
      title: { type: String, default: null },
      ownerUserId: { type: String, required: true, index: true },
      verificationCode: { type: String, default: null },
      verificationPostUrl: { type: String, default: null },
      verifiedAt: { type: Date, default: null },
      status: { type: String, enum: ['PENDING', 'VERIFIED', 'REJECTED'], required: true },
      createdAt: { type: Date, required: true },
      updatedAt: { type: Date, required: true },
    },
    { versionKey: false },
  );

  const campaignEnsEventSchema = new Schema<CampaignEnsEvent>(
    {
      name: { type: String, required: true },
      type: { type: String, enum: ['LOCKED', 'STARTED', 'COMPLETED', 'REFUNDED', 'VERIFIED'], required: true },
      txHash: { type: String, default: null },
      agentEnsName: { type: String, required: true },
      onchainCampaignId: { type: String, default: null },
      textRecords: { type: Schema.Types.Mixed, default: {} },
      createdAt: { type: Date, required: true },
    },
    { _id: false, versionKey: false },
  );

  const campaignSchema = new Schema<Campaign>(
    {
      id: { type: String, required: true, unique: true },
      onchainCampaignId: { type: String, default: null },
      advertiserUserId: { type: String, required: true, index: true },
      advertiserWalletAddress: { type: String, required: true },
      advertiserEnsName: { type: String, default: null },
      posterUserId: { type: String, default: null },
      posterWalletAddress: { type: String, default: null },
      posterEnsName: { type: String, default: null },
      channelId: { type: String, default: null },
      targetTelegramChannelUsername: { type: String, default: null },
      targetTelegramChannelId: { type: String, default: null },
      tokenAddress: { type: String, required: true },
      amount: { type: String, required: true },
      durationSeconds: { type: Number, required: true },
      requestedText: { type: String, default: null },
      requestedImageFileId: { type: String, default: null },
      requestedImageUrl: { type: String, default: null },
      requestedImageHash: { type: String, default: null },
      approvedText: { type: String, default: null },
      approvedImageHash: { type: String, default: null },
      submittedPostUrl: { type: String, default: null },
      submittedMessageId: { type: String, default: null },
      ensName: { type: String, default: null, index: true },
      ensLabel: { type: String, default: null },
      ensEvents: { type: [campaignEnsEventSchema], default: [] },
      status: {
        type: String,
        enum: [
          'DRAFT',
          'AWAITING_FUNDS',
          'FUNDED',
          'OFFERED',
          'NEGOTIATING',
          'ACCEPTED',
          'AWAITING_POST',
          'VERIFYING_POST',
          'ACTIVE',
          'COMPLETED',
          'REFUNDED',
          'CANCELLED',
          'REJECTED',
          'FAILED',
        ],
        required: true,
        index: true,
      },
      startsAt: { type: Date, default: null },
      endsAt: { type: Date, default: null },
      createdAt: { type: Date, required: true },
      updatedAt: { type: Date, required: true },
    },
    { versionKey: false },
  );

  const verificationCheckSchema = new Schema<VerificationCheck>(
    {
      id: { type: String, required: true, unique: true },
      campaignId: { type: String, required: true, index: true },
      type: { type: String, enum: ['INITIAL', 'RANDOM', 'ADVERTISER_REQUESTED', 'FINAL'], required: true },
      status: { type: String, enum: ['PASSED', 'FAILED'], required: true },
      reason: { type: String, default: null },
      checkedAt: { type: Date, required: true },
      rawResultJson: { type: Schema.Types.Mixed, default: null },
    },
    { versionKey: false },
  );

  verificationCheckSchema.index({ campaignId: 1, checkedAt: -1 });

  const devWalletSchema = new Schema<DevWallet>(
    {
      telegramUserId: { type: String, required: true, unique: true },
      address: { type: String, required: true },
      provider: { type: String, enum: ['local', 'dynamic'], required: true, default: 'local' },
      privateKey: { type: String, default: null },
      walletId: { type: String, default: null },
      createdAt: { type: Date, required: true },
    },
    { versionKey: false },
  );

  return {
    User: connection.model<UserDocument>('User', userSchema, 'users'),
    Channel: connection.model<ChannelDocument>('Channel', channelSchema, 'channels'),
    Campaign: connection.model<Campaign>('Campaign', campaignSchema, 'campaigns'),
    VerificationCheck: connection.model<VerificationCheck>('VerificationCheck', verificationCheckSchema, 'verificationChecks'),
    DevWallet: connection.model<DevWallet>('DevWallet', devWalletSchema, 'devWallets'),
  };
}

function toUser(user: UserDocument): User {
  return {
    id: user.id,
    telegramUserId: user.telegramUserId,
    telegramUsername: user.telegramUsername,
    walletAddress: user.walletAddress,
    ensName: user.ensName ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function toChannel(channel: ChannelDocument): Channel {
  return {
    id: channel.id,
    telegramChannelId: channel.telegramChannelId,
    telegramChannelUsername: channel.telegramChannelUsername,
    title: channel.title,
    ownerUserId: channel.ownerUserId,
    verificationCode: channel.verificationCode,
    verificationPostUrl: channel.verificationPostUrl,
    verifiedAt: channel.verifiedAt,
    status: channel.status,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
  };
}

function normalizeChannelUsername(value: string): string {
  return value.trim().replace(/^@/, '').toLowerCase();
}

function toCampaign(campaign: Campaign): Campaign {
  return {
    id: campaign.id,
    onchainCampaignId: campaign.onchainCampaignId,
    advertiserUserId: campaign.advertiserUserId,
    advertiserWalletAddress: campaign.advertiserWalletAddress,
    advertiserEnsName: campaign.advertiserEnsName ?? null,
    posterUserId: campaign.posterUserId,
    posterWalletAddress: campaign.posterWalletAddress,
    posterEnsName: campaign.posterEnsName ?? null,
    channelId: campaign.channelId,
    targetTelegramChannelUsername: campaign.targetTelegramChannelUsername,
    targetTelegramChannelId: campaign.targetTelegramChannelId,
    tokenAddress: campaign.tokenAddress,
    amount: campaign.amount,
    durationSeconds: campaign.durationSeconds,
    requestedText: campaign.requestedText,
    requestedImageFileId: campaign.requestedImageFileId,
    requestedImageUrl: campaign.requestedImageUrl,
    requestedImageHash: campaign.requestedImageHash,
    approvedText: campaign.approvedText,
    approvedImageHash: campaign.approvedImageHash,
    submittedPostUrl: campaign.submittedPostUrl,
    submittedMessageId: campaign.submittedMessageId,
    ensName: campaign.ensName ?? null,
    ensLabel: campaign.ensLabel ?? null,
    ensEvents: campaign.ensEvents ?? [],
    status: campaign.status,
    startsAt: campaign.startsAt,
    endsAt: campaign.endsAt,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
  };
}

function toDevWallet(wallet: DevWallet): DevWallet {
  return {
    telegramUserId: wallet.telegramUserId,
    address: wallet.address,
    provider: wallet.provider ?? 'local',
    privateKey: wallet.privateKey ?? null,
    walletId: wallet.walletId ?? null,
    createdAt: wallet.createdAt,
  };
}
