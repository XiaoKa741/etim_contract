'use client';

import { formatEther } from 'viem';
import { useGlobalStats } from '@/hooks/useGlobalStats';
import { useTranslation } from '@/lib/i18n';

export function StatsCard() {
  const { totalUsers, totalDeposited, totalActiveNodes, remainingPool, isPoolDepleted, s2PlusCount, s6Count, s6RewardPool, poolEthReserves, poolEtimReserves, etimPriceInUsd, dailyQuotaUsed, dailyQuotaLimit, dailyQuotaPercent } = useGlobalStats();
  const { t } = useTranslation();

  const stats = [
    { label: t('stats.totalUsers'), value: totalUsers !== undefined ? Number(totalUsers).toLocaleString() : '—' },
    { label: t('stats.totalDeposited'), value: totalDeposited !== undefined ? `${Number(formatEther(totalDeposited)).toFixed(2)} ETH` : '—' },
    { label: t('stats.activeNodes'), value: totalActiveNodes !== undefined ? Number(totalActiveNodes).toLocaleString() : '—' },
    { label: t('stats.remainingPool'), value: remainingPool !== undefined ? `${Number(formatEther(remainingPool)).toLocaleString(undefined, { maximumFractionDigits: 0 })} ETIM` : '—' },
    { label: t('stats.s2PlusPlayers'), value: s2PlusCount !== undefined ? Number(s2PlusCount).toLocaleString() : '—' },
    { label: t('stats.s6Players'), value: s6Count !== undefined ? Number(s6Count).toLocaleString() : '—' },
    { label: t('stats.s6RewardPool'), value: s6RewardPool !== undefined ? `${Number(formatEther(s6RewardPool)).toLocaleString(undefined, { maximumFractionDigits: 4 })} ETIM` : '—' },
    { label: t('stats.etimPrice'), value: etimPriceInUsd !== undefined ? `$${etimPriceInUsd < 0.0001 ? etimPriceInUsd.toExponential(2) : etimPriceInUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}` : '—' },
    { label: t('stats.poolEth'), value: poolEthReserves !== undefined ? `${Number(formatEther(poolEthReserves)).toLocaleString(undefined, { maximumFractionDigits: 4 })} ETH` : '—' },
    { label: t('stats.poolEtim'), value: poolEtimReserves !== undefined ? `${Number(formatEther(poolEtimReserves)).toLocaleString(undefined, { maximumFractionDigits: 0 })} ETIM` : '—' },
    { label: t('stats.dailyQuota'), value: dailyQuotaLimit !== undefined && dailyQuotaLimit > 0n
      ? `${Number(formatEther(dailyQuotaUsed ?? 0n)).toFixed(2)} / ${Number(formatEther(dailyQuotaLimit)).toFixed(2)} ETH (${(dailyQuotaPercent ?? 0).toFixed(1)}%)`
      : '—' },
  ];

  // Calculate reset time in user's local timezone (UTC 0:00)
  const now = new Date();
  const nextUtcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  const resetTimeStr = nextUtcMidnight.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const hoursLeft = Math.max(0, Math.floor((nextUtcMidnight.getTime() - now.getTime()) / 3600000));
  const minsLeft = Math.max(0, Math.floor(((nextUtcMidnight.getTime() - now.getTime()) % 3600000) / 60000));

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-200">{t('stats.title')}</h3>
        {isPoolDepleted !== undefined && (
          <span className={`text-xs px-2.5 py-0.5 rounded-full ${isPoolDepleted ? 'bg-red-500/20 text-red-300' : 'bg-green-500/20 text-green-300'}`}>
            {isPoolDepleted ? t('stats.poolDepleted') : t('stats.miningActive')}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {stats.map((stat) => (
          <div key={stat.label}>
            <div className="text-sm text-gray-400">{stat.label}</div>
            <div className="text-lg font-bold text-white">{stat.value}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-gray-700/50 text-xs text-gray-500 text-center">
        {t('stats.resetInfo')}: {resetTimeStr} ({hoursLeft}h {minsLeft}m)
      </div>
    </div>
  );
}
