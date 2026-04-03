'use client';

import { TOKENOMICS, DEPOSIT_ALLOCATION } from '@/lib/constants';
import { useTranslation } from '@/lib/i18n';
import { useLevelConditions } from '@/hooks/useLevelConditions';

export function TokenomicsSection() {
  const { t } = useTranslation();
  const levelRequirements = useLevelConditions();

  return (
    <section className="py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">{t('tokenomics.title')}</h2>
          <p className="text-gray-400">{t('tokenomics.subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-16">
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
            <h3 className="text-xl font-semibold mb-6">{t('tokenomics.distribution')}</h3>
            <div className="space-y-3">
              {TOKENOMICS.map((item) => (
                <div key={item.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-300">{item.name}</span>
                    <span className="text-gray-400">{item.amount} ({item.percent}%)</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div className={`${item.color} h-2 rounded-full transition-all`} style={{ width: `${Math.max(item.percent, 1)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
            <h3 className="text-xl font-semibold mb-6">{t('tokenomics.depositAllocation')}</h3>
            <div className="space-y-3">
              {DEPOSIT_ALLOCATION.map((item) => (
                <div key={item.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-300">{item.name}</span>
                    <span className="text-gray-400">{item.percent}%</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div className={`${item.color} h-2 rounded-full transition-all`} style={{ width: `${item.percent}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6 overflow-x-auto">
          <h3 className="text-xl font-semibold mb-6">{t('tokenomics.levelSystem')}</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400">
                <th className="text-left py-3 px-4">{t('tokenomics.level')}</th>
                <th className="text-left py-3 px-4">{t('tokenomics.directReferrals')}</th>
                <th className="text-left py-3 px-4">{t('tokenomics.personalEtim')}</th>
                <th className="text-left py-3 px-4">{t('tokenomics.teamEtim')}</th>
                <th className="text-left py-3 px-4">{t('tokenomics.miningBoost')}</th>
              </tr>
            </thead>
            <tbody>
              {levelRequirements.map((lvl, i) => (
                <tr key={lvl.level} className="border-b border-gray-700/50 hover:bg-gray-700/20">
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      i === 6 ? 'bg-yellow-500/20 text-yellow-300' :
                      i >= 4 ? 'bg-red-500/20 text-red-300' :
                      i >= 2 ? 'bg-blue-500/20 text-blue-300' :
                      i === 1 ? 'bg-green-500/20 text-green-300' :
                      'bg-gray-500/20 text-gray-300'
                    }`}>{lvl.level}</span>
                  </td>
                  <td className="py-3 px-4 text-gray-300">{lvl.referrals}</td>
                  <td className="py-3 px-4 text-gray-300">{lvl.personal}</td>
                  <td className="py-3 px-4 text-gray-300">{lvl.team}</td>
                  <td className="py-3 px-4 text-green-400">+{lvl.acceleration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
