'use client';

import { useReadContract } from 'wagmi';
import { CONTRACTS } from '@/config/contracts';
import { ETIMMainABI } from '@/config/abis';

export function useClaimable(address: `0x${string}` | undefined) {
  const { data: miningReward } = useReadContract({
    address: CONTRACTS.ETIMMain,
    abi: ETIMMainABI,
    functionName: 'getClaimableAmountOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: nodeReward } = useReadContract({
    address: CONTRACTS.ETIMMain,
    abi: ETIMMainABI,
    functionName: 'getClaimableNodeRewards',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: s2PlusReward } = useReadContract({
    address: CONTRACTS.ETIMMain,
    abi: ETIMMainABI,
    functionName: 'getClaimableS2PlusRewards',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: s3PlusReward } = useReadContract({
    address: CONTRACTS.ETIMMain,
    abi: ETIMMainABI,
    functionName: 'getClaimableS3PlusRewards',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: s6Reward } = useReadContract({
    address: CONTRACTS.ETIMMain,
    abi: ETIMMainABI,
    functionName: 'getClaimableS6Rewards',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  return {
    miningReward: (miningReward as bigint) ?? BigInt(0),
    nodeReward: (nodeReward as bigint) ?? BigInt(0),
    s2PlusReward: (s2PlusReward as bigint) ?? BigInt(0),
    s3PlusReward: (s3PlusReward as bigint) ?? BigInt(0),
    s6Reward: (s6Reward as bigint) ?? BigInt(0),
  };
}
