'use client';

import { useAccount } from 'wagmi';
import { ConnectButton } from '@/components/ConnectButton';
import { formatEther } from 'viem';
import { useUserInfo } from '@/hooks/useUserInfo';
import { useClaimable } from '@/hooks/useClaimable';
import { LevelCard } from '@/components/LevelCard';
import { UserInfoCard } from '@/components/UserInfoCard';
import { ReferralCard } from '@/components/ReferralCard';
import { RewardsCard } from '@/components/RewardsCard';
import { StatsCard } from '@/components/StatsCard';
import { useTranslation } from '@/lib/i18n';

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const { user, referrer, tokenBalance, nodeBalance, isLoading } = useUserInfo(address);
  const { miningReward, nodeReward, s2PlusReward, s3PlusReward, s6Reward } = useClaimable(address);
  const { t } = useTranslation();

  if (!isConnected) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center px-4">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-6 bg-indigo-500/10 rounded-2xl flex items-center justify-center">
            <svg className="w-10 h-10 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-3">{t('dashboard.connectTitle')}</h1>
          <p className="text-gray-400 mb-6 max-w-md">{t('dashboard.connectDesc')}</p>
          <ConnectButton />
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">{t('dashboard.loadingData')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('dashboard.title')}</h1>
          <p className="text-gray-400 text-sm font-mono">{address?.slice(0, 6)}...{address?.slice(-4)}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg px-4 py-2">
            <div className="text-xs text-gray-400">{t('dashboard.etimBalance')}</div>
            <div className="text-lg font-bold text-white">{Number(formatEther(tokenBalance)).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg px-4 py-2">
            <div className="text-xs text-gray-400">{t('dashboard.nodeNfts')}</div>
            <div className="text-lg font-bold text-white">{Number(nodeBalance)}</div>
          </div>
        </div>
      </div>

      {!user?.isParticipant && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 mb-6">
          <p className="text-yellow-300 text-sm">{t('dashboard.notDeposited')}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LevelCard level={user?.level ?? 0} directReferrals={user?.directReferralCount ?? 0} personalTokens={formatEther(tokenBalance)} teamTokens={user?.teamTokenBalance ?? '0'} />
        <UserInfoCard investedEth={user?.investedEthAmount ?? '0'} investedUsd={user?.investedValueInUsd ?? 0} claimedUsd={user?.claimedValueInUsd ?? 0} participationTime={user?.participationTime ?? 0} lastClaimTime={user?.lastClaimTime ?? 0} />
        <ReferralCard directReferralCount={user?.directReferralCount ?? 0} referrer={referrer ?? undefined} teamTokenBalance={user?.teamTokenBalance ?? '0'} s2PlusActive={user?.s2PlusActive ?? false} s6Active={user?.s6Active ?? false} />
        <RewardsCard miningReward={miningReward} nodeReward={nodeReward} s2PlusReward={s2PlusReward} s3PlusReward={s3PlusReward} s6Reward={s6Reward} isParticipant={user?.isParticipant ?? false} level={user?.level ?? 0} syncedNodeCount={user?.syncedNodeCount ?? 0} />
      </div>

      <div className="mt-6">
        <StatsCard />
      </div>
    </div>
  );
}
