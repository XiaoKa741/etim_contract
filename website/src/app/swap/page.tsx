'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useBalance,
  usePublicClient,
} from 'wagmi';
import { formatEther, parseEther, Address, encodeAbiParameters, encodePacked } from 'viem';
import { ConnectButton } from '@/components/ConnectButton';
import { CONTRACTS, UNIVERSAL_ROUTER, PERMIT2_ADDRESS, QUOTER } from '@/config/contracts';
import { ERC20ABI, UniversalRouterABI, QuoterABI } from '@/config/abis';

const ETIMTokenAddress = CONTRACTS.ETIMToken as Address;
const ETIMTaxHookAddress = CONTRACTS.ETIMTaxHook as Address;

// PoolKey
const POOL_KEY = {
  currency0: '0x0000000000000000000000000000000000000000' as Address,
  currency1: ETIMTokenAddress,
  fee: 3000,
  tickSpacing: 60,
  hooks: ETIMTaxHookAddress,
};

// V4 Actions
const V4_ACTION_SWAP_EXACT_IN_SINGLE = 0x06;
const V4_ACTION_SETTLE = 0x0b;
const V4_ACTION_TAKE = 0x0e;

// Constants
const CMD_V4_SWAP = '0x10';
const ETH_GAS_BUFFER = parseEther('0.005');
const FULL_DELTA_AMOUNT = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

type TokenType = 'ETH' | 'ETIM';

function parseSwapError(err: unknown): string {
  if (!(err instanceof Error)) return 'Transaction failed. Please try again.';
  const msg = err.message.toLowerCase();
  if (msg.includes('user rejected') || msg.includes('user denied')) return 'Transaction rejected.';
  if (msg.includes('insufficient')) return 'Insufficient balance.';
  return err.message.length > 80 ? err.message.slice(0, 80) + '…' : err.message;
}

// Format number with max decimals
function formatAmount(amount: string | null, maxDecimals: number = 6): string {
  if (!amount) return '0';
  const num = parseFloat(amount);
  if (isNaN(num)) return '0';
  if (num < 0.000001) return '<0.000001';
  return num.toLocaleString(undefined, { maximumFractionDigits: maxDecimals });
}

