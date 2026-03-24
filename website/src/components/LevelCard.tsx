'use client';

import { LEVEL_NAMES, LEVEL_COLORS, LEVEL_REQUIREMENTS } from '@/lib/constants';
import { useTranslation } from '@/lib/i18n';

interface LevelCardProps {
  level: number;
  directReferrals: number;
  personalTokens: string;
  teamTokens: string;
}

export function LevelCard({ level, directReferrals, personalTokens, teamTokens }: LevelCardProps) {
  const { t } = useTranslation();
  const currentLevel = LEVEL_NAMES[level] ?? 'S0';
  const gradient = LEVEL_COLORS[level] ?? LEVEL_COLORS[0];
  const nextLevel = level < 6 ? LEVEL_REQUIREMENTS[level + 1] : null;

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-200">{t('level.title')}</h3>
        <div className={`bg-gradient-to-r ${gradient} text-white text-2xl font-bold px-4 py-2 rounded-xl`}>
          {currentLevel}
        </div>
      </div>
      <div className="space-y-4">
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-400">{t('level.directReferrals')}</span>
            <span className="text-white">{directReferrals}{nextLevel ? ` / ${nextLevel.referrals}` : ''}</span>
          </div>
          {nextLevel && (
            <div className="w-full bg-gray-700 rounded-full h-1.5">
              <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${Math.min((directReferrals / nextLevel.referrals) * 100, 100)}%` }} />
            </div>
          )}
        </div>
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-400">{t('level.personalEtim')}</span>
            <span className="text-white">{Number(personalTokens).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
        </div>
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-400">{t('level.teamEtim')}</span>
            <span className="text-white">{Number(teamTokens).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
        </div>
      </div>
      {nextLevel && (
        <div className="mt-4 pt-4 border-t border-gray-700">
          <p className="text-xs text-gray-500">
            {t('level.nextLevel')} ({nextLevel.level}): {nextLevel.referrals} {t('level.referrals')}, {nextLevel.personal} {t('level.personal')}, {nextLevel.team} {t('level.team')}
          </p>
        </div>
      )}
      {level === 6 && (
        <div className="mt-4 pt-4 border-t border-gray-700">
          <p className="text-xs text-yellow-400">{t('level.maxLevel')}</p>
        </div>
      )}
    </div>
  );
}
