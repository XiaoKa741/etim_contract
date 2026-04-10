'use client';

import { createConfig, createStorage, http } from 'wagmi';
import { bsc } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';

// Free BSC RPC endpoints
const RPC_URL = 'https://bsc-dataseed1.binance.org';

export const config = createConfig({
  chains: [bsc],
  connectors: [
    injected({ shimDisconnect: true }),
  ],
  transports: {
    [bsc.id]: http(RPC_URL),
  },
  ssr: true,
  // Poll every 15 seconds for background updates (transaction receipts use their own faster polling)
  pollingInterval: 15_000,
  storage: createStorage({
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  }),
});
