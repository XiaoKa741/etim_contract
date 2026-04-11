'use client';

import { useState, useEffect } from 'react';
import { parseEther, formatEther, erc20Abi } from 'viem';
import { useWriteContract, useWaitForTransactionReceipt, useAccount, useReadContract } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { CONTRACTS } from '@/config/contracts';
import { ETIMMainABI } from '@/config/abis';
import { useTranslation } from '@/lib/i18n';
import { useGlobalStats } from '@/hooks/useGlobalStats';
import { useNetworkGuard } from '@/hooks/useNetworkGuard';

// BSC bridged ETH (WETH) address
const WETH_ADDRESS = '0x2170Ed0880ac9A755fd29B2688956BD959F933F8' as const;

interface DepositCardProps {
  minEth: bigint | undefined;
  maxEth: bigint | undefined;
  minEthFormatted: string | undefined;
  maxEthFormatted: string | undefined;
  ethPriceFormatted: string | undefined;
}

export function DepositCard({ minEth, maxEth, minEthFormatted, maxEthFormatted, ethPriceFormatted }: DepositCardProps) {
  const { t } = useTranslation();
  const { address } = useAccount();
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<'approve' | 'deposit'>('approve');
  const { dailyQuotaUsed, dailyQuotaLimit, dailyQuotaPercent } = useGlobalStats();
  const { isWrongNetwork, switchToBsc, isSwitching } = useNetworkGuard();

  const queryClient = useQueryClient();

  const { writeContract: writeApprove, data: approveHash, isPending: isApprovePending, error: approveError, reset: resetApprove } = useWriteContract();
  const { isLoading: isApproveConfirming, isSuccess: isApproveSuccess, isError: isApproveError } = useWaitForTransactionReceipt({ hash: approveHash });

  const { writeContract: writeDeposit, data: depositHash, isPending: isDepositPending, error: depositError, reset: resetDeposit } = useWriteContract();
  const { isLoading: isDepositConfirming, isSuccess: isDepositSuccess, isError: isDepositError } = useWaitForTransactionReceipt({ hash: depositHash });

  // Refresh data after approve succeeds
  useEffect(() => {
    if (isApproveSuccess) {
      queryClient.invalidateQueries();
    }
  }, [isApproveSuccess, queryClient]);

  // Refresh data after deposit succeeds
  useEffect(() => {
    if (isDepositSuccess) {
      queryClient.invalidateQueries();
    }
  }, [isDepositSuccess, queryClient]);

  // Reset write state if on-chain tx failed (so button becomes clickable again)
  useEffect(() => {
    if (isApproveError) resetApprove();
  }, [isApproveError, resetApprove]);

  useEffect(() => {
    if (isDepositError) resetDeposit();
  }, [isDepositError, resetDeposit]);

  // Read WETH balance
  const { data: wethBalance } = useReadContract({
    address: WETH_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
  });

  // Read WETH allowance
  const { data: wethAllowance } = useReadContract({
    address: WETH_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, CONTRACTS.ETIMMain] : undefined,
  });

  const amountWei = (() => {
    try {
      if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return undefined;
      return parseEther(amount);
    } catch {
      return undefined;
    }
  })();

  const isAmountValid = amountWei !== undefined && minEth !== undefined && maxEth !== undefined
    && amountWei >= minEth && amountWei <= maxEth;

  const hasEnoughBalance = amountWei !== undefined && wethBalance !== undefined
    && wethBalance >= amountWei;

  const needsApproval = amountWei !== undefined && wethAllowance !== undefined
    && wethAllowance < amountWei;

  const canApprove = isAmountValid && hasEnoughBalance && needsApproval && !isApprovePending && !isApproveConfirming;
  const canDeposit = isAmountValid && hasEnoughBalance && !needsApproval && !isDepositPending && !isDepositConfirming;

  const handleApprove = () => {
    if (!amountWei) return;
    if (isWrongNetwork) { switchToBsc(); return; }
    setStep('approve');
    writeApprove({
      address: WETH_ADDRESS,
      abi: erc20Abi,
      functionName: 'approve',
      args: [CONTRACTS.ETIMMain, amountWei],
    });
  };

  const handleDeposit = () => {
    if (!amountWei) return;
    if (isWrongNetwork) { switchToBsc(); return; }
    setStep('deposit');
    writeDeposit({
      address: CONTRACTS.ETIMMain,
      abi: ETIMMainABI,
      functionName: 'deposit',
      args: [amountWei],
    });
  };

  const setMinAmount = () => {
    if (minEthFormatted) setAmount(minEthFormatted);
  };

  const setMaxAmount = () => {
    if (maxEthFormatted) setAmount(maxEthFormatted);
  };

  const error = approveError || depositError;

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
      <h3 className="text-lg font-semibold text-gray-200 mb-4">{t('deposit.title')}</h3>

      {isDepositSuccess ? (
        <div className="text-center py-4">
          <div className="w-12 h-12 mx-auto mb-3 bg-green-500/10 rounded-full flex items-center justify-center">
            <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-green-400 font-semibold">{t('deposit.success')}</p>
          <p className="text-gray-400 text-sm mt-1">{t('deposit.successDesc')}</p>
        </div>
      ) : (
        <>
          <div className="mb-4">
            <label className="text-sm text-gray-400 mb-1.5 block">{t('deposit.amount')}</label>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '' || /^\d*\.?\d*$/.test(val)) setAmount(val);
                }}
                placeholder={minEthFormatted ? `${minEthFormatted} - ${maxEthFormatted}` : '0.0'}
                className="w-full bg-gray-900/50 border border-gray-600 rounded-lg px-4 py-3 pr-16 text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none transition-colors"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">ETH</span>
            </div>

            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={setMinAmount}
                className="text-xs px-2.5 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
              >
                MIN
              </button>
              <button
                onClick={setMaxAmount}
                className="text-xs px-2.5 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
              >
                MAX
              </button>
              {wethBalance !== undefined && (
                <span className="text-xs text-gray-500 ml-auto">
                  {t('deposit.balance')}: {Number(formatEther(wethBalance)).toFixed(4)} ETH
                </span>
              )}
            </div>
          </div>

           {/* Daily deposit quota progress bar */}
          {dailyQuotaLimit !== undefined && dailyQuotaLimit > 0n && (() => {
            // Calculate next UTC 0:00 in user's local time
            const now = new Date();
            const nextUtcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
            const resetTimeStr = nextUtcMidnight.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const hoursLeft = Math.max(0, Math.floor((nextUtcMidnight.getTime() - now.getTime()) / 3600000));
            const minsLeft = Math.max(0, Math.floor(((nextUtcMidnight.getTime() - now.getTime()) % 3600000) / 60000));

            return (
            <div className="bg-gray-900/50 rounded-lg p-3 mb-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-gray-400">{t('deposit.dailyQuota')}</span>
                <span className="text-xs text-gray-300">
                  {Number(formatEther(dailyQuotaUsed ?? 0n)).toFixed(2)} / {Number(formatEther(dailyQuotaLimit)).toFixed(2)} ETH
                </span>
              </div>
              <div className="w-full h-2.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    (dailyQuotaPercent ?? 0) >= 90 ? 'bg-red-500' :
                    (dailyQuotaPercent ?? 0) >= 70 ? 'bg-yellow-500' :
                    'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(dailyQuotaPercent ?? 0, 100)}%` }}
                />
              </div>
              <div className="flex justify-between items-center mt-1.5">
                <span className="text-xs text-gray-500">
                  {t('deposit.remaining')}: {Number(formatEther((dailyQuotaLimit) - (dailyQuotaUsed ?? 0n))).toFixed(4)} ETH
                </span>
                <span className={`text-xs font-medium ${
                  (dailyQuotaPercent ?? 0) >= 90 ? 'text-red-400' :
                  (dailyQuotaPercent ?? 0) >= 70 ? 'text-yellow-400' :
                  'text-green-400'
                }`}>
                  {(dailyQuotaPercent ?? 0).toFixed(1)}%
                </span>
              </div>
              <div className="text-xs text-gray-500 mt-1.5 text-center">
                {t('deposit.resetTime')}: {resetTimeStr} ({hoursLeft}h {minsLeft}m)
              </div>
              {(dailyQuotaPercent ?? 0) >= 100 && (
                <p className="text-red-400 text-xs mt-2 text-center font-medium">
                  {t('deposit.quotaReached')}
                </p>
              )}
            </div>
            );
          })()}

          {/* Range info */}
          <div className="bg-gray-900/50 rounded-lg p-3 mb-4 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">{t('deposit.range')}</span>
              <span className="text-gray-300">{minEthFormatted ?? '...'} - {maxEthFormatted ?? '...'} ETH</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">{t('deposit.ethPrice')}</span>
              <span className="text-gray-300">${ethPriceFormatted ?? '...'}</span>
            </div>
            {amountWei !== undefined && ethPriceFormatted && (
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">{t('deposit.usdValue')}</span>
                <span className="text-gray-300">~${(Number(amount) * Number(ethPriceFormatted.replace(/,/g, ''))).toFixed(2)}</span>
              </div>
            )}
          </div>

          {/* Validation messages */}
          {amount && amountWei !== undefined && !isAmountValid && (
            <p className="text-red-400 text-xs mb-3">
              {amountWei < (minEth ?? 0n) ? t('deposit.tooLow') : t('deposit.tooHigh')}
            </p>
          )}
          {amount && amountWei !== undefined && !hasEnoughBalance && isAmountValid && (
            <p className="text-red-400 text-xs mb-3">{t('deposit.insufficientBalance')}</p>
          )}

          {/* Error from contract */}
          {error && (
            <p className="text-red-400 text-xs mb-3 break-all">
              {error.message.includes('AlreadyParticipated') ? t('deposit.alreadyParticipated') :
               error.message.includes('NoReferralBinding') ? t('deposit.noReferral') :
               error.message.includes('User denied') || error.message.includes('rejected') ? t('deposit.rejected') :
               t('deposit.error')}
            </p>
          )}

          {/* Two-step: Approve then Deposit */}
          {needsApproval ? (
            <button
              onClick={handleApprove}
              disabled={!canApprove}
              className="w-full py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold rounded-xl transition-colors"
            >
              {isApprovePending ? t('deposit.confirming') : isApproveConfirming ? t('deposit.processing') : `Approve ETH`}
            </button>
          ) : (
            <button
              onClick={handleDeposit}
              disabled={!canDeposit}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold rounded-xl transition-colors"
            >
              {isDepositPending ? t('deposit.confirming') : isDepositConfirming ? t('deposit.processing') : t('deposit.button')}
            </button>
          )}
        </>
      )}
    </div>
  );
}
