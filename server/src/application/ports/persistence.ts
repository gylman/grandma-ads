import { CampaignRepository } from './campaignRepository';
import { ChannelRepository } from './channelRepository';
import { DevWalletRepository } from './devWalletRepository';
import { UserRepository } from './userRepository';

export type RepositoryPorts = {
  users: UserRepository;
  channels: ChannelRepository;
  campaigns: CampaignRepository;
  devWallets: DevWalletRepository;
};

export interface PersistenceAdapterPort {
  repositories: RepositoryPorts;
  close(): Promise<void>;
}
