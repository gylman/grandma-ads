import { Channel, ChannelStatus } from '../../domain/types';

export type RegisterChannelInput = {
  ownerUserId: string;
  telegramChannelUsername: string;
  title?: string | null;
};

export interface ChannelRepository {
  register(input: RegisterChannelInput): Channel;
  updateStatus(channelId: string, status: ChannelStatus, verificationPostUrl?: string): Channel;
  list(ownerUserId?: string): Channel[];
}
