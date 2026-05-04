import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PersistenceAdapterPort } from '../../application/ports/persistence';
import { Campaign, CampaignEnsEvent, Channel, User, VerificationCheck } from '../../domain/types';
import { DevWallet } from '../../application/ports/devWalletRepository';
import {
  createEmptyInMemoryRepositoryState,
  createInMemoryRepositories,
  InMemoryRepositoryState,
} from './inMemoryRepositories';

export async function createJsonFilePersistenceAdapter(filePath: string): Promise<PersistenceAdapterPort> {
  const resolvedPath = resolve(filePath);
  let writeQueue = Promise.resolve();

  const repositories = createInMemoryRepositories({
    state: await loadState(resolvedPath),
    onChange(state) {
      writeQueue = writeQueue.then(() => saveState(resolvedPath, state));
      return writeQueue;
    },
  });

  return {
    repositories,
    async close() {
      await writeQueue;
    },
  };
}

async function loadState(filePath: string): Promise<InMemoryRepositoryState> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return reviveState(JSON.parse(raw) as Partial<InMemoryRepositoryState>);
  } catch (error) {
    if (isNotFoundError(error)) return createEmptyInMemoryRepositoryState();
    throw error;
  }
}

async function saveState(filePath: string, state: InMemoryRepositoryState): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(tempPath, filePath);
}

function reviveState(raw: Partial<InMemoryRepositoryState>): InMemoryRepositoryState {
  return {
    nextId: typeof raw.nextId === 'number' ? raw.nextId : 1,
    users: (raw.users ?? []).map(reviveUser),
    channels: (raw.channels ?? []).map(reviveChannel),
    campaigns: (raw.campaigns ?? []).map(reviveCampaign),
    verificationChecks: (raw.verificationChecks ?? []).map(reviveVerificationCheck),
    devWallets: (raw.devWallets ?? []).map(reviveDevWallet),
  };
}

function reviveUser(user: User): User {
  return {
    ...user,
    createdAt: reviveDate(user.createdAt),
    updatedAt: reviveDate(user.updatedAt),
  };
}

function reviveChannel(channel: Channel): Channel {
  return {
    ...channel,
    verifiedAt: reviveNullableDate(channel.verifiedAt),
    createdAt: reviveDate(channel.createdAt),
    updatedAt: reviveDate(channel.updatedAt),
  };
}

function reviveCampaign(campaign: Campaign): Campaign {
  return {
    ...campaign,
    ensEvents: (campaign.ensEvents ?? []).map(reviveCampaignEnsEvent),
    startsAt: reviveNullableDate(campaign.startsAt),
    endsAt: reviveNullableDate(campaign.endsAt),
    createdAt: reviveDate(campaign.createdAt),
    updatedAt: reviveDate(campaign.updatedAt),
  };
}

function reviveCampaignEnsEvent(event: CampaignEnsEvent): CampaignEnsEvent {
  return {
    ...event,
    createdAt: reviveDate(event.createdAt),
  };
}

function reviveVerificationCheck(check: VerificationCheck): VerificationCheck {
  return {
    ...check,
    checkedAt: reviveDate(check.checkedAt),
  };
}

function reviveDevWallet(wallet: DevWallet): DevWallet {
  return {
    ...wallet,
    createdAt: reviveDate(wallet.createdAt),
  };
}

function reviveDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function reviveNullableDate(value: Date | string | null): Date | null {
  return value ? reviveDate(value) : null;
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
