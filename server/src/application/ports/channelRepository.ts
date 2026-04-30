import { Channel, ChannelStatus } from '../../domain/types';

export type RegisterChannelInput = {
  ownerUserId: string;
  telegramChannelUsername: string;
  title?: string | null;
};

export interface ChannelRepository {
  register(input: RegisterChannelInput): Promise<Channel>;
  updateStatus(channelId: string, status: ChannelStatus, verificationPostUrl?: string): Promise<Channel>;
  list(ownerUserId?: string): Promise<Channel[]>;
}
