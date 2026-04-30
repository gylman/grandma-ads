import { User } from '../../domain/types';

export type UpsertUserInput = {
  walletAddress: string;
  telegramUserId?: string | null;
  telegramUsername?: string | null;
};

export interface UserRepository {
  upsert(input: UpsertUserInput): Promise<User>;
  findByWallet(walletAddress: string): Promise<User | null>;
}
