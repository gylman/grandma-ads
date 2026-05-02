export type ChannelStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export type CampaignStatus =
  | 'DRAFT'
  | 'AWAITING_FUNDS'
  | 'FUNDED'
  | 'OFFERED'
  | 'NEGOTIATING'
  | 'ACCEPTED'
  | 'AWAITING_POST'
  | 'VERIFYING_POST'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'REFUNDED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'FAILED';

export type VerificationType = 'INITIAL' | 'RANDOM' | 'ADVERTISER_REQUESTED' | 'FINAL';
export type VerificationStatus = 'PASSED' | 'FAILED';
export type OfferRole = 'ADVERTISER' | 'POSTER' | 'AGENT';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type CampaignEnsEventType = 'LOCKED' | 'STARTED' | 'COMPLETED' | 'REFUNDED' | 'VERIFIED';

export type CampaignEnsEvent = {
  name: string;
  type: CampaignEnsEventType;
  txHash: string | null;
  agentEnsName: string;
  onchainCampaignId: string | null;
  textRecords: Record<string, string>;
  createdAt: Date;
};

export type User = {
  id: string;
  telegramUserId: string | null;
  telegramUsername: string | null;
  walletAddress: string;
  ensName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type Channel = {
  id: string;
  telegramChannelId: string;
  telegramChannelUsername: string | null;
  title: string | null;
  ownerUserId: string;
  verificationCode: string | null;
  verificationPostUrl: string | null;
  verifiedAt: Date | null;
  status: ChannelStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type Campaign = {
  id: string;
  onchainCampaignId: string | null;
  advertiserUserId: string;
  advertiserWalletAddress: string;
  posterUserId: string | null;
  posterWalletAddress: string | null;
  channelId: string | null;
  targetTelegramChannelUsername: string | null;
  targetTelegramChannelId: string | null;
  tokenAddress: string;
  amount: string;
  durationSeconds: number;
  requestedText: string | null;
  requestedImageFileId: string | null;
  requestedImageUrl: string | null;
  requestedImageHash: string | null;
  approvedText: string | null;
  approvedImageHash: string | null;
  submittedPostUrl: string | null;
  submittedMessageId: string | null;
  ensName: string | null;
  ensLabel: string | null;
  advertiserEnsName: string | null;
  posterEnsName: string | null;
  ensEvents: CampaignEnsEvent[];
  status: CampaignStatus;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type VerificationCheck = {
  id: string;
  campaignId: string;
  type: VerificationType;
  status: VerificationStatus;
  reason: string | null;
  checkedAt: Date;
  rawResultJson: unknown;
};

export type OfferMessage = {
  id: string;
  campaignId: string;
  fromUserId: string;
  toUserId: string;
  role: OfferRole;
  message: string;
  structuredPayloadJson: unknown;
  createdAt: Date;
};

export type AgentAction =
  | { type: 'ASK_MISSING_INFO'; question: string }
  | { type: 'SUGGEST_AD_COPY'; text: string }
  | { type: 'FLAG_CONTENT_RISK'; reasons: string[] }
  | { type: 'GENERATE_POSTER_OFFER'; message: string }
  | { type: 'PROPOSE_COUNTER_OFFER'; amount: string; durationSeconds: number }
  | { type: 'REQUEST_POST_FIX'; reason: string }
  | { type: 'SUMMARIZE_STATUS'; message: string };

export type CampaignIntakeResult = {
  targetChannel?: string;
  amount?: string;
  tokenSymbol?: string;
  durationSeconds?: number;
  adText?: string;
  missingFields: string[];
};

export type SafetyResult = {
  allowed: boolean;
  riskLevel: RiskLevel;
  reasons: string[];
  suggestedFixes: string[];
};
