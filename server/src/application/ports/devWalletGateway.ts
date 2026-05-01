import { DevWallet } from './devWalletRepository';

export type DevWalletBalance = {
  walletAddress: `0x${string}`;
  tokenBalance: bigint;
  escrowBalance: bigint;
};

export type DevFundCampaignResult = {
  onchainCampaignId: bigint;
  txHash: `0x${string}`;
};

export interface DevWalletGateway {
  generateWallet(telegramUserId: string): DevWallet;
  getBalance(wallet: DevWallet): Promise<DevWalletBalance>;
  mintMockUsdc(to: `0x${string}`, amount: bigint): Promise<`0x${string}`>;
  approveEscrow(wallet: DevWallet, amount: bigint): Promise<`0x${string}`>;
  deposit(wallet: DevWallet, amount: bigint): Promise<`0x${string}`>;
  withdraw(wallet: DevWallet, amount: bigint): Promise<`0x${string}`>;
  createCampaignFromBalance(
    wallet: DevWallet,
    input: { posterWalletAddress: `0x${string}`; amount: bigint; durationSeconds: bigint },
  ): Promise<DevFundCampaignResult>;
}
