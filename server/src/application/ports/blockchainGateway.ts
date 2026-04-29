export type BalanceSnapshot = {
  walletAddress: string;
  tokenAddress: string;
  available: string;
  locked: string;
  pendingEarnings: string;
  source: 'contract' | 'not-configured';
};

export type CreateOnchainCampaignInput = {
  advertiserWalletAddress: `0x${string}`;
  posterWalletAddress: `0x${string}`;
  tokenAddress: `0x${string}`;
  amount: bigint;
  durationSeconds: bigint;
};

export interface BlockchainGateway {
  getBalance(walletAddress: string, tokenAddress?: string): Promise<BalanceSnapshot>;
  createCampaignFromBalance(input: CreateOnchainCampaignInput): Promise<`0x${string}`>;
  startCampaign(campaignId: bigint): Promise<`0x${string}`>;
  completeCampaign(campaignId: bigint): Promise<`0x${string}`>;
  refundCampaign(campaignId: bigint): Promise<`0x${string}`>;
}
