'use client';

import { useTranslation } from '@/lib/i18n';

interface UserInfoCardProps {
  investedEth: string;
  investedUsd: number;
  claimedUsd: number;
  participationTime: number;
  lastClaimTime: number;
}

function formatDate(timestamp: number, neverLabel: string): string {
  if (timestamp === 0) return neverLabel;
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function UserInfoCard({ investedEth, investedUsd, claimedUsd, participationTime, lastClaimTime }: UserInfoCardProps) {
  const { t } = useTranslation();
  const roiProgress = investedUsd > 0 ? (claimedUsd / investedUsd) * 100 : 0;

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
      <h3 className="text-lg font-semibold text-gray-200 mb-6">{t('userInfo.title')}</h3>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div className="text-sm text-gray-400">{t('userInfo.investedEth')}</div>
          <div className="text-xl font-bold text-white">{Number(investedEth).toFixed(4)}</div>
        </div>
        <div>
          <div className="text-sm text-gray-400">{t('userInfo.investedValue')}</div>
          <div className="text-xl font-bold text-white">${investedUsd.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-sm text-gray-400">{t('userInfo.claimedValue')}</div>
          <div className="text-xl font-bold text-green-400">${claimedUsd.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-sm text-gray-400">{t('userInfo.roiRecovery')}</div>
          <div className="text-xl font-bold text-indigo-400">{roiProgress.toFixed(1)}%</div>
        </div>
      </div>
      {investedUsd > 0 && (
        <div className="mb-4">
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div className="bg-gradient-to-r from-indigo-500 to-purple-500 h-2 rounded-full transition-all" style={{ width: `${Math.min(roiProgress, 100)}%` }} />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {roiProgress >= 100 ? t('userInfo.principalRecovered') : `$${(investedUsd - claimedUsd).toFixed(2)} ${t('userInfo.remaining')}`}
          </p>
        </div>
      )}
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('userInfo.joined')}</span>
          <span className="text-gray-300">{formatDate(participationTime, t('userInfo.never'))}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('userInfo.lastClaim')}</span>
          <span className="text-gray-300">{formatDate(lastClaimTime, t('userInfo.never'))}</span>
        </div>
      </div>
    </div>
  );
}
