'use client';

import { useReadContract } from 'wagmi';
import { CONTRACTS } from '@/config/contracts';
import { ETIMMainABI, ETIMTaxHookABI, ETIMPoolHelperABI, ERC20ABI } from '@/config/abis';
import { useEffect, useState } from 'react';

export function useGlobalStats() {
  const [tokenHolderCount, setTokenHolderCount] = useState<bigint | undefined>(undefined);
  const [tokenHolderCountLoading, setTokenHolderCountLoading] = useState(true);

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

  const { data: ethPriceInUsd } = useReadContract({
    address: CONTRACTS.ETIMMain,
    abi: ETIMMainABI,
    functionName: 'ethPriceInUsd',
  });

  // Fetch ETIM token holder count (BSC) from GoPlus public API
  useEffect(() => {
    let cancelled = false;

    async function fetchHolderCount() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      try {
        const url = `https://api.gopluslabs.io/api/v1/token_security/56?contract_addresses=${CONTRACTS.ETIMToken}`;
        const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const key = CONTRACTS.ETIMToken.toLowerCase();
        const countStr = data?.result?.[key]?.holder_count;
        if (!cancelled && countStr !== undefined && countStr !== null) {
          const count = BigInt(countStr);
          setTokenHolderCount(count);
          setTokenHolderCountLoading(false);
        }
      } catch {
        // ignore network errors and keep fallback value
      } finally {
        clearTimeout(timeout);
      }
    }

    fetchHolderCount();
    const timer = setInterval(fetchHolderCount, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Daily deposit limit reads
  const { data: dailyDepositTotal } = useReadContract({
    address: CONTRACTS.ETIMMain,
    abi: ETIMMainABI,
    functionName: 'dailyDepositTotal',
  });

  const { data: dailyDepositDay } = useReadContract({
    address: CONTRACTS.ETIMMain,
    abi: ETIMMainABI,
    functionName: 'dailyDepositDay',
  });

  const { data: dailyDepositLimit } = useReadContract({
    address: CONTRACTS.ETIMMain,
    abi: ETIMMainABI,
    functionName: 'dailyDepositLimit',
  });

  const { data: dailyDepositCap } = useReadContract({
    address: CONTRACTS.ETIMMain,
    abi: ETIMMainABI,
    functionName: 'dailyDepositCap',
  });

  const { data: dailyDepositRate } = useReadContract({
    address: CONTRACTS.ETIMMain,
    abi: ETIMMainABI,
    functionName: 'dailyDepositRate',
  });

  // Pot withdraw address for activity pool
  const { data: potWithdrawAddr } = useReadContract({
    address: CONTRACTS.ETIMMain,
    abi: ETIMMainABI,
    functionName: 'potWithdrawAddr',
  });

  // Check if potWithdrawAddr is valid (not zero address)
  const isPotWithdrawAddrValid = potWithdrawAddr !== undefined && potWithdrawAddr !== '0x0000000000000000000000000000000000000000';

  // Read WETH balance of potWithdrawAddr
  const { data: potWethBalance } = useReadContract({
    address: CONTRACTS.WETH,
    abi: ERC20ABI,
    functionName: 'balanceOf',
    args: isPotWithdrawAddrValid ? [potWithdrawAddr as `0x${string}`] : undefined,
    query: {
      enabled: isPotWithdrawAddrValid,
    },
  });

  // Calculate ETIM reserves: ethReserves * etimPerEth / 1e18
  const poolEtimReserves = poolEthReserves !== undefined && etimPerEth !== undefined
    ? (poolEthReserves as bigint) * (etimPerEth as bigint) / (10n ** 18n)
    : undefined;

  // Calculate ETIM price in USD: 1 ETIM = ethPriceInUsd / etimPerEth
  // ethPriceInUsd is 6 decimals, etimPerEth is 18 decimals
  // result = ethPriceInUsd * 1e18 / etimPerEth / 1e6 => USD value (float)
  const etimPriceInUsd = ethPriceInUsd !== undefined && etimPerEth !== undefined && (etimPerEth as bigint) > BigInt(0)
    ? Number(ethPriceInUsd as bigint) / Number(etimPerEth as bigint) * 1e12
    : undefined;

  // Calculate daily deposit quota (replicate contract logic from ETIMMain.sol:294-309)
  const FEE_DENOMINATOR = 1000n;
  let dailyQuotaUsed: bigint | undefined;
  let dailyQuotaLimit: bigint | undefined;

  if (dailyDepositDay !== undefined && dailyDepositTotal !== undefined) {
    const currentDay = BigInt(Math.floor(Date.now() / 1000 / 86400));
    // If on-chain day differs from current day, deposits have been reset to 0
    dailyQuotaUsed = (dailyDepositDay as bigint) === currentDay
      ? (dailyDepositTotal as bigint)
      : 0n;
  }

  if (dailyDepositLimit !== undefined && dailyDepositCap !== undefined && dailyDepositRate !== undefined && poolEthReserves !== undefined) {
    const limitVal = dailyDepositLimit as bigint;
    if (limitVal !== 0n) {
      dailyQuotaLimit = limitVal;
    } else {
      const capVal = dailyDepositCap as bigint;
      const effectiveCap = capVal === 0n ? (poolEthReserves as bigint) : capVal;
      dailyQuotaLimit = effectiveCap * (dailyDepositRate as bigint) / FEE_DENOMINATOR;
    }
  }

  const dailyQuotaPercent = dailyQuotaUsed !== undefined && dailyQuotaLimit !== undefined && dailyQuotaLimit > 0n
    ? Number(dailyQuotaUsed * 10000n / dailyQuotaLimit) / 100
    : undefined;

  return {
    totalUsers: tokenHolderCount,
    tokenHolderCountLoading,
    totalDeposited: totalDeposited as bigint | undefined,
    totalActiveNodes: totalActiveNodes as bigint | undefined,
    remainingPool: remainingPool as bigint | undefined,
    isPoolDepleted: isPoolDepleted as boolean | undefined,
    s2PlusCount: s2PlusCount as bigint | undefined,
    s6Count: s6Count as bigint | undefined,
    s6RewardPool: s6RewardPool as bigint | undefined,
    poolEthReserves: poolEthReserves as bigint | undefined,
    poolEtimReserves,
    etimPriceInUsd,
    dailyQuotaUsed,
    dailyQuotaLimit,
    dailyQuotaPercent,
    potWethBalance: potWethBalance as bigint | undefined,
    isPotWithdrawAddrValid,
  };
}
