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

export type CreateOnchainCampaignBySigInput = CreateOnchainCampaignInput & {
  nonce: bigint;
  deadline: bigint;
  signature: `0x${string}`;
};

export type RelayedCampaignResult = {
  onchainCampaignId: bigint;
  txHash: `0x${string}`;
};

export type DepositWithPermitInput = {
  ownerWalletAddress: `0x${string}`;
  tokenAddress: `0x${string}`;
  amount: bigint;
  deadline: bigint;
  signature: `0x${string}`;
};

export type WithdrawBySigInput = {
  userWalletAddress: `0x${string}`;
  tokenAddress: `0x${string}`;
  amount: bigint;
  recipientWalletAddress: `0x${string}`;
  deadline: bigint;
  signature: `0x${string}`;
};

export interface BlockchainGateway {
  getBalance(walletAddress: string, tokenAddress?: string): Promise<BalanceSnapshot>;
  getCampaignNonce(walletAddress: `0x${string}`): Promise<bigint>;
  getTokenPermitNonce(tokenAddress: `0x${string}`, walletAddress: `0x${string}`): Promise<bigint>;
  depositWithPermit(input: DepositWithPermitInput): Promise<`0x${string}`>;
  withdrawBySig(input: WithdrawBySigInput): Promise<`0x${string}`>;
  createCampaignFromBalance(input: CreateOnchainCampaignInput): Promise<`0x${string}`>;
  createCampaignFromBalanceBySig(input: CreateOnchainCampaignBySigInput): Promise<RelayedCampaignResult>;
  startCampaign(campaignId: bigint): Promise<`0x${string}`>;
  completeCampaign(campaignId: bigint): Promise<`0x${string}`>;
  refundCampaign(campaignId: bigint): Promise<`0x${string}`>;
}
