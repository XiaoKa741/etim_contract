'use client';

import { useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { DirectReferralList } from './DirectReferralList';
import { SetInviteeCard } from './SetInviteeCard';

interface ReferralCardProps {
  directReferralCount: number;
  referrer: `0x${string}` | undefined;
  teamTokenBalance: string;
  s2PlusActive: boolean;
  s6Active: boolean;
  address: `0x${string}` | undefined;
  isParticipant: boolean;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function ReferralCard({ directReferralCount, referrer, teamTokenBalance, s2PlusActive, s6Active, address, isParticipant }: ReferralCardProps) {
  const { t } = useTranslation();
  const hasReferrer = referrer && referrer !== ZERO_ADDRESS;
  const [showList, setShowList] = useState(false);

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
      <h3 className="text-lg font-semibold text-gray-200 mb-6">{t('referral.title')}</h3>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div className="text-sm text-gray-400">{t('referral.directReferrals')}</div>
          <div className="text-2xl font-bold text-white">{directReferralCount}</div>
        </div>
        <div>
          <div className="text-sm text-gray-400">{t('referral.teamBalance')}</div>
          <div className="text-2xl font-bold text-white">{Number(teamTokenBalance).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
      </div>
      <div className="space-y-3">
        <div>
          <div className="text-sm text-gray-400 mb-1">{t('referral.yourReferrer')}</div>
          {hasReferrer ? (
            <a href={`https://bscscan.com/address/${referrer}`} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 font-mono text-sm break-all">{referrer}</a>
          ) : (
            <span className="text-gray-500 text-sm">{t('referral.noReferrer')}</span>
          )}
        </div>
        <div className="flex gap-2">
          {s2PlusActive && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-300">{t('referral.s2Active')}</span>}
          {s6Active && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-yellow-500/20 text-yellow-300">{t('referral.s6Active')}</span>}
          {!s2PlusActive && !s6Active && <span className="text-gray-500 text-xs">{t('referral.noEligibility')}</span>}
        </div>
      </div>

      {/* View / Hide referral list toggle */}
      {address && (
        <div className="mt-4 pt-4 border-t border-gray-700/30">
          <button
            onClick={() => setShowList((v) => !v)}
            className="flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            <svg
              className={`w-4 h-4 transition-transform ${showList ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {showList ? t('referral.hideList') : t('referral.viewList')}
            <span className="text-gray-500 text-xs">({directReferralCount})</span>
          </button>
          {showList && (
            <DirectReferralList address={address} totalCount={directReferralCount} />
          )}
        </div>
      )}

      {/* Set Invitee Section */}
      <SetInviteeCard isParticipant={isParticipant} address={address} />
    </div>
  );
}
