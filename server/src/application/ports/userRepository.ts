import { User } from '../../domain/types';

export type UpsertUserInput = {
  walletAddress: string;
  telegramUserId?: string | null;
  telegramUsername?: string | null;
};

export interface UserRepository {
  upsert(input: UpsertUserInput): Promise<User>;
  findById(userId: string): Promise<User | null>;
  findByWallet(walletAddress: string): Promise<User | null>;
  findByTelegramUserId(telegramUserId: string): Promise<User | null>;
  deleteByTelegramUserId(telegramUserId: string): Promise<void>;
}
