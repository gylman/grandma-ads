import 'dotenv/config';

export type AppConfig = {
  port: number;
  clientUrl: string;
  serverUrl: string;
  persistenceMode: 'inmemory' | 'mongodb';
  databaseUrl: string;
  databaseName: string;
  rpcUrl: string;
  chainId: number;
  escrowContractAddress: string;
  usdcTokenAddress: string;
  usdtTokenAddress: string;
  daiTokenAddress: string;
  wbtcTokenAddress: string;
  verifierPrivateKey: string;
  telegramBotToken: string;
  telegramBotMode: 'off' | 'polling';
  custodialDevMode: boolean;
  devWalletMinterPrivateKey: string;
  devWalletEthTopUpAmount: bigint;
  dynamicEnvironmentId: string;
  dynamicAuthToken: string;
  openaiApiKey: string;
  openaiModel: string;
};

export const config: AppConfig = {
  port: Number(process.env.PORT ?? 3001),
  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5173',
  serverUrl: process.env.SERVER_URL ?? 'http://localhost:3001',
  persistenceMode: parsePersistenceMode(process.env.PERSISTENCE_MODE),
  databaseUrl: process.env.DATABASE_URL ?? '',
  databaseName: process.env.DATABASE_NAME ?? 'grandma_ads',
  rpcUrl: process.env.RPC_URL ?? '',
  chainId: Number(process.env.CHAIN_ID ?? 31337),
  escrowContractAddress: process.env.ESCROW_CONTRACT_ADDRESS ?? '',
  usdcTokenAddress: process.env.USDC_TOKEN_ADDRESS ?? '',
  usdtTokenAddress: process.env.USDT_TOKEN_ADDRESS ?? '',
  daiTokenAddress: process.env.DAI_TOKEN_ADDRESS ?? '',
  wbtcTokenAddress: process.env.WBTC_TOKEN_ADDRESS ?? '',
  verifierPrivateKey: process.env.VERIFIER_PRIVATE_KEY ?? '',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramBotMode: parseTelegramBotMode(process.env.TELEGRAM_BOT_MODE, process.env.TELEGRAM_BOT_TOKEN),
  custodialDevMode: process.env.CUSTODIAL_DEV_MODE === 'true',
  devWalletMinterPrivateKey: process.env.DEV_WALLET_MINTER_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY ?? '',
  devWalletEthTopUpAmount: parseEthAmount(process.env.DEV_WALLET_ETH_TOP_UP_AMOUNT ?? '0.05'),
  dynamicEnvironmentId: process.env.DYNAMIC_ENV_ID ?? process.env.ENV_ID ?? '',
  dynamicAuthToken: process.env.DYNAMIC_AUTH_TOKEN ?? process.env.AUTH_TOKEN ?? '',
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
};

function parseTelegramBotMode(mode: string | undefined, token: string | undefined): AppConfig['telegramBotMode'] {
  if (mode === 'off' || mode === 'polling') return mode;
  return token ? 'polling' : 'off';
}

function parsePersistenceMode(mode: string | undefined): AppConfig['persistenceMode'] {
  if (mode === 'mongodb') return 'mongodb';
  return 'inmemory';
}

function parseEthAmount(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  const paddedFraction = fraction.padEnd(18, '0').slice(0, 18);
  return BigInt(whole || '0') * 10n ** 18n + BigInt(paddedFraction || '0');
}
