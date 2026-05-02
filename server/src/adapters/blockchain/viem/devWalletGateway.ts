import { DynamicEvmWalletClient } from '@dynamic-labs-wallet/node-evm';
import { createPublicClient, createWalletClient, erc20Abi, formatUnits, http, parseUnits } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { foundry, sepolia } from 'viem/chains';
import { CreateCampaignAuthorization, DevWalletGateway, TokenPermitAuthorization } from '../../../application/ports/devWalletGateway';
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
  const rawSender = createWalletClient({ chain, transport });

  async function finalizePreparedTransaction<T extends Record<string, unknown>>(transaction: T): Promise<T & { gasPrice: bigint; type: 'legacy' }> {
    const gasPrice = await publicClient.getGasPrice();
    return {
      ...transaction,
      gasPrice,
      type: 'legacy',
    };
  }

  async function writeLocalContract(
    account: ReturnType<typeof privateKeyToAccount>,
    request: Parameters<typeof publicClient.simulateContract>[0],
  ): Promise<`0x${string}`> {
    const walletClient = createWalletClient({ account, chain, transport });
    const simulation = await publicClient.simulateContract({
      account,
      ...request,
    });
    return walletClient.writeContract(await finalizePreparedTransaction(simulation.request));
  }

  return {
    async createWallet(telegramUserId: string): Promise<DevWallet> {
      if (isDynamicConfigured(config)) {
        const authenticatedClient = await authenticatedDynamicClient(config);
        const wallet = await authenticatedClient.createWalletAccount({
          thresholdSignatureScheme: 'TWO_OF_TWO',
          backUpToClientShareService: true,
          onError: (error: Error) => {
            throw error;
          },
        } as never);

        return {
          telegramUserId,
          address: wallet.accountAddress as `0x${string}`,
          provider: 'dynamic',
          privateKey: null,
          walletId: wallet.walletId,
          createdAt: new Date(),
        };
      }

      const privateKey = generatePrivateKey();
      const account = privateKeyToAccount(privateKey);

      return {
        telegramUserId,
        address: account.address,
        provider: 'local',
        privateKey,
        walletId: null,
        createdAt: new Date(),
      };
    },

    async signMessage(wallet: DevWallet, message: string): Promise<`0x${string}`> {
      if (wallet.provider === 'dynamic') {
        const authenticatedClient = await authenticatedDynamicClient(config);
        return (await authenticatedClient.signMessage({
          accountAddress: wallet.address,
          message,
        })) as `0x${string}`;
      }

      return await localAccount(wallet).signMessage({ message });
    },

    async signTokenPermitAuthorization(wallet, input): Promise<`0x${string}`> {
      const typedData = createTokenPermitTypedData(input.tokenAddress, input.chainId, input.authorization);

      if (wallet.provider === 'dynamic') {
        const authenticatedClient = await authenticatedDynamicClient(config);
        return (await authenticatedClient.signTypedData({
          accountAddress: wallet.address,
          typedData: typedData as never,
        })) as `0x${string}`;
      }

      return await localAccount(wallet).signTypedData(typedData);
    },

    async signCreateCampaignAuthorization(wallet, input): Promise<`0x${string}`> {
      const typedData = createCampaignAuthorizationTypedData(input.verifyingContract, input.chainId, input.authorization);

      if (wallet.provider === 'dynamic') {
        const authenticatedClient = await authenticatedDynamicClient(config);
        return (await authenticatedClient.signTypedData({
          accountAddress: wallet.address,
          typedData: typedData as never,
        })) as `0x${string}`;
      }

      return await localAccount(wallet).signTypedData(typedData);
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

    async getMajorBalances(wallet: DevWallet) {
      assertRpcConfigured(config);

      const nativeBalance = await publicClient.getBalance({ address: wallet.address });
      const tokens = configuredMajorTokens(config);
      const tokenBalances = await Promise.all(
        tokens.map(async (token) => {
          const walletBalance = await publicClient.readContract({
            address: token.address,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [wallet.address],
          });
          const escrowBalance = /^0x[a-fA-F0-9]{40}$/.test(config.escrowContractAddress)
            ? await publicClient.readContract({
                address: config.escrowContractAddress as `0x${string}`,
                abi: adEscrowAbi,
                functionName: 'balances',
                args: [wallet.address, token.address],
              })
            : null;

          return {
            symbol: token.symbol,
            address: token.address,
            decimals: token.decimals,
            walletBalance,
            escrowBalance,
            isNative: false,
          };
        }),
      );

      return [
        {
          symbol: 'ETH',
          address: null,
          decimals: 18,
          walletBalance: nativeBalance,
          escrowBalance: null,
          isNative: true,
        },
        ...tokenBalances,
      ];
    },

    mintMockUsdc(to: `0x${string}`, amount: bigint) {
      assertConfigured(config);
      if (!config.devWalletMinterPrivateKey) {
        throw new Error('DEV_WALLET_MINTER_PRIVATE_KEY is required for dev minting');
      }

      const account = privateKeyToAccount(config.devWalletMinterPrivateKey as `0x${string}`);
      return writeLocalContract(account, {
        address: config.usdcTokenAddress as `0x${string}`,
        abi: mockUsdcAbi,
        functionName: 'mint',
        args: [to, amount],
      });
    },

    approveEscrow(wallet: DevWallet, amount: bigint) {
      assertConfigured(config);
      if (wallet.provider === 'dynamic') {
        return signAndSendContract(wallet, {
          address: config.usdcTokenAddress as `0x${string}`,
          abi: erc20Abi,
          functionName: 'approve',
          args: [config.escrowContractAddress as `0x${string}`, amount],
        });
      }

      const account = localAccount(wallet);
      return writeLocalContract(account, {
        address: config.usdcTokenAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: 'approve',
        args: [config.escrowContractAddress as `0x${string}`, amount],
      });
    },

    deposit(wallet: DevWallet, amount: bigint) {
      assertConfigured(config);
      if (wallet.provider === 'dynamic') {
        return signAndSendContract(wallet, {
          address: config.escrowContractAddress as `0x${string}`,
          abi: adEscrowAbi,
          functionName: 'deposit',
          args: [config.usdcTokenAddress as `0x${string}`, amount],
        });
      }

      const account = localAccount(wallet);
      return writeLocalContract(account, {
        address: config.escrowContractAddress as `0x${string}`,
        abi: adEscrowAbi,
        functionName: 'deposit',
        args: [config.usdcTokenAddress as `0x${string}`, amount],
      });
    },

    withdraw(wallet: DevWallet, amount: bigint) {
      assertConfigured(config);
      if (wallet.provider === 'dynamic') {
        return signAndSendContract(wallet, {
          address: config.escrowContractAddress as `0x${string}`,
          abi: adEscrowAbi,
          functionName: 'withdraw',
          args: [config.usdcTokenAddress as `0x${string}`, amount],
        });
      }

      const account = localAccount(wallet);
      return writeLocalContract(account, {
        address: config.escrowContractAddress as `0x${string}`,
        abi: adEscrowAbi,
        functionName: 'withdraw',
        args: [config.usdcTokenAddress as `0x${string}`, amount],
      });
    },

    async createCampaignFromBalance(wallet, input) {
      assertConfigured(config);
      const request = {
        address: config.escrowContractAddress as `0x${string}`,
        abi: adEscrowAbi,
        functionName: 'createCampaignFromBalance',
        args: [input.posterWalletAddress, input.tokenAddress, input.amount, input.durationSeconds],
      } as const;

      if (wallet.provider === 'dynamic') {
        const simulation = await publicClient.simulateContract({
          account: wallet.address,
          ...request,
        });
        const txHash = await signAndSendPreparedTransaction(wallet, simulation.request);
        return {
          onchainCampaignId: simulation.result,
          txHash,
        };
      }

      const account = localAccount(wallet);
      const walletClient = createWalletClient({ account, chain, transport });
      const simulation = await publicClient.simulateContract({
        account,
        ...request,
      });
      const txHash = await walletClient.writeContract(await finalizePreparedTransaction(simulation.request));

      return {
        onchainCampaignId: simulation.result,
        txHash,
      };
    },
  };

  async function signAndSendContract(wallet: DevWallet, request: Parameters<typeof publicClient.simulateContract>[0]): Promise<`0x${string}`> {
    const simulation = await publicClient.simulateContract({
      account: wallet.address,
      ...request,
    });
    return signAndSendPreparedTransaction(wallet, await finalizePreparedTransaction(simulation.request));
  }

  async function signAndSendPreparedTransaction(wallet: DevWallet, transaction: unknown): Promise<`0x${string}`> {
    const authenticatedClient = await authenticatedDynamicClient(config);
    const serializedTransaction = await authenticatedClient.signTransaction({
      senderAddress: wallet.address,
      transaction: transaction as never,
    });
    return rawSender.sendRawTransaction({
      serializedTransaction: serializedTransaction as `0x${string}`,
    });
  }
}

