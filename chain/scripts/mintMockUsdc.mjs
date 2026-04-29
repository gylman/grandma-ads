import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createWalletClient, getAddress, http, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry, sepolia } from 'viem/chains';

const mockUsdcAbi = [
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
];

const rpcUrl = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const chainId = Number(process.env.CHAIN_ID ?? 31337);
const tokenAddress = process.env.USDC_TOKEN_ADDRESS;
const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
const mintsFile = process.env.MINTS_FILE ?? 'mint.mock-usdc.json';

if (!tokenAddress) {
  throw new Error('USDC_TOKEN_ADDRESS is required in chain/.env');
}

if (!privateKey) {
  throw new Error('DEPLOYER_PRIVATE_KEY is required in chain/.env');
}

const resolvedMintsFile = path.resolve(process.cwd(), mintsFile);
const parsed = JSON.parse(await fs.readFile(resolvedMintsFile, 'utf8'));

if (!Array.isArray(parsed)) {
  throw new Error(`${mintsFile} must be a JSON array`);
}

const mints = parsed.map((entry, index) => {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`Mint entry ${index} must be an object`);
  }

  if (typeof entry.account !== 'string') {
    throw new Error(`Mint entry ${index} is missing account`);
  }

  if (typeof entry.amount !== 'string' && typeof entry.amount !== 'number') {
    throw new Error(`Mint entry ${index} is missing amount`);
  }

  return {
    account: getAddress(entry.account),
    amount: parseUnits(String(entry.amount), 6),
  };
});

const account = privateKeyToAccount(privateKey);
const chain = chainId === sepolia.id ? sepolia : { ...foundry, id: chainId };
const walletClient = createWalletClient({
  account,
  chain,
  transport: http(rpcUrl),
});

console.log(`Minting mock USDC with ${account.address}`);
console.log(`Token: ${getAddress(tokenAddress)}`);
console.log(`Mints file: ${resolvedMintsFile}`);

for (const mint of mints) {
  const hash = await walletClient.writeContract({
    address: getAddress(tokenAddress),
    abi: mockUsdcAbi,
    functionName: 'mint',
    args: [mint.account, mint.amount],
  });

  console.log(`Minted ${mint.amount} base units to ${mint.account}: ${hash}`);
}
