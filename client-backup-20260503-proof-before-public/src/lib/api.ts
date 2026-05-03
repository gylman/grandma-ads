import { appConfig } from './config';

export type ApiCampaign = {
  id: string;
  amount: string;
  durationSeconds: number;
  targetTelegramChannelUsername: string | null;
  requestedText: string | null;
  status: string;
  onchainCampaignId?: string | null;
  ensName?: string | null;
  advertiserEnsName?: string | null;
  posterEnsName?: string | null;
  tokenAddress?: string;
  submittedPostUrl?: string | null;
  ensEvents?: ApiEnsEvent[];
};

export type ApiEnsEvent = {
  name: string;
  type: string;
  txHash: string | null;
  agentEnsName: string;
  onchainCampaignId: string | null;
  textRecords: Record<string, string>;
  createdAt: string;
};

export type ApiChannel = {
  id: string;
  telegramChannelUsername: string | null;
  verificationCode: string | null;
  status: string;
};

export type ApiProofResponse = {
  campaign: ApiCampaign;
  ensRecord: {
    name: string;
    address: string | null;
    textRecords: Record<string, string>;
  } | null;
};

export type ApiEventProofResponse = {
  campaign: ApiCampaign;
  event: ApiEnsEvent;
  ensRecord: {
    name: string;
    address: string | null;
    textRecords: Record<string, string>;
  } | null;
};

export async function createUser(walletAddress: string) {
  return request('/api/users', {
    method: 'POST',
    body: JSON.stringify({ walletAddress }),
  });
}

export async function listCampaigns(): Promise<ApiCampaign[]> {
  const data = await request<{ campaigns: ApiCampaign[] }>('/api/campaigns');
  return data.campaigns;
}

export async function createCampaign(input: {
  advertiserUserId: string;
  advertiserWalletAddress: string;
  amount: string;
  durationSeconds: number;
  targetTelegramChannelUsername: string;
  requestedText: string;
  tokenAddress: string;
}): Promise<ApiCampaign> {
  const data = await request<{ campaign: ApiCampaign }>('/api/campaigns', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.campaign;
}

export async function registerChannel(input: {
  ownerUserId: string;
  telegramChannelUsername: string;
}): Promise<ApiChannel> {
  const data = await request<{ channel: ApiChannel }>('/api/channels', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.channel;
}

export async function getHealth(): Promise<boolean> {
  try {
    const data = await request<{ ok: boolean }>('/health');
    return data.ok;
  } catch {
    return false;
  }
}

export async function getAdProof(onchainCampaignId: string): Promise<ApiProofResponse> {
  return request<ApiProofResponse>(`/api/proofs/ads/${onchainCampaignId}`);
}

export async function getAdEventProof(onchainCampaignId: string, eventType: string): Promise<ApiEventProofResponse> {
  return request<ApiEventProofResponse>(`/api/proofs/ads/${onchainCampaignId}/${eventType}`);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${appConfig.serverUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}
