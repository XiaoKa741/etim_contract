'use client';

import { useAccount, useSwitchChain } from 'wagmi';
import { bsc } from 'wagmi/chains';
import { useCallback } from 'react';

/**
 * Hook to ensure the user is on BSC before executing a transaction.
 * Returns { isWrongNetwork, switchToBsc, isSwitching }
 * 
 * Note: when wallet is on an unsupported chain (e.g. Ethereum),
 * wagmi returns chain=undefined (since only BSC is configured).
 * We treat undefined as wrong network when the user is connected.
 */
export function useNetworkGuard() {
  const { chain, isConnected } = useAccount();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  // Wrong if: connected but chain is undefined (unsupported) OR chain is not BSC
  const isWrongNetwork = isConnected && (!chain || chain.id !== bsc.id);

  const switchToBsc = useCallback(() => {
    switchChain({ chainId: bsc.id });
  }, [switchChain]);

  return { isWrongNetwork, switchToBsc, isSwitching };
}