export default function SwapPage() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [fromToken, setFromToken] = useState<TokenType>('ETH');
  const [inputAmount, setInputAmount] = useState('');
  const [outputAmount, setOutputAmount] = useState<string | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successTxHash, setSuccessTxHash] = useState<string | null>(null);
  const [etimPerEth, setEtimPerEth] = useState<number>(0);
  const [willRevert, setWillRevert] = useState<string | null>(null);

  // Write hooks
  const { writeContractAsync: writeApprove, data: approveTxHash, isPending: isApprovePending } = useWriteContract();
  const { writeContractAsync: writeSwap, data: swapTxHash, isPending: isSwapPending } = useWriteContract();

  const { isLoading: isApproveConfirming } = useWaitForTransactionReceipt({ hash: approveTxHash });
  const {
    isLoading: isSwapConfirming,
    isSuccess: isSwapSuccess,
    isError: isSwapError,
    error: swapError,
    status: swapStatus,
  } = useWaitForTransactionReceipt({ hash: swapTxHash });

  // isBusy should be false when status is 'success' or 'error'
  const isBusy = !isSwapSuccess && !isSwapError && (isApprovePending || isApproveConfirming || isSwapPending || isSwapConfirming);

  // Balances
  const { data: etimBalanceData } = useBalance({ address, token: ETIMTokenAddress });
  const { data: ethBalanceData } = useBalance({ address });
  const etimBalance = etimBalanceData?.value ?? BigInt(0);
  const ethBalance = ethBalanceData?.value ?? BigInt(0);

  const toToken: TokenType = fromToken === 'ETH' ? 'ETIM' : 'ETH';
  const fromBalance = fromToken === 'ETH' ? ethBalance : etimBalance;
  const toBalance = toToken === 'ETH' ? ethBalance : etimBalance;

  // Fetch pool price info once on mount (not on every input change)
  useEffect(() => {
    if (!publicClient || etimPerEth > 0) return; // Skip if already fetched

    // Use Quoter to get ETIM per ETH (most accurate)
    publicClient.readContract({
      address: QUOTER,
      abi: QuoterABI,
      functionName: 'quoteExactInputSingle',
      args: [{
        poolKey: POOL_KEY,
        zeroForOne: true,
        exactAmount: parseEther('1'),
        hookData: '0x',
      }],
    }).then((result) => {
      const [etimOut] = result as [bigint, bigint];
      const etimPerEthValue = Number(formatEther(etimOut));
      setEtimPerEth(etimPerEthValue);
      console.log('[Quote 1 ETH] ETIM output:', etimPerEthValue);
    }).catch(console.error);
  }, [publicClient, etimPerEth]);

  // Quote output amount using Quoter (with debounce to reduce RPC calls)
  useEffect(() => {
    if (!inputAmount || !publicClient) {
      setOutputAmount(null);
      setWillRevert(null);
      return;
    }

    let amount: bigint;
    try {
      amount = parseEther(inputAmount);
      if (amount <= BigInt(0)) {
        setOutputAmount(null);
        setWillRevert(null);
        return;
      }
    } catch {
      setOutputAmount(null);
      setWillRevert(null);
      return;
    }

    setIsQuoting(true);
    setWillRevert(null);

    // Debounce: wait 300ms before making request
    const timeoutId = setTimeout(() => {
      const zeroForOne = fromToken === 'ETH';

      console.log('[Quote Request]', {
        fromToken,
        toToken,
        inputAmount,
        amountWei: amount.toString(),
        zeroForOne,
      });

      publicClient
        .readContract({
          address: QUOTER,
          abi: QuoterABI,
          functionName: 'quoteExactInputSingle',
          args: [
            {
              poolKey: POOL_KEY,
              zeroForOne,
              exactAmount: amount,
              hookData: '0x',
            },
          ],
        })
        .then((result) => {
          const [amountOut, gasEstimate] = result as [bigint, bigint];
          const outputFormatted = formatEther(amountOut);
          setOutputAmount(outputFormatted);
          setWillRevert(null);
          console.log('[Quote Result]', {
            amountOut: outputFormatted,
            gasEstimate: gasEstimate.toString(),
          });
        })
        .catch((err) => {
          console.error('[Quote Error]:', err);
          setOutputAmount(null);
          setWillRevert('Swap may fail - pool cannot execute this trade');
        })
        .finally(() => setIsQuoting(false));
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [inputAmount, fromToken, publicClient]);

  // Track success
  useEffect(() => {
    if (isSwapSuccess && swapTxHash) {
      setSuccessTxHash(swapTxHash);
      setInputAmount('');
      setOutputAmount(null);
      setWillRevert(null);
    }
  }, [isSwapSuccess, swapTxHash]);

  // Track transaction failure
  useEffect(() => {
    if (isSwapError) {
      const errorMsg = swapError instanceof Error ? swapError.message : 'Transaction failed';
      setError(parseSwapError(swapError));
      console.error('[Swap Failed]:', errorMsg);
    }
  }, [isSwapError, swapError]);

  // Handle swap
  const handleSwap = useCallback(async () => {
    if (!address) return;
    setError(null);
    setSuccessTxHash(null);

    let ethAmount: bigint;
    try {
      ethAmount = parseEther(inputAmount);
      if (ethAmount <= BigInt(0)) return;
    } catch {
      setError('Invalid amount');
      return;
    }

    try {
      // Approve for ETIM → ETH
      if (fromToken === 'ETIM') {
        console.log('[Approve]', {
          token: ETIMTokenAddress,
          spender: PERMIT2_ADDRESS,
          amount: ethAmount.toString(),
        });
        await writeApprove({
          address: ETIMTokenAddress,
          abi: ERC20ABI,
          functionName: 'approve',
          args: [PERMIT2_ADDRESS, ethAmount],
        });
      }

      const recipient = address as Address;
      const zeroForOne = fromToken === 'ETH';

      // V4 Actions: SWAP_EXACT_IN_SINGLE + SETTLE + TAKE
      const actions = encodePacked(
        ['uint8', 'uint8', 'uint8'],
        [V4_ACTION_SWAP_EXACT_IN_SINGLE, V4_ACTION_SETTLE, V4_ACTION_TAKE]
      );

      // SWAP_EXACT_IN_SINGLE params
      const swapParams = encodeAbiParameters(
        [
          { type: 'address' },
          { type: 'address' },
          { type: 'uint24' },
          { type: 'int24' },
          { type: 'address' },
          { type: 'bool' },
          { type: 'uint128' },
          { type: 'uint128' },
          { type: 'bytes' },
        ],
        [
          POOL_KEY.currency0,
          POOL_KEY.currency1,
          POOL_KEY.fee,
          POOL_KEY.tickSpacing,
          POOL_KEY.hooks,
          zeroForOne,
          ethAmount,
          BigInt(0),
          '0x',
        ]
      );

      // SETTLE params
      const settleParams = encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint256' }, { type: 'bool' }],
        [zeroForOne ? POOL_KEY.currency0 : POOL_KEY.currency1, FULL_DELTA_AMOUNT, true]
      );

      // TAKE params
      const takeParams = encodeAbiParameters(
        [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
        [zeroForOne ? POOL_KEY.currency1 : POOL_KEY.currency0, recipient, FULL_DELTA_AMOUNT]
      );

      // V4_SWAP input
      const input = encodeAbiParameters(
        [{ type: 'bytes' }, { type: 'bytes[]' }],
        [actions, [swapParams, settleParams, takeParams]]
      );

      console.log('[Swap Params]', {
        fromToken,
        toToken,
        inputAmountWei: ethAmount.toString(),
        zeroForOne,
        recipient,
        actions: actions,
        CMD_V4_SWAP,
      });

      await writeSwap({
        address: UNIVERSAL_ROUTER,
        abi: UniversalRouterABI,
        functionName: 'execute',
        args: [CMD_V4_SWAP, [input]],
        ...(fromToken === 'ETH' && { value: ethAmount }),
      });
    } catch (err: unknown) {
      console.error('[Swap Error]:', err);
      setError(parseSwapError(err));
    }
  }, [address, inputAmount, fromToken, writeApprove, writeSwap]);

  const handleSetMax = () => {
    setError(null);
    if (fromToken === 'ETH') {
      const max = ethBalance > ETH_GAS_BUFFER ? ethBalance - ETH_GAS_BUFFER : BigInt(0);
      setInputAmount(formatEther(max));
    } else {
      setInputAmount(formatEther(etimBalance));
    }
  };

  const handleSwitchTokens = () => {
    setFromToken(toToken);
    setInputAmount('');
    setOutputAmount(null);
    setError(null);
    setSuccessTxHash(null);
    setWillRevert(null);
  };

  // Calculate USD value for input (approximate)
  const inputUsdValue = (() => {
    const amt = parseFloat(inputAmount || '0');
    if (isNaN(amt) || amt === 0) return '$0.00';
    if (fromToken === 'ETH') {
      // ETH price * ETH amount (approximate $1800)
      return `≈ $${(amt * 1800).toFixed(2)}`;
    } else {
      // ETIM amount / (ETIM per ETH) * ETH price
      if (etimPerEth > 0) {
        const ethValue = amt / etimPerEth;
        return `≈ $${(ethValue * 1800).toFixed(2)}`;
      }
      return '';
    }
  })();

  const buttonState = (() => {
    if (!isConnected) return { label: 'Connect Wallet', disabled: false };
    if (isApprovePending || isApproveConfirming) return { label: 'Approving…', disabled: true };
    if (isSwapPending || isSwapConfirming) return { label: 'Swapping…', disabled: true };
    if (!inputAmount) return { label: 'Enter an amount', disabled: true };
    if (isQuoting) return { label: 'Quoting…', disabled: true };
    // If quote failed (willRevert is set), disable the button
    if (willRevert) return { label: 'Swap not available', disabled: true };
    try {
      const amt = parseEther(inputAmount);
      if (amt <= BigInt(0)) return { label: 'Enter an amount', disabled: true };
      if (amt > fromBalance) return { label: 'Insufficient balance', disabled: true };
    } catch {
      return { label: 'Invalid amount', disabled: true };
    }
    return { label: 'Swap', disabled: false };
  })();

  return (
    <div className="min-h-screen bg-[#131313] pt-20 pb-12 px-4">
      <div className="max-w-md mx-auto">
        <h1 className="text-2xl font-semibold text-white mb-4">Swap</h1>

        <div className="bg-[#1B1B1B] rounded-3xl p-1">
          {/* From Section */}
          <div className="bg-[#212121] rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400 text-sm">You pay</span>
              <button onClick={handleSetMax} className="text-xs text-[#627EEA] hover:underline">
                Max
              </button>
            </div>
            <div className="flex items-center justify-between gap-3">
              <input
                type="number"
                value={inputAmount}
                onChange={(e) => { setInputAmount(e.target.value); setError(null); setWillRevert(null); }}
                placeholder="0"
                className="bg-transparent text-4xl font-medium outline-none w-full text-white placeholder-gray-600 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                onClick={handleSwitchTokens}
                disabled={isBusy}
                className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-[#2C2C2C] hover:bg-[#3C3C3C] transition-all disabled:opacity-50 flex-shrink-0"
              >
                {fromToken === 'ETH' ? (
                  <>
                    <div className="w-7 h-7 rounded-full bg-[#627EEA] flex items-center justify-center">
                      <span className="text-white text-xs font-bold">Ξ</span>
                    </div>
                    <span className="text-white font-medium">ETH</span>
                  </>
                ) : (
                  <>
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
                      <span className="text-white text-xs font-bold">E</span>
                    </div>
                    <span className="text-white font-medium">ETIM</span>
                  </>
                )}
              </button>
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-gray-500 text-sm">{inputUsdValue}</span>
              <span className="text-gray-500 text-sm">
                Balance: {Number(formatEther(fromBalance)).toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </span>
            </div>
          </div>

          {/* Switch Button */}
          <div className="relative h-0 flex items-center justify-center z-10">
            <button
              onClick={handleSwitchTokens}
              disabled={isBusy}
              className="w-10 h-10 rounded-xl bg-[#212121] border-4 border-[#1B1B1B] flex items-center justify-center hover:bg-[#2C2C2C] transition-colors disabled:opacity-50"
            >
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </button>
          </div>

          {/* To Section */}
          <div className="bg-[#212121] rounded-2xl p-4 -mt-1">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400 text-sm">You receive</span>
              <span className="text-gray-500 text-sm">
                Balance: {Number(formatEther(toBalance)).toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-4xl font-medium text-white truncate">
                {isQuoting ? '…' : formatAmount(outputAmount)}
              </span>
              <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-[#2C2C2C] flex-shrink-0">
                {toToken === 'ETH' ? (
                  <>
                    <div className="w-7 h-7 rounded-full bg-[#627EEA] flex items-center justify-center">
                      <span className="text-white text-xs font-bold">Ξ</span>
                    </div>
                    <span className="text-white font-medium">ETH</span>
                  </>
                ) : (
                  <>
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
                      <span className="text-white text-xs font-bold">E</span>
                    </div>
                    <span className="text-white font-medium">ETIM</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Approve Step */}
        {fromToken === 'ETIM' && (isApprovePending || isApproveConfirming) && (
          <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
            <p className="text-yellow-400 text-sm">Step 1/2 — Approving ETIM…</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Success */}
        {isSwapSuccess && successTxHash && (
          <div className="mt-3 p-3 bg-green-500/10 border border-green-500/30 rounded-xl">
            <p className="text-green-400 text-sm">Swap successful!</p>
            <a
              href={`https://etherscan.io/tx/${successTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-300 text-xs underline hover:text-green-200"
            >
              View on Etherscan →
            </a>
          </div>
        )}

        {/* Action Button */}
        {!isConnected ? (
          <div className="mt-4">
            <ConnectButton />
          </div>
        ) : (
          <div>
            <button
              onClick={handleSwap}
              disabled={buttonState.disabled}
              className={`w-full mt-4 py-4 rounded-2xl font-semibold text-lg transition-colors ${
                buttonState.disabled
                  ? 'bg-[#2C2C2C] text-gray-500 cursor-not-allowed'
                  : 'bg-[#627EEA] hover:bg-[#5A6FD6] text-white'
              }`}
            >
              {isBusy && (
                <span className="inline-flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {buttonState.label}
                </span>
              ) || buttonState.label}
            </button>
            {/* Revert warning below button */}
            {willRevert && !buttonState.disabled && (
              <p className="mt-2 text-center text-yellow-400 text-xs">{willRevert}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
