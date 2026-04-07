'use client';

import { useState } from 'react';
import { parseEther, formatEther, erc20Abi } from 'viem';
import { useWriteContract, useWaitForTransactionReceipt, useAccount, useReadContract } from 'wagmi';
import { CONTRACTS } from '@/config/contracts';
import { ETIMMainABI } from '@/config/abis';
import { useTranslation } from '@/lib/i18n';

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

  const { writeContract: writeApprove, data: approveHash, isPending: isApprovePending, error: approveError } = useWriteContract();
  const { isLoading: isApproveConfirming, isSuccess: isApproveSuccess } = useWaitForTransactionReceipt({ hash: approveHash });

  const { writeContract: writeDeposit, data: depositHash, isPending: isDepositPending, error: depositError } = useWriteContract();
  const { isLoading: isDepositConfirming, isSuccess: isDepositSuccess } = useWaitForTransactionReceipt({ hash: depositHash });

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
