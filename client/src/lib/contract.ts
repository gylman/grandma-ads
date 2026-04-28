export type EthereumProvider = {
  request<T = unknown>(args: { method: string; params?: unknown[] }): Promise<T>;
};

const SELECTORS = {
  approve: '095ea7b3',
  balances: 'c23f001f',
  deposit: '47e7ef24',
  withdraw: 'f3fef3a3',
};

export function getEthereumProvider(): EthereumProvider | null {
  const maybeWindow = window as Window & { ethereum?: EthereumProvider };
  return maybeWindow.ethereum ?? null;
}

export async function connectWallet(provider: EthereumProvider): Promise<string> {
  const accounts = await provider.request<string[]>({ method: 'eth_requestAccounts' });
  if (!accounts[0]) throw new Error('No wallet account returned');
  return accounts[0];
}

export async function readEscrowBalance(input: {
  provider: EthereumProvider;
  escrowAddress: string;
  userAddress: string;
  tokenAddress: string;
}): Promise<bigint> {
  const data = `0x${SELECTORS.balances}${encodeAddress(input.userAddress)}${encodeAddress(input.tokenAddress)}`;
  const result = await input.provider.request<string>({
    method: 'eth_call',
    params: [{ to: input.escrowAddress, data }, 'latest'],
  });
  return BigInt(result);
}

export async function approveTokenSpend(input: {
  provider: EthereumProvider;
  from: string;
  tokenAddress: string;
  spenderAddress: string;
  amount: bigint;
}): Promise<string> {
  return input.provider.request<string>({
    method: 'eth_sendTransaction',
    params: [
      {
        from: input.from,
        to: input.tokenAddress,
        data: `0x${SELECTORS.approve}${encodeAddress(input.spenderAddress)}${encodeUint(input.amount)}`,
      },
    ],
  });
}

export async function depositToEscrow(input: {
  provider: EthereumProvider;
  from: string;
  escrowAddress: string;
  tokenAddress: string;
  amount: bigint;
}): Promise<string> {
  return input.provider.request<string>({
    method: 'eth_sendTransaction',
    params: [
      {
        from: input.from,
        to: input.escrowAddress,
        data: `0x${SELECTORS.deposit}${encodeAddress(input.tokenAddress)}${encodeUint(input.amount)}`,
      },
    ],
  });
}

export async function withdrawFromEscrow(input: {
  provider: EthereumProvider;
  from: string;
  escrowAddress: string;
  tokenAddress: string;
  amount: bigint;
}): Promise<string> {
  return input.provider.request<string>({
    method: 'eth_sendTransaction',
    params: [
      {
        from: input.from,
        to: input.escrowAddress,
        data: `0x${SELECTORS.withdraw}${encodeAddress(input.tokenAddress)}${encodeUint(input.amount)}`,
      },
    ],
  });
}

export function parseUnits(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error('Enter a valid amount');

  const [whole, fraction = ''] = trimmed.split('.');
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(paddedFraction || '0');
}

export function formatUnits(value: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function encodeAddress(address: string): string {
  const value = address.toLowerCase().replace(/^0x/, '');
  if (!/^[a-f0-9]{40}$/.test(value)) throw new Error('Invalid address');
  return value.padStart(64, '0');
}

function encodeUint(value: bigint): string {
  if (value < 0n) throw new Error('Invalid uint');
  return value.toString(16).padStart(64, '0');
}
