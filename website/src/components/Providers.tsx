'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, useAccount, useSwitchChain } from 'wagmi';
import { bsc } from 'wagmi/chains';
import { config } from '@/config/wagmi';
import { LanguageProvider } from '@/lib/i18n';
import { useState, useEffect, useRef } from 'react';

/** Auto-switch to BSC when wallet is connected on wrong network */
function NetworkAutoSwitch() {
  const { chain, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  const hasSwitched = useRef(false);

  useEffect(() => {
    // chain is undefined when wallet is on an unsupported network (e.g. Ethereum)
    // since wagmi config only includes BSC
    if (isConnected && (!chain || chain.id !== bsc.id) && !hasSwitched.current) {
      hasSwitched.current = true;
      try {
        switchChain({ chainId: bsc.id });
      } catch {}
    }
    if (!isConnected) {
      hasSwitched.current = false;
    }
  }, [isConnected, chain, switchChain]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 10_000,      // 10s before refetch
            refetchOnWindowFocus: false,  // don't refetch when user switches back to tab
          },
        },
      })
  );
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <WagmiProvider config={config} reconnectOnMount={true}>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <NetworkAutoSwitch />
          {mounted ? children : null}
        </LanguageProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
