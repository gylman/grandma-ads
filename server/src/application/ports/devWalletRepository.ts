export type DevWallet = {
  telegramUserId: string;
  address: `0x${string}`;
  privateKey: `0x${string}`;
  createdAt: Date;
};

export interface DevWalletRepository {
  findByTelegramUserId(telegramUserId: string): Promise<DevWallet | null>;
  save(wallet: DevWallet): Promise<DevWallet>;
}
