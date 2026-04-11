'use client';

import { formatEther } from 'viem';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { CONTRACTS } from '@/config/contracts';
import { ETIMMainABI } from '@/config/abis';
import { useTranslation } from '@/lib/i18n';
import { useNetworkGuard } from '@/hooks/useNetworkGuard';

interface RewardsCardProps {
  miningReward: bigint;
  nodeReward: bigint;
  s2PlusReward: bigint;
  s3PlusReward: bigint;
  s6Reward: bigint;
  isParticipant: boolean;
  level: number;
  syncedNodeCount: number;
}

function ClaimButton({ label, amount, unit, functionName, disabled }: {
  label: string;
  amount: bigint;
  unit: string;
  functionName: 'claim' | 'claimNodeRewards' | 'claimS2PlusRewards' | 'claimS3PlusRewards' | 'claimS6Rewards';
  disabled: boolean;
}) {
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { isWrongNetwork, switchToBsc, isSwitching } = useNetworkGuard();

  useEffect(() => {
    if (isSuccess) {
      queryClient.invalidateQueries();
    }
  }, [isSuccess, queryClient]);

  const handleClaim = () => {
    if (isWrongNetwork) {
      switchToBsc();
      return;
    }
    writeContract({ address: CONTRACTS.ETIMMain, abi: ETIMMainABI, functionName });
  };

  const formatted = Number(formatEther(amount));
  const isZero = amount === BigInt(0);

  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-700/50 last:border-0">
      <div>
        <div className="text-sm text-gray-300">{label}</div>
        <div className={`text-lg font-bold ${isZero ? 'text-gray-500' : 'text-green-400'}`}>
          {formatted.toLocaleString(undefined, { maximumFractionDigits: 4 })} {unit}
        </div>
      </div>
      <button
        onClick={handleClaim}
        disabled={disabled || isZero || isPending || isConfirming}
        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-semibold rounded-lg transition-colors"
      >
        {isPending ? t('rewards.confirm') : isConfirming ? t('rewards.claiming') : t('rewards.claim')}
      </button>
    </div>
  );
}

export function RewardsCard({ miningReward, nodeReward, s2PlusReward, s3PlusReward, s6Reward, isParticipant, level, syncedNodeCount }: RewardsCardProps) {
  const { t } = useTranslation();

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
      <h3 className="text-lg font-semibold text-gray-200 mb-4">{t('rewards.title')}</h3>
      {!isParticipant ? (
        <p className="text-gray-500 text-sm">{t('rewards.notParticipated')}</p>
      ) : (
        <div>
          <ClaimButton label={t('rewards.mining')} amount={miningReward} unit="ETIM" functionName="claim" disabled={!isParticipant} />
          <ClaimButton label={t('rewards.node')} amount={nodeReward} unit="ETIM" functionName="claimNodeRewards" disabled={syncedNodeCount === 0} />
          <ClaimButton label={t('rewards.s2Plus')} amount={s2PlusReward} unit="ETH" functionName="claimS2PlusRewards" disabled={level < 2} />
          <ClaimButton label={t('rewards.s3Plus')} amount={s3PlusReward} unit="ETH" functionName="claimS3PlusRewards" disabled={level < 3} />
          <ClaimButton label={t('rewards.s6')} amount={s6Reward} unit="ETIM" functionName="claimS6Rewards" disabled={level < 6} />
        </div>
      )}
    </div>
  );
}
