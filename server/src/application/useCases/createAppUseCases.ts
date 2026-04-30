import { checkContentSafety } from '../../domain/moderation';
import { CampaignStatus } from '../../domain/types';
import { extractCampaignIntake, generatePosterOffer } from '../services/agentService';
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
  blockchain: BlockchainGateway;
  devWallets: DevWalletRepository;
  devWalletGateway: DevWalletGateway;
}) {
  const { users, channels, campaigns, blockchain, devWallets, devWalletGateway } = dependencies;

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

    extractCampaignIntake(message: string) {
      return { intake: extractCampaignIntake(message), safety: checkContentSafety(message) };
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

    async listCampaigns() {
      return campaigns.list();
    },

    async getCampaign(campaignId: string) {
      return campaigns.findById(campaignId);
    },

    async advanceCampaign(campaignId: string, status: CampaignStatus) {
      return campaigns.advance(campaignId, status);
    },

    async generatePosterOffer(campaignId: string) {
      const campaign = await campaigns.findById(campaignId);
      if (!campaign) return null;
      return generatePosterOffer(campaign);
    },

    async submitPostForVerification(input: SubmitPostInput) {
      return campaigns.submitPostForVerification(input);
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
