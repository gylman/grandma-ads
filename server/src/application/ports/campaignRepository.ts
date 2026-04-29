import { Campaign, CampaignStatus, VerificationCheck, VerificationType } from '../../domain/types';

export type CreateDraftCampaignInput = {
  advertiserUserId: string;
  advertiserWalletAddress: string;
  tokenAddress: string;
  amount: string;
  durationSeconds: number;
  targetTelegramChannelUsername?: string | null;
  requestedText?: string | null;
  requestedImageUrl?: string | null;
  requestedImageHash?: string | null;
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

export interface CampaignRepository {
  createDraft(input: CreateDraftCampaignInput): Campaign;
  list(): Campaign[];
  findById(campaignId: string): Campaign | null;
  advance(campaignId: string, nextStatus: CampaignStatus): Campaign;
  submitPostForVerification(input: SubmitPostInput): SubmitPostOutput;
}
