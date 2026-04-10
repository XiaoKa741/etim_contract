'use client';

import { useState, useEffect } from 'react';
import { useReadContracts } from 'wagmi';
import { CONTRACTS } from '@/config/contracts';
import { ETIMMainABI } from '@/config/abis';
import { LEVEL_REQUIREMENTS } from '@/lib/constants';

export interface LevelCondition {
  level: string;
  referrals: number;
  personal: string;
  team: string;
  acceleration: string;
}

// 默认值（立即显示，避免空白）
const DEFAULT_CONDITIONS: LevelCondition[] = LEVEL_REQUIREMENTS;

export function useLevelConditions() {
  const [conditions, setConditions] = useState<LevelCondition[]>(DEFAULT_CONDITIONS);

  // 批量读取 7 个 level 的条件
  const { data, isSuccess } = useReadContracts({
    contracts: Array.from({ length: 7 }, (_, i) => ({
      address: CONTRACTS.ETIMMain,
      abi: ETIMMainABI,
      functionName: 'levelConditions',
      args: [i],
    })),
  });

  // 链上数据返回后更新
  useEffect(() => {
    if (isSuccess && data) {
      const updated = data.map((result, i) => {
        if (result.status === 'success' && result.result) {
          const [referrals, personal, team, acceleration] = result.result as unknown as [bigint, bigint, bigint, bigint];
          return {
            level: `S${i}`,
            referrals: Number(referrals),
            personal: Number(personal / (10n ** 18n)).toLocaleString(),
            team: Number(team / (10n ** 18n)).toLocaleString(),
            acceleration: `${acceleration}%`,
          };
        }
        return DEFAULT_CONDITIONS[i];
      });
      setConditions(updated);
    }
  }, [isSuccess, data]);

  return conditions;
}
