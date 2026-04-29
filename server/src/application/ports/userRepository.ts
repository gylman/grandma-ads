import { User } from '../../domain/types';

export type UpsertUserInput = {
  walletAddress: string;
  telegramUserId?: string | null;
  telegramUsername?: string | null;
};

export interface UserRepository {
  upsert(input: UpsertUserInput): User;
  findByWallet(walletAddress: string): User | null;
}
