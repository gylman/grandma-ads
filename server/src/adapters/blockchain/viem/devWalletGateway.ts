import { createPublicClient, createWalletClient, erc20Abi, formatUnits, http, parseEther, parseUnits } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { foundry, sepolia } from 'viem/chains';
import { DevWalletGateway } from '../../../application/ports/devWalletGateway';
import { DevWallet } from '../../../application/ports/devWalletRepository';
import { AppConfig } from '../../../config';
import { adEscrowAbi } from './adEscrowAbi';

const mockUsdcAbi = [
  ...erc20Abi,
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
] as const;

export function createViemDevWalletGateway(config: AppConfig): DevWalletGateway {
  const chain = config.chainId === sepolia.id ? sepolia : { ...foundry, id: config.chainId };
  const transport = http(config.rpcUrl || undefined);
  const publicClient = createPublicClient({ chain, transport });

  return {
    generateWallet(telegramUserId: string): DevWallet {
      const privateKey = generatePrivateKey();
      const account = privateKeyToAccount(privateKey);

      return {
        telegramUserId,
        address: account.address,
        privateKey,
        createdAt: new Date(),
      };
    },

    async getBalance(wallet: DevWallet) {
      assertConfigured(config);

      const [tokenBalance, escrowBalance] = await Promise.all([
        publicClient.readContract({
          address: config.usdcTokenAddress as `0x${string}`,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [wallet.address],
        }),
        publicClient.readContract({
          address: config.escrowContractAddress as `0x${string}`,
          abi: adEscrowAbi,
          functionName: 'balances',
          args: [wallet.address, config.usdcTokenAddress as `0x${string}`],
        }),
      ]);

      return { walletAddress: wallet.address, tokenBalance, escrowBalance };
    },

    mintMockUsdc(to: `0x${string}`, amount: bigint) {
      assertConfigured(config);
      if (!config.devWalletMinterPrivateKey) {
        throw new Error('DEV_WALLET_MINTER_PRIVATE_KEY is required for dev minting');
      }

      const account = privateKeyToAccount(config.devWalletMinterPrivateKey as `0x${string}`);
      return createWalletClient({ account, chain, transport }).writeContract({
        address: config.usdcTokenAddress as `0x${string}`,
        abi: mockUsdcAbi,
        functionName: 'mint',
        args: [to, amount],
      });
    },

    approveEscrow(wallet: DevWallet, amount: bigint) {
      assertConfigured(config);
      return withGasTopUp(wallet, async () => {
        const account = privateKeyToAccount(wallet.privateKey);

        return createWalletClient({ account, chain, transport }).writeContract({
          address: config.usdcTokenAddress as `0x${string}`,
          abi: erc20Abi,
          functionName: 'approve',
          args: [config.escrowContractAddress as `0x${string}`, amount],
        });
      });
    },

    deposit(wallet: DevWallet, amount: bigint) {
      assertConfigured(config);
      return withGasTopUp(wallet, async () => {
        const account = privateKeyToAccount(wallet.privateKey);

        return createWalletClient({ account, chain, transport }).writeContract({
          address: config.escrowContractAddress as `0x${string}`,
          abi: adEscrowAbi,
          functionName: 'deposit',
          args: [config.usdcTokenAddress as `0x${string}`, amount],
        });
      });
    },

    withdraw(wallet: DevWallet, amount: bigint) {
      assertConfigured(config);
      return withGasTopUp(wallet, async () => {
        const account = privateKeyToAccount(wallet.privateKey);

        return createWalletClient({ account, chain, transport }).writeContract({
          address: config.escrowContractAddress as `0x${string}`,
          abi: adEscrowAbi,
          functionName: 'withdraw',
          args: [config.usdcTokenAddress as `0x${string}`, amount],
        });
      });
    },
  };

  async function withGasTopUp(wallet: DevWallet, action: () => Promise<`0x${string}`>): Promise<`0x${string}`> {
    await ensureGas(wallet.address);
    return action();
  }

  async function ensureGas(address: `0x${string}`): Promise<void> {
    const balance = await publicClient.getBalance({ address });
    const minimum = parseEther('0.01');

    if (balance >= minimum) return;

    if (!config.devWalletMinterPrivateKey) {
      throw new Error('DEV_WALLET_MINTER_PRIVATE_KEY is required to top up dev wallet gas');
    }

    const funder = privateKeyToAccount(config.devWalletMinterPrivateKey as `0x${string}`);
    const txHash = await createWalletClient({ account: funder, chain, transport }).sendTransaction({
      to: address,
      value: config.devWalletEthTopUpAmount,
    });

    await publicClient.waitForTransactionReceipt({ hash: txHash });
  }
}

export function parseDevUsdcAmount(value: string): bigint {
  return parseUnits(value, 6);
}

export function formatDevUsdcAmount(value: bigint): string {
  return formatUnits(value, 6);
}

function assertConfigured(config: AppConfig): void {
  if (!config.escrowContractAddress || !config.usdcTokenAddress || !config.rpcUrl) {
    throw new Error('RPC_URL, ESCROW_CONTRACT_ADDRESS, and USDC_TOKEN_ADDRESS are required for dev wallet mode');
  }
}
