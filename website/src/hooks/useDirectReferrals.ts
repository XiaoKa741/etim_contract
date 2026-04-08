'use client';

import { useMemo } from 'react';
import { useReadContracts } from 'wagmi';
import { CONTRACTS } from '@/config/contracts';
import { ETIMMainABI, ETIMTokenABI } from '@/config/abis';
import { formatEther } from 'viem';

const PAGE_SIZE = 10;

export interface DirectReferralInfo {
  address: `0x${string}`;
  participationTime: number;
  tokenBalance: string;
}

export function useDirectReferrals(
  address: `0x${string}` | undefined,
  totalCount: number,
  page: number, // 0-based
) {
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const startIndex = page * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, totalCount);
  const count = endIndex - startIndex;

  // Step 1: Batch-read referral addresses for this page
  const addressContracts = useMemo(() =>
    Array.from({ length: count }, (_, i) => ({
      address: CONTRACTS.ETIMMain as `0x${string}`,
      abi: ETIMMainABI,
      functionName: 'referralsOfList' as const,
      args: [address!, BigInt(startIndex + i)] as const,
    })),
    [address, startIndex, count],
  );

  const {
    data: addressResults,
    isLoading: addressesLoading,
  } = useReadContracts({
    contracts: addressContracts,
    query: { enabled: !!address && totalCount > 0 && count > 0 },
  });

  // Extract resolved addresses
  const resolvedAddresses = useMemo(() => {
    const addrs: `0x${string}`[] = [];
    if (addressResults) {
      for (const result of addressResults) {
        if (result.status === 'success' && result.result) {
          addrs.push(result.result as `0x${string}`);
        }
      }
    }
    return addrs;
  }, [addressResults]);

  // Step 2: Batch-read user info + token balance for each resolved address
  const detailContracts = useMemo(() =>
    resolvedAddresses.flatMap((addr) => [
      {
        address: CONTRACTS.ETIMMain as `0x${string}`,
        abi: ETIMMainABI,
        functionName: 'users' as const,
        args: [addr] as const,
      },
      {
        address: CONTRACTS.ETIMToken as `0x${string}`,
        abi: ETIMTokenABI,
        functionName: 'balanceOf' as const,
        args: [addr] as const,
      },
    ]),
    [resolvedAddresses],
  );

  const {
    data: detailResults,
    isLoading: detailsLoading,
  } = useReadContracts({
    contracts: detailContracts,
    query: { enabled: resolvedAddresses.length > 0 },
  });

  // Combine results
  const referrals = useMemo(() => {
    const list: DirectReferralInfo[] = [];
    if (detailResults && resolvedAddresses.length > 0) {
      for (let i = 0; i < resolvedAddresses.length; i++) {
        const userResult = detailResults[i * 2];
        const balanceResult = detailResults[i * 2 + 1];

        let participationTime = 0;
        if (userResult?.status === 'success' && userResult.result) {
          const userData = userResult.result as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, number, bigint, bigint, bigint, boolean, boolean, boolean];
          participationTime = Number(userData[0]);
        }

        let tokenBalance = '0';
        if (balanceResult?.status === 'success' && balanceResult.result) {
          tokenBalance = formatEther(balanceResult.result as bigint);
        }

        list.push({
          address: resolvedAddresses[i],
          participationTime,
          tokenBalance,
        });
      }
    }
    return list;
  }, [detailResults, resolvedAddresses]);

  return {
    referrals,
    totalPages,
    totalCount,
    pageSize: PAGE_SIZE,
    isLoading: addressesLoading || detailsLoading,
  };
}
