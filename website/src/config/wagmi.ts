'use client';

import { createConfig, createStorage, http } from 'wagmi';
import { mainnet } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';

export const config = createConfig({
  chains: [mainnet],
  connectors: [
    injected({ shimDisconnect: true }),
  ],
  transports: {
    [mainnet.id]: http('https://eth.llamarpc.com'),
  },
  ssr: true,
  storage: createStorage({
    storage: typeof window !== 'undefined' ? {
      getItem: (key) => {
        if (key === 'wagmi.store') return null;
        return window.localStorage.getItem(key);
      },
      setItem: (key, value) => window.localStorage.setItem(key, value),
      removeItem: (key) => window.localStorage.removeItem(key),
    } : undefined,
  }),
});
