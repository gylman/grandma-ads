import { Campaign, CampaignStatus, VerificationCheck, VerificationType } from '../../domain/types';

export type CreateDraftCampaignInput = {
  id?: string;
  advertiserUserId: string;
  advertiserWalletAddress: string;
  advertiserEnsName?: string | null;
  posterUserId?: string | null;
  posterWalletAddress?: string | null;
  posterEnsName?: string | null;
  channelId?: string | null;
  tokenAddress: string;
  amount: string;
  durationSeconds: number;
  targetTelegramChannelUsername?: string | null;
  requestedText?: string | null;
  requestedImageFileId?: string | null;
  requestedImageUrl?: string | null;
  requestedImageHash?: string | null;
  ensName?: string | null;
  ensLabel?: string | null;
};

export type SubmitPostInput = {
  campaignId: string;
  submittedPostUrl: string;
  observedText?: string | null;
  observedImageHash?: string | null;
  type?: VerificationType;
};

export type SubmitPostOutput = {
  check: VerificationCheck;
  result: unknown;
};

export type PatchCampaignInput = Partial<Omit<Campaign, 'id' | 'createdAt'>>;

export interface CampaignRepository {
  createDraft(input: CreateDraftCampaignInput): Promise<Campaign>;
  list(): Promise<Campaign[]>;
  listByPosterWalletAndStatus(posterWalletAddress: string, status: CampaignStatus): Promise<Campaign[]>;
  findBySubmittedPost(
    channelUsername: string,
    messageId: string,
    statuses: CampaignStatus[],
  ): Promise<Campaign | null>;
  findById(campaignId: string): Promise<Campaign | null>;
  patch(campaignId: string, patch: PatchCampaignInput): Promise<Campaign>;
  advance(campaignId: string, nextStatus: CampaignStatus): Promise<Campaign>;
  submitPostForVerification(input: SubmitPostInput): Promise<SubmitPostOutput>;
  deleteByParticipant(input: {
    advertiserUserId?: string;
    advertiserWalletAddress?: string;
    posterUserId?: string;
    posterWalletAddress?: string;
  }): Promise<void>;
}
