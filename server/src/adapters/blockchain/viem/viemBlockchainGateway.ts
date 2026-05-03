import { createPublicClient, createWalletClient, http, isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { AppConfig } from '../../../config';
import {
  BalanceSnapshot,
  BlockchainGateway,
  CreateOnchainCampaignBySigInput,
  CreateOnchainCampaignInput,
  DepositWithPermitInput,
} from '../../../application/ports/blockchainGateway';
import { adEscrowAbi } from './adEscrowAbi';

const mockUsdcPermitAbi = [
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: 'nonce', type: 'uint256' }],
  },
] as const;

export function createViemBlockchainGateway(config: AppConfig): BlockchainGateway {
  const chain = {
    ...foundry,
    id: config.chainId,
    rpcUrls: {
      default: { http: [config.rpcUrl || foundry.rpcUrls.default.http[0]] },
    },
  };

  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl || undefined),
  });

  const account = config.verifierPrivateKey
    ? privateKeyToAccount(config.verifierPrivateKey as `0x${string}`)
    : null;

  const walletClient = account
    ? createWalletClient({
        account,
        chain,
        transport: http(config.rpcUrl || undefined),
      })
    : null;

  return {
    async getBalance(walletAddress: string, tokenAddress = config.usdcTokenAddress): Promise<BalanceSnapshot> {
      if (!config.escrowContractAddress || !tokenAddress || !isAddress(walletAddress) || !isAddress(tokenAddress)) {
        return {
          walletAddress,
          tokenAddress,
          available: '0',
          locked: '0',
          pendingEarnings: '0',
          source: 'not-configured',
        };
      }

      const available = await publicClient.readContract({
        address: config.escrowContractAddress as `0x${string}`,
        abi: adEscrowAbi,
        functionName: 'balances',
        args: [walletAddress as `0x${string}`, tokenAddress as `0x${string}`],
      });

      return {
        walletAddress,
        tokenAddress,
        available: available.toString(),
        locked: '0',
        pendingEarnings: '0',
        source: 'contract',
      };
    },

    async getCampaignNonce(walletAddress: `0x${string}`): Promise<bigint> {
      if (!config.escrowContractAddress) {
        throw new Error('Escrow contract is not configured');
      }

      return publicClient.readContract({
        address: config.escrowContractAddress as `0x${string}`,
        abi: adEscrowAbi,
        functionName: 'nonces',
        args: [walletAddress],
      });
    },

    async getTokenPermitNonce(tokenAddress: `0x${string}`, walletAddress: `0x${string}`): Promise<bigint> {
      return publicClient.readContract({
        address: tokenAddress,
        abi: mockUsdcPermitAbi,
        functionName: 'nonces',
        args: [walletAddress],
      });
    },

    async depositWithPermit(input: DepositWithPermitInput) {
      const writer = getWalletClient();
      const simulation = await publicClient.simulateContract({
        account,
        address: config.escrowContractAddress as `0x${string}`,
        abi: adEscrowAbi,
        functionName: 'depositWithPermit',
        args: [input.ownerWalletAddress, input.tokenAddress, input.amount, input.deadline, input.signature],
      });

      const txHash = await writer.writeContract(simulation.request);
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      return txHash;
    },

    async createCampaignFromBalance(input: CreateOnchainCampaignInput) {
      const writer = getWalletClient();
      const txHash = await writer.writeContract({
        address: config.escrowContractAddress as `0x${string}`,
        abi: adEscrowAbi,
        functionName: 'createCampaignFromBalance',
        args: [input.posterWalletAddress, input.tokenAddress, input.amount, input.durationSeconds],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      return txHash;
    },

    async createCampaignFromBalanceBySig(input: CreateOnchainCampaignBySigInput) {
      const writer = getWalletClient();
      const simulation = await publicClient.simulateContract({
        account,
        address: config.escrowContractAddress as `0x${string}`,
        abi: adEscrowAbi,
        functionName: 'createCampaignFromBalanceBySig',
        args: [
          input.advertiserWalletAddress,
          input.posterWalletAddress,
          input.tokenAddress,
          input.amount,
          input.durationSeconds,
          input.deadline,
          input.signature,
        ],
      });

      const txHash = await writer.writeContract(simulation.request);
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      return {
        onchainCampaignId: simulation.result,
        txHash,
      };
    },

    async startCampaign(campaignId: bigint) {
      const writer = getWalletClient();
      const txHash = await writer.writeContract({
        address: config.escrowContractAddress as `0x${string}`,
        abi: adEscrowAbi,
        functionName: 'startCampaign',
        args: [campaignId],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      return txHash;
    },

    async completeCampaign(campaignId: bigint) {
      const writer = getWalletClient();
      const txHash = await writer.writeContract({
        address: config.escrowContractAddress as `0x${string}`,
        abi: adEscrowAbi,
        functionName: 'completeCampaign',
        args: [campaignId],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      return txHash;
    },

    async refundCampaign(campaignId: bigint) {
      const writer = getWalletClient();
      const txHash = await writer.writeContract({
        address: config.escrowContractAddress as `0x${string}`,
        abi: adEscrowAbi,
        functionName: 'refundCampaign',
        args: [campaignId],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      return txHash;
    },
  };

  function getWalletClient() {
    if (!walletClient || !account || !config.escrowContractAddress) {
      throw new Error('Blockchain verifier wallet or escrow contract is not configured');
    }
    return walletClient;
  }
}
