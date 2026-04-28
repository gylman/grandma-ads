import { createCampaign, transitionCampaign } from '../domain/campaign';
import { Channel, ChannelStatus, User, VerificationCheck, VerificationType } from '../domain/types';
import { verifyPostSnapshot } from '../domain/verification';

let nextId = 1;

const users = new Map<string, User>();
const channels = new Map<string, Channel>();
const campaigns = new Map<string, ReturnType<typeof createCampaign>>();
const verificationChecks = new Map<string, VerificationCheck>();

function id(prefix: string): string {
  return `${prefix}_${nextId++}`;
}

export function upsertUser(input: {
  walletAddress: string;
  telegramUserId?: string | null;
  telegramUsername?: string | null;
}): User {
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
}

export function getUserByWallet(walletAddress: string): User | null {
  return [...users.values()].find((user) => user.walletAddress.toLowerCase() === walletAddress.toLowerCase()) ?? null;
}

export function registerChannel(input: {
  ownerUserId: string;
  telegramChannelUsername: string;
  title?: string | null;
}): Channel {
  const now = new Date();
  const shortOwner = input.ownerUserId.replace(/\W/g, '').slice(-6).toUpperCase();
  const channel: Channel = {
    id: id('chn'),
    telegramChannelId: input.telegramChannelUsername,
    telegramChannelUsername: input.telegramChannelUsername.replace(/^@/, ''),
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
  return channel;
}

export function updateChannelStatus(channelId: string, status: ChannelStatus, verificationPostUrl?: string): Channel {
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
}

export function listChannels(ownerUserId?: string): Channel[] {
  const list = [...channels.values()];
  return ownerUserId ? list.filter((channel) => channel.ownerUserId === ownerUserId) : list;
}

export function createDraftCampaign(input: Parameters<typeof createCampaign>[0]) {
  const campaign = createCampaign({ ...input, id: id('cmp') });
  campaigns.set(campaign.id, campaign);
  return campaign;
}

export function listCampaigns() {
  return [...campaigns.values()];
}

export function getCampaign(campaignId: string) {
  return campaigns.get(campaignId) ?? null;
}

export function advanceCampaign(campaignId: string, nextStatus: Parameters<typeof transitionCampaign>[1]) {
  const campaign = campaigns.get(campaignId);
  if (!campaign) throw new Error('Campaign not found');

  const updated = transitionCampaign(campaign, nextStatus);
  campaigns.set(campaignId, updated);
  return updated;
}

export function submitPostForVerification(input: {
  campaignId: string;
  submittedPostUrl: string;
  observedText?: string | null;
  observedImageHash?: string | null;
  type?: VerificationType;
}) {
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
}
