import { Campaign, CampaignIntakeResult, SafetyResult } from '../../domain/types';

export type CampaignDraftRecommendation = {
  intake: CampaignIntakeResult;
  safety: SafetyResult;
  recommendedAdText: string;
  summary: string;
};

export type AdCopySuggestion = {
  text: string;
  rationale: string;
};

export type CounterOfferSuggestion = {
  reply: string;
  suggestedAmount: string | null;
  suggestedDurationSeconds: number | null;
};

export interface AgentGateway {
  analyzeCampaignRequest(message: string): Promise<CampaignDraftRecommendation>;
  suggestAdCopy(input: { campaign: Campaign; instruction?: string | null }): Promise<AdCopySuggestion>;
  generatePosterOffer(campaign: Campaign): Promise<string>;
  suggestCounterReply(input: { campaign: Campaign; counterMessage: string }): Promise<CounterOfferSuggestion>;
}
