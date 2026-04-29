import { checkContentSafety } from '../../domain/moderation';
import { CampaignStatus } from '../../domain/types';
import { extractCampaignIntake, generatePosterOffer } from '../services/agentService';
import { BlockchainGateway } from '../ports/blockchainGateway';
import { CampaignRepository, CreateDraftCampaignInput, SubmitPostInput } from '../ports/campaignRepository';
import { ChannelRepository, RegisterChannelInput } from '../ports/channelRepository';
import { UpsertUserInput, UserRepository } from '../ports/userRepository';

export type AppUseCases = ReturnType<typeof createAppUseCases>;

export function createAppUseCases(dependencies: {
  users: UserRepository;
  channels: ChannelRepository;
  campaigns: CampaignRepository;
  blockchain: BlockchainGateway;
}) {
  const { users, channels, campaigns, blockchain } = dependencies;

  return {
    health() {
      return { ok: true, service: 'grandma-ads-server' };
    },

    upsertUser(input: UpsertUserInput) {
      return users.upsert(input);
    },

    getUserByWallet(walletAddress: string) {
      return users.findByWallet(walletAddress);
    },

    getBalance(walletAddress: string, tokenAddress?: string) {
      return blockchain.getBalance(walletAddress, tokenAddress);
    },

    registerChannel(input: RegisterChannelInput) {
      return channels.register(input);
    },

    listChannels(ownerUserId?: string) {
      return channels.list(ownerUserId);
    },

    verifyChannel(channelId: string, postUrl?: string) {
      return channels.updateStatus(channelId, 'VERIFIED', postUrl);
    },

    extractCampaignIntake(message: string) {
      return { intake: extractCampaignIntake(message), safety: checkContentSafety(message) };
    },

    createDraftCampaign(input: CreateDraftCampaignInput) {
      const safety = checkContentSafety(input.requestedText);
      if (!safety.allowed) {
        const error = new Error('Campaign content is blocked');
        error.name = 'ContentBlockedError';
        throw error;
      }

      return campaigns.createDraft(input);
    },

    listCampaigns() {
      return campaigns.list();
    },

    getCampaign(campaignId: string) {
      return campaigns.findById(campaignId);
    },

    advanceCampaign(campaignId: string, status: CampaignStatus) {
      return campaigns.advance(campaignId, status);
    },

    generatePosterOffer(campaignId: string) {
      const campaign = campaigns.findById(campaignId);
      if (!campaign) return null;
      return generatePosterOffer(campaign);
    },

    submitPostForVerification(input: SubmitPostInput) {
      return campaigns.submitPostForVerification(input);
    },
  };
}
