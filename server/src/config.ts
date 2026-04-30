import 'dotenv/config';

export type AppConfig = {
  port: number;
  clientUrl: string;
  serverUrl: string;
  rpcUrl: string;
  chainId: number;
  escrowContractAddress: string;
  usdcTokenAddress: string;
  verifierPrivateKey: string;
  telegramBotToken: string;
  telegramBotMode: 'off' | 'polling';
  custodialDevMode: boolean;
  devWalletMinterPrivateKey: string;
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
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramBotMode: parseTelegramBotMode(process.env.TELEGRAM_BOT_MODE, process.env.TELEGRAM_BOT_TOKEN),
  custodialDevMode: process.env.CUSTODIAL_DEV_MODE === 'true',
  devWalletMinterPrivateKey: process.env.DEV_WALLET_MINTER_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY ?? '',
};

function parseTelegramBotMode(mode: string | undefined, token: string | undefined): AppConfig['telegramBotMode'] {
  if (mode === 'off' || mode === 'polling') return mode;
  return token ? 'polling' : 'off';
}
