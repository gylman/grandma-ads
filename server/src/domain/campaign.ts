import { Campaign, CampaignStatus } from './types';

const transitions: Record<CampaignStatus, CampaignStatus[]> = {
  DRAFT: ['AWAITING_FUNDS', 'CANCELLED'],
  AWAITING_FUNDS: ['FUNDED', 'CANCELLED'],
  FUNDED: ['OFFERED', 'CANCELLED', 'REFUNDED'],
  OFFERED: ['ACCEPTED', 'REJECTED', 'NEGOTIATING', 'CANCELLED'],
  NEGOTIATING: ['ACCEPTED', 'REJECTED', 'OFFERED', 'CANCELLED'],
  ACCEPTED: ['AWAITING_POST', 'CANCELLED'],
  AWAITING_POST: ['VERIFYING_POST', 'FAILED', 'CANCELLED'],
  VERIFYING_POST: ['ACTIVE', 'AWAITING_POST', 'FAILED', 'REFUNDED'],
  ACTIVE: ['COMPLETED', 'REFUNDED', 'FAILED'],
  COMPLETED: [],
  REFUNDED: [],
  CANCELLED: [],
  REJECTED: [],
  FAILED: ['REFUNDED'],
};

export function canTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  return transitions[from].includes(to);
}

export function transitionCampaign(campaign: Campaign, nextStatus: CampaignStatus, now = new Date()): Campaign {
  if (!canTransition(campaign.status, nextStatus)) {
    throw new Error(`Invalid campaign transition from ${campaign.status} to ${nextStatus}`);
  }

  const updates: Partial<Campaign> = { status: nextStatus, updatedAt: now };

  if (nextStatus === 'ACTIVE') {
    updates.startsAt = now;
    updates.endsAt = new Date(now.getTime() + campaign.durationSeconds * 1000);
  }

  return { ...campaign, ...updates };
}

export function createCampaign(input: {
  id: string;
  advertiserUserId: string;
  advertiserWalletAddress: string;
  posterUserId?: string | null;
  posterWalletAddress?: string | null;
  channelId?: string | null;
  tokenAddress: string;
  amount: string;
  durationSeconds: number;
  targetTelegramChannelUsername?: string | null;
  requestedText?: string | null;
  requestedImageUrl?: string | null;
  requestedImageHash?: string | null;
  now?: Date;
}): Campaign {
  const now = input.now ?? new Date();

  return {
    id: input.id,
    onchainCampaignId: null,
    advertiserUserId: input.advertiserUserId,
    advertiserWalletAddress: input.advertiserWalletAddress,
    posterUserId: input.posterUserId ?? null,
    posterWalletAddress: input.posterWalletAddress ?? null,
    channelId: input.channelId ?? null,
    targetTelegramChannelUsername: input.targetTelegramChannelUsername ?? null,
    targetTelegramChannelId: null,
    tokenAddress: input.tokenAddress,
    amount: input.amount,
    durationSeconds: input.durationSeconds,
    requestedText: input.requestedText ?? null,
    requestedImageFileId: null,
    requestedImageUrl: input.requestedImageUrl ?? null,
    requestedImageHash: input.requestedImageHash ?? null,
    approvedText: input.requestedText ?? null,
    approvedImageHash: input.requestedImageHash ?? null,
    submittedPostUrl: null,
    submittedMessageId: null,
    status: 'DRAFT',
    startsAt: null,
    endsAt: null,
    createdAt: now,
    updatedAt: now,
  };
}
