'use client';

import { useReadContract, useReadContracts } from 'wagmi';
import { CONTRACTS } from '@/config/contracts';
import { ETIMMainABI, ETIMTokenABI, ETIMNodeABI } from '@/config/abis';
import { formatEther } from 'viem';

export function useUserInfo(address: `0x${string}` | undefined) {
  const { data: userData, isLoading: userLoading } = useReadContract({
    address: CONTRACTS.ETIMMain,
    abi: ETIMMainABI,
    functionName: 'users',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: referrer, isLoading: referrerLoading } = useReadContract({
    address: CONTRACTS.ETIMMain,
    abi: ETIMMainABI,
    functionName: 'referrerOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: tokenBalance } = useReadContract({
    address: CONTRACTS.ETIMToken,
    abi: ETIMTokenABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: nodeBalance } = useReadContract({
    address: CONTRACTS.ETIMNode,
    abi: ETIMNodeABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const isLoading = userLoading || referrerLoading;

  if (!userData || !address) {
    return { isLoading, user: null, referrer: null, tokenBalance: BigInt(0), nodeBalance: BigInt(0) };
  }

  const [
    participationTime,
    investedEthAmount,
    investedValueInUsd,
    claimedValueInUsd,
    lastClaimTime,
    directReferralCount,
    teamTokenBalance,
    level,
    syncedNodeCount,
    nodeRewardDebt,
    pendingNodeRewards,
    s2PlusActive,
    s3PlusActive,
    s6Active,
  ] = userData as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, number, bigint, bigint, bigint, boolean, boolean, boolean];

  return {
    isLoading,
    user: {
      participationTime: Number(participationTime),
      investedEthAmount: formatEther(investedEthAmount),
      investedValueInUsd: Number(investedValueInUsd) / 1e6,
      claimedValueInUsd: Number(claimedValueInUsd) / 1e6,
      lastClaimTime: Number(lastClaimTime),
      directReferralCount: Number(directReferralCount),
      teamTokenBalance: formatEther(teamTokenBalance),
      level,
      syncedNodeCount: Number(syncedNodeCount),
      pendingNodeRewards: formatEther(pendingNodeRewards),
      s2PlusActive,
      s3PlusActive,
      s6Active,
      isParticipant: participationTime > BigInt(0),
    },
    referrer: referrer as `0x${string}` | undefined,
    tokenBalance: tokenBalance as bigint ?? BigInt(0),
    nodeBalance: nodeBalance as bigint ?? BigInt(0),
  };
}