export function parseDevUsdcAmount(value: string): bigint {
  return parseUnits(value, 6);
}

export function formatDevUsdcAmount(value: bigint): string {
  return formatUnits(value, 6);
}

export function formatDevTokenAmount(value: bigint, decimals: number): string {
  return formatUnits(value, decimals);
}

function createCampaignAuthorizationTypedData(
  verifyingContract: `0x${string}`,
  chainId: number,
  authorization: CreateCampaignAuthorization,
) {
  return {
    domain: {
      name: 'AdEscrow',
      version: '1',
      chainId,
      verifyingContract,
    },
    primaryType: 'CreateCampaignAuthorization' as const,
    types: {
      CreateCampaignAuthorization: [
        { name: 'advertiser', type: 'address' },
        { name: 'poster', type: 'address' },
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'durationSeconds', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    message: authorization,
  };
}

function createTokenPermitTypedData(
  tokenAddress: `0x${string}`,
  chainId: number,
  authorization: TokenPermitAuthorization,
) {
  return {
    domain: {
      name: 'Mock USDC',
      version: '1',
      chainId,
      verifyingContract: tokenAddress,
    },
    primaryType: 'Permit' as const,
    types: {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    message: authorization,
  };
}

async function authenticatedDynamicClient(config: AppConfig) {
  if (!config.dynamicAuthToken || !config.dynamicEnvironmentId) {
    throw new Error('DYNAMIC_AUTH_TOKEN and DYNAMIC_ENV_ID are required for Dynamic wallets');
  }

  const client = new DynamicEvmWalletClient({
    environmentId: config.dynamicEnvironmentId,
    baseApiUrl: 'https://app.dynamicauth.com',
    baseMPCRelayApiUrl: 'relay.dynamicauth.com',
  });

  await client.authenticateApiToken(config.dynamicAuthToken);
  return client;
}

function isDynamicConfigured(config: AppConfig): boolean {
  return Boolean(config.dynamicAuthToken && config.dynamicEnvironmentId);
}

function configuredMajorTokens(config: AppConfig) {
  return [
    { symbol: 'USDC', address: config.usdcTokenAddress, decimals: 6 },
    { symbol: 'USDT', address: config.usdtTokenAddress, decimals: 6 },
    { symbol: 'DAI', address: config.daiTokenAddress, decimals: 18 },
    { symbol: 'WBTC', address: config.wbtcTokenAddress, decimals: 8 },
  ]
    .filter((token) => /^0x[a-fA-F0-9]{40}$/.test(token.address))
    .map((token) => ({
      ...token,
      address: token.address as `0x${string}`,
    }));
}

function localAccount(wallet: DevWallet) {
  if (!wallet.privateKey) throw new Error('Local wallet private key is missing');
  return privateKeyToAccount(wallet.privateKey);
}

function assertConfigured(config: AppConfig): void {
  if (!config.escrowContractAddress || !config.usdcTokenAddress || !config.rpcUrl) {
    throw new Error('RPC_URL, ESCROW_CONTRACT_ADDRESS, and USDC_TOKEN_ADDRESS are required for dev wallet mode');
  }
}

function assertRpcConfigured(config: AppConfig): void {
  if (!config.rpcUrl) {
    throw new Error('RPC_URL is required for wallet balance lookup');
  }
}
