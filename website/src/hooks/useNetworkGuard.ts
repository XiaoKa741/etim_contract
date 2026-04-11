'use client';

import { useAccount, useSwitchChain } from 'wagmi';
import { bsc } from 'wagmi/chains';
import { useCallback } from 'react';

/**
 * Hook to ensure the user is on BSC before executing a transaction.
 * Returns { isWrongNetwork, switchToBsc, isSwitching }
 */
export function useNetworkGuard() {
  const { chain } = useAccount();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  const isWrongNetwork = chain !== undefined && chain.id !== bsc.id;

  const switchToBsc = useCallback(() => {
    switchChain({ chainId: bsc.id });
  }, [switchChain]);

  return { isWrongNetwork, switchToBsc, isSwitching };
}
