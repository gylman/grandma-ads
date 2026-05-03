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

export type CreateCampaignAuthorization = {
  advertiser: `0x${string}`;
  poster: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  durationSeconds: bigint;
  nonce: bigint;
  deadline: bigint;
};

export type WithdrawAuthorization = {
  user: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  recipient: `0x${string}`;
  nonce: bigint;
  deadline: bigint;
};

export type TokenPermitAuthorization = {
  owner: `0x${string}`;
  spender: `0x${string}`;
  value: bigint;
  nonce: bigint;
  deadline: bigint;
};

export interface DevWalletGateway {
  createWallet(telegramUserId: string): Promise<DevWallet>;
  signMessage(wallet: DevWallet, message: string): Promise<`0x${string}`>;
  signTokenPermitAuthorization(
    wallet: DevWallet,
    input: {
      tokenAddress: `0x${string}`;
      tokenName: string;
      chainId: number;
      authorization: TokenPermitAuthorization;
    },
  ): Promise<`0x${string}`>;
  signCreateCampaignAuthorization(
    wallet: DevWallet,
    input: {
      verifyingContract: `0x${string}`;
      chainId: number;
      authorization: CreateCampaignAuthorization;
    },
  ): Promise<`0x${string}`>;
  signWithdrawAuthorization(
    wallet: DevWallet,
    input: {
      verifyingContract: `0x${string}`;
      chainId: number;
      authorization: WithdrawAuthorization;
    },
  ): Promise<`0x${string}`>;
  getBalance(wallet: DevWallet): Promise<DevWalletBalance>;
  getMajorBalances(wallet: DevWallet): Promise<DevTokenBalance[]>;
  mintMockToken(tokenAddress: `0x${string}`, to: `0x${string}`, amount: bigint): Promise<`0x${string}`>;
  approveEscrow(wallet: DevWallet, tokenAddress: `0x${string}`, amount: bigint): Promise<`0x${string}`>;
  deposit(wallet: DevWallet, tokenAddress: `0x${string}`, amount: bigint): Promise<`0x${string}`>;
  createCampaignFromBalance(
    wallet: DevWallet,
    input: { posterWalletAddress: `0x${string}`; tokenAddress: `0x${string}`; amount: bigint; durationSeconds: bigint },
  ): Promise<DevFundCampaignResult>;
}
