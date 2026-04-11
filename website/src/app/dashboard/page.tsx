'use client';

import { useAccount } from 'wagmi';
import { ConnectButton } from '@/components/ConnectButton';
import { formatEther } from 'viem';
import { useUserInfo } from '@/hooks/useUserInfo';
import { useClaimable } from '@/hooks/useClaimable';
import { useParticipationConfig } from '@/hooks/useParticipationConfig';
import { LevelCard } from '@/components/LevelCard';
import { UserInfoCard } from '@/components/UserInfoCard';
import { ReferralCard } from '@/components/ReferralCard';
import { RewardsCard } from '@/components/RewardsCard';
import { StatsCard } from '@/components/StatsCard';
import { DepositCard } from '@/components/DepositCard';
import { useTranslation } from '@/lib/i18n';
import { CONTRACTS } from '@/config/contracts';
import { useNetworkGuard } from '@/hooks/useNetworkGuard';

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const { user, referrer, tokenBalance, nodeBalance, smallZoneTokens, isLoading } = useUserInfo(address);
  const { miningReward, nodeReward, s2PlusReward, s3PlusReward, s6Reward } = useClaimable(address);
  const { t } = useTranslation();
  const config = useParticipationConfig();
  const { isWrongNetwork, switchToBsc, isSwitching } = useNetworkGuard();

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

      {isWrongNetwork && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <p className="text-red-400 text-sm font-semibold">{t('network.wrongNetwork')}</p>
            <p className="text-red-400/70 text-xs mt-1">{t('network.switchDesc')}</p>
          </div>
          <button
            onClick={switchToBsc}
            disabled={isSwitching}
            className="px-5 py-2 bg-red-600 hover:bg-red-500 disabled:bg-red-800 text-white text-sm font-semibold rounded-lg transition-colors shrink-0"
          >
            {isSwitching ? t('connect.switching') : t('connect.switchBsc')}
          </button>
        </div>
      )}

      {!user?.isParticipant && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-5 mb-6">
          <p className="text-yellow-300 text-sm font-medium mb-4">{t('dashboard.notParticipated')}</p>

          {/* Step 1 */}
          <div className="mb-4">
            {referrer && referrer !== '0x0000000000000000000000000000000000000000' ? (
              <>
                <p className="text-green-400 text-sm font-medium flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  {t('dashboard.step1Title')}
                </p>
                <p className="text-gray-500 text-xs mt-1 ml-6">
                  Referrer: {referrer.slice(0, 6)}...{referrer.slice(-4)}
                </p>
              </>
            ) : (
              <>
                <p className="text-yellow-200 text-sm font-medium">{t('dashboard.step1Title')}</p>
                <p className="text-yellow-200/70 text-xs mt-1 ml-3">{t('dashboard.step1Desc')}</p>
              </>
            )}
          </div>

          {/* Step 2 */}
          <div className="mb-4">
            <p className="text-yellow-200 text-sm font-medium">{t('dashboard.step2Title')}</p>
            {config.minEthFormatted && config.maxEthFormatted && (
              <p className="text-yellow-200/70 text-xs mt-1.5 ml-3">
                {t('dashboard.step2Range')}: <span className="text-yellow-100 font-medium">{config.minEthFormatted} - {config.maxEthFormatted} ETH</span>
              </p>
            )}
            <div className="mt-2 ml-3 space-y-1.5">
              <p className="text-yellow-200/70 text-xs flex items-start gap-1.5">
                <span className="text-yellow-300 font-medium shrink-0">A.</span>
                {t('dashboard.step2OptionA')}
              </p>
              <p className="text-yellow-200/70 text-xs flex items-start gap-1.5">
                <span className="text-yellow-300 font-medium shrink-0">B.</span>
                {t('dashboard.step2OptionB')}
              </p>
            </div>
            <p className="text-yellow-300/50 text-xs mt-1.5 ml-3">{t('dashboard.step2Note')}</p>
          </div>

          {/* Tips */}
          <div className="space-y-1 ml-3">
            <p className="text-yellow-300/70 text-xs">💡 {t('dashboard.participationTip')}</p>
            <p className="text-yellow-300/70 text-xs">💡 {t('dashboard.bnbClaimTip')}</p>
          </div>

          {/* Node holder quota info */}
          {Number(nodeBalance) > 0 && (
            <div className="mt-3 pt-3 border-t border-yellow-500/20">
              <p className="text-yellow-300/80 text-sm">
                📊 {t('dashboard.nodeHolding')}: <span className="text-yellow-100 font-medium">{Number(nodeBalance)}</span>
              </p>
              <p className="text-yellow-300/60 text-xs mt-1">
                {t('dashboard.maxQuota')}: ${150 + Number(nodeBalance) * 300}
                {config.ethPriceInUsd && (
                  <span className="text-yellow-200/80"> (~{((150 + Number(nodeBalance) * 300) * 1e6 / Number(config.ethPriceInUsd) / 1e18).toFixed(4)} ETH)</span>
                )}
              </p>
            </div>
          )}

          {/* ETH price and contract address */}
          <div className="mt-3 pt-3 border-t border-yellow-500/20 flex flex-wrap items-center justify-between gap-2">
            {config.ethPriceFormatted && (
              <p className="text-yellow-300/60 text-xs">
                {t('dashboard.ethPrice')}: <span className="text-yellow-300/80">${config.ethPriceFormatted}</span>
              </p>
            )}
            <div className="flex items-center gap-2">
              <p className="text-yellow-300/60 text-xs">{t('dashboard.depositContract')}:</p>
              <code className="text-yellow-200/80 text-xs bg-yellow-500/10 px-2 py-0.5 rounded font-mono break-all">
                {CONTRACTS.ETIMMain}
              </code>
              <button
                onClick={() => { try { navigator.clipboard.writeText(CONTRACTS.ETIMMain); } catch {} }}
                className="text-yellow-400 hover:text-yellow-300 text-xs transition-colors shrink-0"
                title={t('dashboard.copyAddress')}
              >
                {t('dashboard.copy')}
              </button>
            </div>
          </div>
        </div>
      )}

      {!user?.isParticipant && (
        <div className="mb-6">
          <DepositCard
            minEth={config.minEth}
            maxEth={config.maxEth}
            minEthFormatted={config.minEthFormatted}
            maxEthFormatted={config.maxEthFormatted}
            ethPriceFormatted={config.ethPriceFormatted}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LevelCard level={user?.level ?? 0} directReferrals={user?.directReferralCount ?? 0} personalTokens={formatEther(tokenBalance)} totalTeamTokens={user?.teamTokenBalance ?? '0'} smallZoneTokens={formatEther(smallZoneTokens)} />
        <UserInfoCard investedEth={user?.investedEthAmount ?? '0'} investedUsd={user?.investedValueInUsd ?? 0} claimedUsd={user?.claimedValueInUsd ?? 0} participationTime={user?.participationTime ?? 0} lastClaimTime={user?.lastClaimTime ?? 0} />
        <ReferralCard directReferralCount={user?.directReferralCount ?? 0} referrer={referrer ?? undefined} teamTokenBalance={user?.teamTokenBalance ?? '0'} s2PlusActive={user?.s2PlusActive ?? false} s6Active={user?.s6Active ?? false} address={address} />
        <RewardsCard miningReward={miningReward} nodeReward={nodeReward} s2PlusReward={s2PlusReward} s3PlusReward={s3PlusReward} s6Reward={s6Reward} isParticipant={user?.isParticipant ?? false} level={user?.level ?? 0} syncedNodeCount={user?.syncedNodeCount ?? 0} />
      </div>

      <div className="mt-6">
        <StatsCard />
      </div>
    </div>
  );
}
