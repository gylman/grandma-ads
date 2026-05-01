import { Channel, ChannelStatus } from '../../domain/types';

export type RegisterChannelInput = {
  ownerUserId: string;
  telegramChannelUsername: string;
  title?: string | null;
};

export type RegisterChannelOutcome = {
  channel: Channel;
  status: 'CREATED' | 'PENDING_EXISTS' | 'ALREADY_VERIFIED';
};

export interface ChannelRepository {
  register(input: RegisterChannelInput): Promise<RegisterChannelOutcome>;
  findVerifiedByUsername(telegramChannelUsername: string): Promise<Channel | null>;
  updateStatus(channelId: string, status: ChannelStatus, verificationPostUrl?: string): Promise<Channel>;
  list(ownerUserId?: string): Promise<Channel[]>;
}
