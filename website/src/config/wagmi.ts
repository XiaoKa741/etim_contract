'use client';

import { createConfig, createStorage, fallback, http } from 'wagmi';
import { bsc } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';

// BSC RPC fallback list (better availability in different regions)
const BSC_RPC_URLS = [
  'https://bsc-dataseed1.binance.org',
  'https://bsc-dataseed.binance.org',
  'https://bsc-rpc.publicnode.com',
  'https://1rpc.io/bnb',
  'https://binance.llamarpc.com',
] as const;

export const config = createConfig({
  chains: [bsc],
  connectors: [
    injected({ shimDisconnect: true }),
  ],
  transports: {
    [bsc.id]: fallback(
      BSC_RPC_URLS.map((url) => http(url, { timeout: 8_000 })),
      { rank: false }
    ),
  },
  ssr: true,
  // Poll every 15 seconds for background updates (transaction receipts use their own faster polling)
  pollingInterval: 15_000,
  storage: createStorage({
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  }),
});
