export type AppConfig = {
  port: number;
  clientUrl: string;
  serverUrl: string;
  rpcUrl: string;
  chainId: number;
  escrowContractAddress: string;
  usdcTokenAddress: string;
  verifierPrivateKey: string;
};

export const config: AppConfig = {
  port: Number(process.env.PORT ?? 3001),
  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5173',
  serverUrl: process.env.SERVER_URL ?? 'http://localhost:3001',
  rpcUrl: process.env.RPC_URL ?? '',
  chainId: Number(process.env.CHAIN_ID ?? 31337),
  escrowContractAddress: process.env.ESCROW_CONTRACT_ADDRESS ?? '',
  usdcTokenAddress: process.env.USDC_TOKEN_ADDRESS ?? '',
  verifierPrivateKey: process.env.VERIFIER_PRIVATE_KEY ?? '',
};
