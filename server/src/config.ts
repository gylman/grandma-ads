export type AppConfig = {
  port: number;
  clientUrl: string;
  serverUrl: string;
  escrowContractAddress: string;
  usdcTokenAddress: string;
};

export const config: AppConfig = {
  port: Number(process.env.PORT ?? 3000),
  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5173',
  serverUrl: process.env.SERVER_URL ?? 'http://localhost:3000',
  escrowContractAddress: process.env.ESCROW_CONTRACT_ADDRESS ?? '',
  usdcTokenAddress: process.env.USDC_TOKEN_ADDRESS ?? '',
};
