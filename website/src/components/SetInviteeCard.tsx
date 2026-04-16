'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from '@/lib/i18n';
import { useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { CONTRACTS } from '@/config/contracts';
import { ETIMMainABI } from '@/config/abis';
import { isAddress, getAddress } from 'viem';

interface SetInviteeCardProps {
  isParticipant: boolean;
  address: `0x${string}` | undefined;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const MAX_ADDRESSES = 20;

type AddressStatus = {
  address: string;
  status: 'valid' | 'invalid' | 'zero' | 'self' | 'hasReferrer' | 'loading';
  referrer?: string;
};

export function SetInviteeCard({ isParticipant, address }: SetInviteeCardProps) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [successMessage, setSuccessMessage] = useState(false);

  // Parse addresses from input (with deduplication)
  const parsedAddresses = useMemo(() => {
    const lines = inputValue.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    // Deduplicate by lowercase address
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        unique.push(line);
      }
    }
    return unique;
  }, [inputValue]);

  // Check if exceeds limit
  const exceedsLimit = parsedAddresses.length > MAX_ADDRESSES;

  // Validate addresses (only if not exceeding limit)
  const validatedAddresses = useMemo(() => {
    if (exceedsLimit) return []; // Skip validation if exceeds limit

    const result: AddressStatus[] = [];
    for (const line of parsedAddresses) {
      if (!isAddress(line)) {
        result.push({ address: line, status: 'invalid' });
      } else if (line.toLowerCase() === ZERO_ADDRESS) {
        result.push({ address: line, status: 'zero' });
      } else if (address && line.toLowerCase() === address.toLowerCase()) {
        result.push({ address: line, status: 'self' });
      } else {
        result.push({ address: getAddress(line), status: 'loading' });
      }
    }
    return result;
  }, [parsedAddresses, address, exceedsLimit]);

  // Get addresses that need referrer check
  const addressesToCheck = useMemo(() => {
    return validatedAddresses
      .filter(item => item.status === 'loading')
      .map(item => item.address as `0x${string}`);
  }, [validatedAddresses]);

  // Batch query referrerOf for each address
  const contracts = useMemo(() => {
    return addressesToCheck.map(addr => ({
      address: CONTRACTS.ETIMMain,
      abi: ETIMMainABI,
      functionName: 'referrerOf' as const,
      args: [addr] as const,
    }));
  }, [addressesToCheck]);

  const { data: referrerResults } = useReadContracts({
    contracts,
    query: { enabled: contracts.length > 0 },
  });

  // Combine validation results with referrer data
  const finalAddressStatuses = useMemo(() => {
    const result = [...validatedAddresses];

    if (referrerResults && referrerResults.length > 0) {
      let checkIndex = 0;
      for (let i = 0; i < result.length; i++) {
        if (result[i].status === 'loading' && checkIndex < referrerResults.length) {
          const referrerData = referrerResults[checkIndex];
          checkIndex++;

          if (referrerData.status === 'success') {
            const referrer = referrerData.result as string;
            if (referrer && referrer !== ZERO_ADDRESS) {
              result[i] = { ...result[i], status: 'hasReferrer', referrer };
            } else {
              result[i] = { ...result[i], status: 'valid' };
            }
          }
        }
      }
    }

    return result;
  }, [validatedAddresses, referrerResults]);

  // Get valid addresses for submission
  const validAddresses = useMemo(() => {
    return finalAddressStatuses
      .filter(item => item.status === 'valid')
      .map(item => item.address as `0x${string}`);
  }, [finalAddressStatuses]);

  // Contract write
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  // Handle success
  useEffect(() => {
    if (isSuccess) {
      setSuccessMessage(true);
      setInputValue('');
      setTimeout(() => {
        setSuccessMessage(false);
        setShowForm(false);
      }, 3000);
    }
  }, [isSuccess]);

  const handleSubmit = useCallback(() => {
    if (validAddresses.length === 0) return;

    writeContract({
      address: CONTRACTS.ETIMMain,
      abi: ETIMMainABI,
      functionName: 'setMyInvitee',
      args: [validAddresses],
    });
  }, [validAddresses, writeContract]);

  // Status display helper
  const getStatusDisplay = (item: AddressStatus) => {
    switch (item.status) {
      case 'valid':
        return <span className="text-green-400">✓</span>;
      case 'invalid':
        return <span className="text-red-400" title={t('referral.setInviteeInvalidAddress')}>✗</span>;
      case 'zero':
        return <span className="text-red-400" title={t('referral.setInviteeZeroAddress')}>✗</span>;
      case 'self':
        return <span className="text-red-400" title={t('referral.setInviteeSelfAddress')}>✗</span>;
      case 'hasReferrer':
        return <span className="text-yellow-400" title={`${t('referral.setInviteeAlreadyHasReferrer')}: ${item.referrer}`}>!</span>;
      case 'loading':
        return <span className="text-gray-500">...</span>;
    }
  };

  const getStatusText = (item: AddressStatus) => {
    switch (item.status) {
      case 'valid':
        return '';
      case 'invalid':
        return t('referral.setInviteeInvalidAddress');
      case 'zero':
        return t('referral.setInviteeZeroAddress');
      case 'self':
        return t('referral.setInviteeSelfAddress');
      case 'hasReferrer':
        return t('referral.setInviteeAlreadyHasReferrer');
      default:
        return '';
    }
  };

  if (!isParticipant) {
    return (
      <div className="mt-4 pt-4 border-t border-gray-700/30">
        <p className="text-gray-500 text-sm">{t('referral.setInviteeNotParticipated')}</p>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-gray-700/30">
      <button
        onClick={() => setShowForm(!showForm)}
        className="flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
      >
        <svg
          className={`w-4 h-4 transition-transform ${showForm ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {showForm ? t('referral.setInviteeHideForm') : t('referral.setInviteeShowForm')}
      </button>

      {showForm && (
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-sm text-gray-400 mb-2">{t('referral.setInviteeDesc')}</p>
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={t('referral.setInviteePlaceholder')}
              rows={4}
              className="w-full bg-gray-900/50 border border-gray-700/50 rounded-lg p-3 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-indigo-500/50 font-mono"
              disabled={isPending || isConfirming}
            />
            <p className="text-xs text-gray-500 mt-1">{t('referral.setInviteeMaxHint').replace('{max}', String(MAX_ADDRESSES))}</p>
          </div>

          {/* Exceeds limit warning */}
          {exceedsLimit && (
            <p className="text-sm text-red-400">
              ⚠️ {t('referral.setInviteeExceedsLimit').replace('{max}', String(MAX_ADDRESSES)).replace('{count}', String(parsedAddresses.length))}
            </p>
          )}

          {/* Address validation results */}
          {finalAddressStatuses.length > 0 && (
            <div className="space-y-1">
              {finalAddressStatuses.map((item, index) => (
                <div key={index} className="flex items-center gap-2 text-sm">
                  {getStatusDisplay(item)}
                  <span className="font-mono text-gray-300 truncate max-w-[200px]">{item.address}</span>
                  {getStatusText(item) && (
                    <span className="text-xs text-gray-500">{getStatusText(item)}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Valid count */}
          {validAddresses.length > 0 && !exceedsLimit && (
            <p className="text-sm text-green-400">
              {t('referral.setInviteeValidCount').replace('{count}', String(validAddresses.length))}
            </p>
          )}

          {/* Success message */}
          {successMessage && (
            <p className="text-sm text-green-400">{t('referral.setInviteeSuccess')}</p>
          )}

          {/* Error message */}
          {error && (
            <p className="text-sm text-red-400">{error.message}</p>
          )}

          {/* Submit button */}
          <button
            onClick={handleSubmit}
            disabled={exceedsLimit || validAddresses.length === 0 || isPending || isConfirming}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {isPending
              ? t('referral.setInviteeConfirming')
              : isConfirming
                ? t('referral.setInviteeProcessing')
                : t('referral.setInviteeButton')}
          </button>
        </div>
      )}
    </div>
  );
}
