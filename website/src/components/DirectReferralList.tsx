'use client';

import { useState } from 'react';
import { useDirectReferrals } from '@/hooks/useDirectReferrals';
import { useTranslation } from '@/lib/i18n';

interface DirectReferralListProps {
  address: `0x${string}`;
  totalCount: number;
}

function formatDate(timestamp: number): string {
  if (timestamp === 0) return '-';
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function DirectReferralList({ address, totalCount }: DirectReferralListProps) {
  const [page, setPage] = useState(0);
  const { referrals, totalPages, pageSize, isLoading } = useDirectReferrals(address, totalCount, page);
  const { t } = useTranslation();

  if (totalCount === 0) {
    return (
      <div className="text-center py-6 text-gray-500 text-sm">
        {t('referral.noReferrals')}
      </div>
    );
  }

  return (
    <div className="mt-4">
      <h4 className="text-sm font-semibold text-gray-300 mb-3">{t('referral.listTitle')}</h4>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700/50">
                  <th className="text-left py-2 pr-2 font-medium">{t('referral.index')}</th>
                  <th className="text-left py-2 pr-2 font-medium">{t('referral.address')}</th>
                  <th className="text-left py-2 pr-2 font-medium">{t('referral.joinTime')}</th>
                  <th className="text-right py-2 font-medium">{t('referral.tokenHolding')}</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((ref, i) => (
                  <tr key={ref.address} className="border-b border-gray-700/30 hover:bg-gray-700/20 transition-colors">
                    <td className="py-2.5 pr-2 text-gray-400">{page * pageSize + i + 1}</td>
                    <td className="py-2.5 pr-2">
                      <a
                        href={`https://bscscan.com/address/${ref.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-400 hover:text-indigo-300 font-mono transition-colors"
                      >
                        {shortenAddress(ref.address)}
                      </a>
                    </td>
                    <td className="py-2.5 pr-2 text-gray-300">
                      {ref.participationTime > 0 ? formatDate(ref.participationTime) : (
                        <span className="text-gray-500">{t('referral.notParticipated')}</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right text-gray-300">
                      {Number(ref.tokenBalance).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-700/30">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-700/50 text-gray-300 hover:bg-gray-600/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                {t('referral.prev')}
              </button>
              <span className="text-xs text-gray-400">
                {t('referral.page').replace('{current}', String(page + 1)).replace('{total}', String(totalPages))}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-700/50 text-gray-300 hover:bg-gray-600/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                {t('referral.next')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
