'use client';

import { useReadContract } from 'wagmi';
import { CONTRACTS } from '@/config/contracts';
import { ETIMMainABI, ETIMTaxHookABI, ETIMPoolHelperABI } from '@/config/abis';

export function useGlobalStats() {
  const { data: totalUsers } = useReadContract({
    address: CONTRACTS.ETIMMain,
    abi: ETIMMainABI,
    functionName: 'totalUsers',
  });

  const { data: totalDeposited } = useReadContract({
    address: CONTRACTS.ETIMMain,
    abi: ETIMMainABI,
    functionName: 'totalDeposited',
  });

  const { data: totalActiveNodes } = useReadContract({
    address: CONTRACTS.ETIMMain,
    abi: ETIMMainABI,
    functionName: 'totalActiveNodes',
  });

  const { data: remainingPool } = useReadContract({
    address: CONTRACTS.ETIMMain,
    abi: ETIMMainABI,
    functionName: 'remainingGrowthPool',
  });

  const { data: isPoolDepleted } = useReadContract({
    address: CONTRACTS.ETIMMain,
    abi: ETIMMainABI,
    functionName: 'isGrowthPoolDepleted',
  });

  const { data: s2PlusCount } = useReadContract({
    address: CONTRACTS.ETIMMain,
    abi: ETIMMainABI,
    functionName: 'totalActiveS2PlusPlayers',
  });

  const { data: s6Count } = useReadContract({
    address: CONTRACTS.ETIMMain,
    abi: ETIMMainABI,
    functionName: 'totalActiveS6Players',
  });

  const { data: s6RewardPool } = useReadContract({
    address: CONTRACTS.ETIMTaxHook,
    abi: ETIMTaxHookABI,
    functionName: 'sellTaxToS6',
  });

  const { data: poolEthReserves } = useReadContract({
    address: CONTRACTS.ETIMPoolHelper,
    abi: ETIMPoolHelperABI,
    functionName: 'getEthReserves',
  });

  const { data: etimPerEth } = useReadContract({
    address: CONTRACTS.ETIMPoolHelper,
    abi: ETIMPoolHelperABI,
    functionName: 'getEtimPerEth',
  });

  // Calculate ETIM reserves: ethReserves * etimPerEth / 1e18
  const poolEtimReserves = poolEthReserves !== undefined && etimPerEth !== undefined
    ? (poolEthReserves as bigint) * (etimPerEth as bigint) / BigInt(1e18)
    : undefined;

  return {
    totalUsers: totalUsers as bigint | undefined,
    totalDeposited: totalDeposited as bigint | undefined,
    totalActiveNodes: totalActiveNodes as bigint | undefined,
    remainingPool: remainingPool as bigint | undefined,
    isPoolDepleted: isPoolDepleted as boolean | undefined,
    s2PlusCount: s2PlusCount as bigint | undefined,
    s6Count: s6Count as bigint | undefined,
    s6RewardPool: s6RewardPool as bigint | undefined,
    poolEthReserves: poolEthReserves as bigint | undefined,
    poolEtimReserves,
  };
}
