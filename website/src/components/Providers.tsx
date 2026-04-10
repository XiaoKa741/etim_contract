'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { config } from '@/config/wagmi';
import { LanguageProvider } from '@/lib/i18n';
import { useState, useEffect } from 'react';

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
          {mounted ? children : null}
        </LanguageProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
