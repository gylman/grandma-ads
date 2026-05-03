import { Campaign, CampaignEnsEvent, CampaignEnsEventType, User } from './types';

export type EnsAgentRole = 'intaker' | 'negotiator' | 'verifier' | 'safety-manager' | 'translator';

export type EnsIdentity = {
  name: string;
  address: string | null;
  textRecords: Record<string, string>;
};

export type CampaignEnsIdentity = {
  id: string;
  ensLabel: string;
  ensName: string;
};

const agentDescriptions: Record<EnsAgentRole, string> = {
  intaker: 'Turns messy campaign requests into structured sponsored-post drafts.',
  negotiator: 'Drafts bounded counteroffers between advertisers and channel publishers.',
  verifier: 'Checks published Telegram posts and triggers escrow lifecycle calls.',
  'safety-manager': 'Reviews ad content for blocked categories before offers are sent.',
  translator: 'Prepares future multilingual campaign and negotiation copy.',
};

export function normalizeEnsLabel(value: string | null | undefined, fallback = 'unnamed'): string {
  const label = (value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return label || fallback;
}

export function compactEnsLabel(value: string | null | undefined, maxLength: number): string {
  const label = normalizeEnsLabel(value, 'user');
  if (label.length <= maxLength) return label;
  return label.slice(0, maxLength).replace(/-+$/g, '') || 'user';
}

export function createUserEnsName(input: {
  rootName: string;
  telegramUsername?: string | null;
  walletAddress: string;
}): string {
  const fallback = `wallet-${input.walletAddress.slice(2, 10).toLowerCase()}`;
  const label = normalizeEnsLabel(input.telegramUsername, fallback);
  return `${label}.user.${input.rootName}`;
}

export function createCampaignEnsIdentity(input: {
  rootName: string;
  userEnsName: string | null | undefined;
  telegramUsername?: string | null;
  now?: Date;
}): CampaignEnsIdentity {
  const now = input.now ?? new Date();
  const userName = input.userEnsName ?? createUserEnsName({
    rootName: input.rootName,
    telegramUsername: input.telegramUsername,
    walletAddress: '0x0000000000000000000000000000000000000000',
  });
  const userLabel = compactEnsLabel(userName.split('.')[0], 12);
  const stamp = formatCampaignStamp(now);
  const id = `cmp_${userLabel}_${stamp}`;
  const ensLabel = normalizeEnsLabel(id);
  return {
    id,
    ensLabel,
    ensName: `${ensLabel}.campaigns.${userName}`,
  };
}

export function createOnchainAdEnsIdentity(input: {
  rootName: string;
  onchainCampaignId: string | number | bigint;
}): CampaignEnsIdentity {
  const normalizedId = String(input.onchainCampaignId);
  return {
    id: `ad_${normalizedId}`,
    ensLabel: normalizedId,
    ensName: `${normalizedId}.ad.${input.rootName}`,
  };
}

export function createCampaignEnsEvent(input: {
  campaign: Campaign;
  type: CampaignEnsEventType;
  txHash?: string | null;
  agentEnsName: string;
  now?: Date;
}): CampaignEnsEvent {
  const now = input.now ?? new Date();
  const baseName = input.campaign.ensName ?? `${normalizeEnsLabel(input.campaign.id)}.campaigns.unknown`;
  const eventLabel = normalizeEnsLabel(input.type.toLowerCase());

  return {
    name: `${eventLabel}.${baseName}`,
    type: input.type,
    txHash: input.txHash ?? null,
    agentEnsName: input.agentEnsName,
    onchainCampaignId: input.campaign.onchainCampaignId,
    createdAt: now,
    textRecords: {
      'com.ethy-ads.kind': 'campaign-event',
      'com.ethy-ads.event': input.type,
      'com.ethy-ads.campaign': input.campaign.ensName ?? input.campaign.id,
      'com.ethy-ads.campaign-id': input.campaign.id,
      'com.ethy-ads.onchain-campaign-id': input.campaign.onchainCampaignId ?? '',
      'com.ethy-ads.tx-hash': input.txHash ?? '',
      'com.ethy-ads.agent': input.agentEnsName,
      'com.ethy-ads.timestamp': now.toISOString(),
    },
  };
}

export function createAgentEnsIdentities(rootName: string, address: string | null): EnsIdentity[] {
  return (Object.keys(agentDescriptions) as EnsAgentRole[]).map((role) => ({
    name: `${role}.${rootName}`,
    address,
    textRecords: {
      'com.ethy-ads.kind': 'ai-agent',
      'com.ethy-ads.role': role,
      description: agentDescriptions[role],
      url: '',
    },
  }));
}

export function createUserEnsIdentity(user: User): EnsIdentity | null {
  if (!user.ensName) return null;

  return {
    name: user.ensName,
    address: user.walletAddress,
    textRecords: {
      'com.ethy-ads.kind': 'user',
      'com.ethy-ads.wallet': user.walletAddress,
      'com.telegram.username': user.telegramUsername ? `@${user.telegramUsername.replace(/^@/, '')}` : '',
    },
  };
}

export function createCampaignEnsIdentityRecord(campaign: Campaign): EnsIdentity | null {
  if (!campaign.ensName) return null;

  return {
    name: campaign.ensName,
    address: campaign.advertiserWalletAddress,
    textRecords: {
      'com.ethy-ads.kind': 'campaign',
      'com.ethy-ads.campaign-id': campaign.id,
      'com.ethy-ads.status': campaign.status,
      'com.ethy-ads.channel': campaign.targetTelegramChannelUsername ?? '',
      'com.ethy-ads.amount': campaign.amount,
      'com.ethy-ads.token': campaign.tokenAddress,
      'com.ethy-ads.duration-seconds': campaign.durationSeconds.toString(),
      'com.ethy-ads.advertiser': campaign.advertiserEnsName ?? campaign.advertiserWalletAddress,
      'com.ethy-ads.poster': campaign.posterEnsName ?? campaign.posterWalletAddress ?? '',
      'com.ethy-ads.onchain-campaign-id': campaign.onchainCampaignId ?? '',
      'com.ethy-ads.created-at': campaign.createdAt.toISOString(),
      'com.ethy-ads.updated-at': campaign.updatedAt.toISOString(),
      'com.ethy-ads.submitted-post': campaign.submittedPostUrl ?? '',
    },
  };
}

export function ensIdentityFromCampaignEvent(event: CampaignEnsEvent): EnsIdentity {
  return {
    name: event.name,
    address: null,
    textRecords: event.textRecords,
  };
}

export function formatCampaignStamp(date: Date): string {
  return [
    pad(date.getUTCDate()),
    pad(date.getUTCMonth() + 1),
    date.getUTCFullYear(),
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`,
    'UTC',
  ].join('-');
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}
