export const appConfig = {
  chainId: import.meta.env.VITE_CHAIN_ID ?? '',
  rpcUrl: import.meta.env.VITE_RPC_URL ?? '',
  escrowContractAddress: import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS ?? '',
  usdcTokenAddress: import.meta.env.VITE_USDC_TOKEN_ADDRESS ?? '',
  serverUrl: import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001',
  telegramBotUsername: import.meta.env.VITE_TELEGRAM_BOT_USERNAME ?? '',
};
