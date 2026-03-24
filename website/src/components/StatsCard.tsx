'use client';

import { formatEther } from 'viem';
import { useGlobalStats } from '@/hooks/useGlobalStats';
import { useTranslation } from '@/lib/i18n';

export function StatsCard() {
  const { totalUsers, totalDeposited, totalActiveNodes, remainingPool, isPoolDepleted, s2PlusCount, s6Count } = useGlobalStats();
  const { t } = useTranslation();

  const stats = [
    { label: t('stats.totalUsers'), value: totalUsers !== undefined ? Number(totalUsers).toLocaleString() : '—' },
    { label: t('stats.totalDeposited'), value: totalDeposited !== undefined ? `${Number(formatEther(totalDeposited)).toFixed(2)} ETH` : '—' },
    { label: t('stats.activeNodes'), value: totalActiveNodes !== undefined ? Number(totalActiveNodes).toLocaleString() : '—' },
    { label: t('stats.remainingPool'), value: remainingPool !== undefined ? `${Number(formatEther(remainingPool)).toLocaleString(undefined, { maximumFractionDigits: 0 })} ETIM` : '—' },
    { label: t('stats.s2PlusPlayers'), value: s2PlusCount !== undefined ? Number(s2PlusCount).toLocaleString() : '—' },
    { label: t('stats.s6Players'), value: s6Count !== undefined ? Number(s6Count).toLocaleString() : '—' },
  ];

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
    </div>
  );
}
