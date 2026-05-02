export type DevWallet = {
  telegramUserId: string;
  address: `0x${string}`;
  provider: 'local' | 'dynamic';
  privateKey: `0x${string}` | null;
  walletId: string | null;
  createdAt: Date;
};

export interface DevWalletRepository {
  findByTelegramUserId(telegramUserId: string): Promise<DevWallet | null>;
  save(wallet: DevWallet): Promise<DevWallet>;
}
