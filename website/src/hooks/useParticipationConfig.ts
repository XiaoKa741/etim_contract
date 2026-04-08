'use client';

import { useReadContract } from 'wagmi';
import { CONTRACTS } from '@/config/contracts';
import { ETIMMainABI } from '@/config/abis';

export function useParticipationConfig() {
  const { data: ethPriceInUsd } = useReadContract({
    address: CONTRACTS.ETIMMain,
    abi: ETIMMainABI,
    functionName: 'ethPriceInUsd',
  });

  const { data: participationAmountMin } = useReadContract({
    address: CONTRACTS.ETIMMain,
    abi: ETIMMainABI,
    functionName: 'participationAmountMin',
  });

  const { data: participationAmountMax } = useReadContract({
    address: CONTRACTS.ETIMMain,
    abi: ETIMMainABI,
    functionName: 'participationAmountMax',
  });

  const { data: nodeQuota } = useReadContract({
    address: CONTRACTS.ETIMMain,
    abi: ETIMMainABI,
    functionName: 'NODE_QUOTA',
  });

  // Calculate ETH amounts
  // ethPriceInUsd: 6 decimals, participation amounts: 6 decimals
  // ETH amount = (USD amount * 10^18) / ethPriceInUsd
  const minEth = ethPriceInUsd && participationAmountMin
    ? (BigInt(participationAmountMin.toString()) * BigInt(10 ** 18)) / BigInt(ethPriceInUsd.toString())
    : undefined;
  const maxEth = ethPriceInUsd && participationAmountMax
    ? (BigInt(participationAmountMax.toString()) * BigInt(10 ** 18)) / BigInt(ethPriceInUsd.toString())
    : undefined;

  // ETH per node quota (for node users)
  const ethPerNode = ethPriceInUsd && nodeQuota
    ? (BigInt(nodeQuota.toString()) * BigInt(10 ** 18)) / BigInt(ethPriceInUsd.toString())
    : undefined;

  // Format for display (ETH has 18 decimals), auto precision to avoid showing 0.0000
  const formatEth = (wei: bigint | undefined): string | undefined => {
    if (!wei) return undefined;
    const eth = Number(wei) / 1e18;
    if (eth === 0) return '0.0000';
    // Find enough decimal places to show a non-zero value (min 4, max 8)
    for (let d = 4; d <= 8; d++) {
      const formatted = eth.toFixed(d);
      if (Number(formatted) > 0) return formatted;
    }
    return eth.toFixed(8);
  };

  // Format USD price (6 decimals)
  const formatUsdPrice = (price: bigint | undefined): string | undefined => {
    if (!price) return undefined;
    const usd = Number(price) / 1e6;
    return usd.toLocaleString(undefined, { maximumFractionDigits: 0 });
  };

  return {
    ethPriceInUsd: ethPriceInUsd as bigint | undefined,
    participationAmountMin: participationAmountMin as bigint | undefined,
    participationAmountMax: participationAmountMax as bigint | undefined,
    nodeQuota: nodeQuota as bigint | undefined,
    // Calculated values
    minEth,
    maxEth,
    ethPerNode,
    // Formatted strings
    minEthFormatted: formatEth(minEth),
    maxEthFormatted: formatEth(maxEth),
    ethPerNodeFormatted: formatEth(ethPerNode),
    ethPriceFormatted: formatUsdPrice(ethPriceInUsd as bigint | undefined),
  };
}
