import { DevWallet } from './devWalletRepository';

export type DevWalletBalance = {
  walletAddress: `0x${string}`;
  tokenBalance: bigint;
  escrowBalance: bigint;
};

export type DevTokenBalance = {
  symbol: string;
  address: `0x${string}` | null;
  decimals: number;
  walletBalance: bigint;
  escrowBalance: bigint | null;
  isNative: boolean;
};

export type DevFundCampaignResult = {
  onchainCampaignId: bigint;
  txHash: `0x${string}`;
};

export interface DevWalletGateway {
  createWallet(telegramUserId: string): Promise<DevWallet>;
  signMessage(wallet: DevWallet, message: string): Promise<`0x${string}`>;
  getBalance(wallet: DevWallet): Promise<DevWalletBalance>;
  getMajorBalances(wallet: DevWallet): Promise<DevTokenBalance[]>;
  mintMockUsdc(to: `0x${string}`, amount: bigint): Promise<`0x${string}`>;
  approveEscrow(wallet: DevWallet, amount: bigint): Promise<`0x${string}`>;
  deposit(wallet: DevWallet, amount: bigint): Promise<`0x${string}`>;
  withdraw(wallet: DevWallet, amount: bigint): Promise<`0x${string}`>;
  createCampaignFromBalance(
    wallet: DevWallet,
    input: { posterWalletAddress: `0x${string}`; tokenAddress: `0x${string}`; amount: bigint; durationSeconds: bigint },
  ): Promise<DevFundCampaignResult>;
}
