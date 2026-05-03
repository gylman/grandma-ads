import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { defineChain } from 'viem';
import { appConfig } from '../lib/config';

const configuredChainId = Number(appConfig.chainId || 31337);

export const appChain = defineChain({
  id: configuredChainId,
  name: configuredChainId === 31337 ? 'Foundry' : `Chain ${configuredChainId}`,
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [appConfig.rpcUrl || 'http://127.0.0.1:8545'],
    },
  },
});

export const wagmiConfig = createConfig({
  chains: [appChain],
  connectors: [injected()],
  transports: {
    [appChain.id]: http(appConfig.rpcUrl || undefined),
  },
});
