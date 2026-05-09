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
import { CONTRACTS, UNIVERSAL_ROUTER, PERMIT2_ADDRESS, CL_QUOTER as QUOTER, CL_POOL_MANAGER } from '@/config/contracts';
import { ERC20ABI, UniversalRouterABI, QuoterABI, Permit2ABI } from '@/config/abis';

// PancakeSwap V4 on BSC uses WETH (bridged ETH), not native ETH.
// The Hook contract checks `wethAddress` to determine buy/sell direction.
// Native ETH would be interpreted incorrectly and can revert with BuyNotEnabled.

const ETIMTokenAddress = CONTRACTS.ETIMToken as Address;
const ETIMTaxHookAddress = CONTRACTS.ETIMTaxHook as Address;
// BSC bridged ETH (WETH) must match the Hook contract configuration.
const WETHAddress = CONTRACTS.WETH as Address;

// PoolKey uses the PancakeSwap V4 Infinity format.
// Differs from Uniswap V4: includes `poolManager` and uses `parameters` (bytes32) instead of `tickSpacing`
// parameters encodes: (tickSpacing << 16) | hookBitmap
// hookBitmap 0x0440 = beforeSwap + beforeSwapReturnDelta (matches Hook's getHooksRegistrationBitmap)
// tickSpacing 60 = 0x3C, so parameters = (60 << 16) | 0x0440 = 0x003C0440
const POOL_PARAMETERS = `0x${((60 << 16) | 0x0440).toString(16).padStart(64, '0')}` as `0x${string}`;

const POOL_KEY = {
  currency0:   WETHAddress,          // WETH (numerically smaller address)
  currency1:   ETIMTokenAddress,     // ETIM
  hooks:       ETIMTaxHookAddress,
  poolManager: CL_POOL_MANAGER as Address,
  fee:         3000,
  parameters:  POOL_PARAMETERS,
};

// In this pool:
//   zeroForOne = true  -> spend WETH, receive ETIM (BUY, blocked until Growth Pool depleted)
//   zeroForOne = false -> spend ETIM, receive WETH (SELL, always allowed)

// PancakeSwap V4 Infinity Action codes (from Actions.sol)
// https://github.com/pancakeswap/pancake-v4-periphery/blob/main/src/libraries/Actions.sol
const INFI_SWAP = 0x10;
const CL_SWAP_EXACT_IN_SINGLE = 0x06;
const SETTLE_ALL = 0x0c;
const TAKE_ALL = 0x0f;

const MAX_UINT160 = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF');
const MAX_UINT48 = BigInt('0xFFFFFFFFFFFF');
const MAX_UINT256 = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF');

type TokenType = 'ETH' | 'ETIM';

function parseSwapError(err: unknown): string {
  if (!(err instanceof Error)) return 'Transaction failed. Please try again.';
  const msg = err.message.toLowerCase();
  if (msg.includes('user rejected') || msg.includes('user denied')) return 'Transaction rejected.';
  if (msg.includes('insufficient')) return 'Insufficient balance.';
  // Show full error in console, truncated in UI
  console.error('[Full error]:', err.message);
  return err.message.length > 200 ? err.message.slice(0, 200) + '...' : err.message;
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
  const [fromToken, setFromToken] = useState<TokenType>('ETIM');
  const [inputAmount, setInputAmount] = useState('');
  const [outputAmount, setOutputAmount] = useState<string | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successTxHash, setSuccessTxHash] = useState<string | null>(null);
  const [etimPerEth, setEtimPerEth] = useState<number>(0);
  const [willRevert, setWillRevert] = useState<string | null>(null);
  const [timeoutHash, setTimeoutHash] = useState<string | null>(null);
  // Manually track approve state to avoid wagmi hook timing conflicts
  const [isApproving, setIsApproving] = useState(false);

  // Write hooks
  const { writeContractAsync: writeApprove } = useWriteContract();
  const { writeContractAsync: writeSwap, data: swapTxHash, isPending: isSwapPending } = useWriteContract();

  const {
    isLoading: isSwapConfirming,
    isSuccess: isSwapSuccess,
    isError: isSwapError,
    error: swapError,
  } = useWaitForTransactionReceipt({
    hash: swapTxHash,
    timeout: 120_000, // 2 minutes timeout
  });

  // Track timeout - show hash if confirming takes too long
  useEffect(() => {
    if (swapTxHash && isSwapConfirming) {
      const timeoutId = setTimeout(() => {
        if (isSwapConfirming && !isSwapSuccess && !isSwapError) {
          setTimeoutHash(swapTxHash);
        }
      }, 120_000); // 2 minutes

      return () => clearTimeout(timeoutId);
    }
  }, [swapTxHash, isSwapConfirming, isSwapSuccess, isSwapError]);

  // isBusy should be false when status is 'success', 'error', or 'timeout'
  const isBusy = !isSwapSuccess && !isSwapError && !timeoutHash && (isApproving || isSwapPending || isSwapConfirming);

  // Balances
  const { data: etimBalanceData } = useBalance({ address, token: ETIMTokenAddress });
  const { data: ethBalanceData } = useBalance({ address });
  const { data: wethBalanceData } = useBalance({ address, token: WETHAddress });
  const etimBalance = etimBalanceData?.value ?? BigInt(0);
  const ethBalance = ethBalanceData?.value ?? BigInt(0);   // native ETH, for gas display only
  const wethBalance = wethBalanceData?.value ?? BigInt(0); // WETH is what we actually swap

  const toToken: TokenType = fromToken === 'ETH' ? 'ETIM' : 'ETH';
  // For swap amounts, fromToken=ETH means spending WETH (not native ETH)
  const fromBalance = fromToken === 'ETH' ? wethBalance : etimBalance;
  const toBalance = toToken === 'ETH' ? wethBalance : etimBalance;

  // Note: We don't fetch pool price on mount because:
  // - ETH -> ETIM (zeroForOne=true) is blocked by Hook contract
  // - Quoter simulation would revert for blocked directions

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
      setTimeoutHash(null); // Clear timeout on success
    }
  }, [isSwapSuccess, swapTxHash]);

  // Track transaction failure
  useEffect(() => {
    if (isSwapError) {
      const errorMsg = swapError instanceof Error ? swapError.message : 'Transaction failed';
      setError(parseSwapError(swapError));
      setTimeoutHash(null); // Clear timeout on error
      console.error('[Swap Failed]:', errorMsg);
    }
  }, [isSwapError, swapError]);

  // Handle swap
  const handleSwap = useCallback(async () => {
    if (!address) return;
    setError(null);
    setSuccessTxHash(null);
    setTimeoutHash(null);

    let ethAmount: bigint;
    try {
      ethAmount = parseEther(inputAmount);
      if (ethAmount <= BigInt(0)) return;
    } catch {
      setError('Invalid amount');
      return;
    }

    try {
      const zeroForOne = fromToken === 'ETH';

      // Approve for both directions: approve Permit2, then Permit2 approves Universal Router
      // ETH side = WETH (bridged ETH token on BSC), must go through Permit2 just like ETIM
      const tokenToApprove = fromToken === 'ETIM' ? ETIMTokenAddress : WETHAddress;
      setIsApproving(true);
      try {
        // Step 1: Approve token to Permit2 (max approval, only needed once)
        const currentAllowance = await publicClient!.readContract({
          address: tokenToApprove,
          abi: ERC20ABI,
          functionName: 'allowance',
          args: [address, PERMIT2_ADDRESS as Address],
        }) as bigint;

        if (currentAllowance < ethAmount) {
          console.log(`[Approve ${fromToken} -> Permit2]`);
          const approveTxHash = await writeApprove({
            address: tokenToApprove,
            abi: ERC20ABI,
            functionName: 'approve',
            args: [PERMIT2_ADDRESS as Address, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
          });
          await publicClient!.waitForTransactionReceipt({ hash: approveTxHash });
          console.log(`[Approve ${fromToken} ->Permit2 confirmed]`);
        }

        // Step 2: Permit2 approve Universal Router
        console.log('[Permit2 approve -> Universal Router]');
        const permit2ApproveTxHash = await writeApprove({
          address: PERMIT2_ADDRESS as Address,
          abi: Permit2ABI,
          functionName: 'approve',
          args: [tokenToApprove, UNIVERSAL_ROUTER as Address, MAX_UINT160, Number(MAX_UINT48)],
        });
        await publicClient!.waitForTransactionReceipt({ hash: permit2ApproveTxHash });
        console.log('[Permit2 approve confirmed]');
      } finally {
        setIsApproving(false);
      }

      // PancakeSwap V4 Actions: CL_SWAP_EXACT_IN_SINGLE + SETTLE_ALL + TAKE_ALL
      // Data format: abi.encode(bytes actions, bytes[] params)
      // Each action is a uint8, params[i] is the encoded parameters for actions[i]

      // 1. Encode swap params
      const swapParams = encodeAbiParameters(
        [{
          type: 'tuple',
          components: [
            {
              name: 'poolKey',
              type: 'tuple',
              components: [
                { name: 'currency0', type: 'address' },
                { name: 'currency1', type: 'address' },
                { name: 'hooks', type: 'address' },
                { name: 'poolManager', type: 'address' },
                { name: 'fee', type: 'uint24' },
                { name: 'parameters', type: 'bytes32' },
              ],
            },
            { name: 'zeroForOne', type: 'bool' },
            { name: 'amountIn', type: 'uint128' },
            { name: 'amountOutMinimum', type: 'uint128' },
            { name: 'hookData', type: 'bytes' },
          ],
        }],
        [{
          poolKey: POOL_KEY,
          zeroForOne,
          amountIn: ethAmount,
          amountOutMinimum: BigInt(0),
          hookData: '0x',
        }]
      );

      // 2. Encode SETTLE_ALL params: (Currency currency, uint256 maxAmount)
      const settleCurrency = zeroForOne ? POOL_KEY.currency0 : POOL_KEY.currency1;
      const settleParams = encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint256' }],
        [settleCurrency, MAX_UINT256]
      );

      // 3. Encode TAKE_ALL params: (Currency currency, uint256 minAmount)
      const takeCurrency = zeroForOne ? POOL_KEY.currency1 : POOL_KEY.currency0;
      const takeParams = encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint256' }],
        [takeCurrency, BigInt(0)]
      );

      // 4. Encode actions as bytes (each action is uint8)
      const actions = encodePacked(
        ['uint8', 'uint8', 'uint8'],
        [CL_SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL]
      );

      // 5. Infinity command input: abi.encode(bytes actions, bytes[] params)
      const actionData = encodeAbiParameters(
        [{ type: 'bytes' }, { type: 'bytes[]' }],
        [actions, [swapParams, settleParams, takeParams]]
      );

      // 6. Universal Router command envelope: INFI_SWAP + actionData
      const commands = encodePacked(['uint8'], [INFI_SWAP]);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

      console.log('[Swap Params]', {
        fromToken,
        toToken,
        inputAmountWei: ethAmount.toString(),
        zeroForOne,
      });
      console.log('[Actions]', actions);
      console.log('[Action data length]', actionData.length);

      // PancakeSwap V4 Universal Router uses execute(commands, inputs, deadline).
      // Let the wallet simulate and show the concrete revert reason.
      await writeSwap({
        address: UNIVERSAL_ROUTER,
        abi: UniversalRouterABI,
        functionName: 'execute',
        args: [commands, [actionData], deadline],
      });
    } catch (err: unknown) {
      console.error('[Swap Error]:', err);
      setError(parseSwapError(err));
    }
  }, [address, inputAmount, fromToken, writeApprove, writeSwap]);

  const handleSetMax = () => {
    setError(null);
    if (fromToken === 'ETH') {
      // Use WETH balance (not native ETH - no gas buffer needed for token)
      setInputAmount(formatEther(wethBalance));
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
      return `~$${(amt * 1800).toFixed(2)}`;
    } else {
      // ETIM amount / (ETIM per ETH) * ETH price
      if (etimPerEth > 0) {
        const ethValue = amt / etimPerEth;
        return `~$${(ethValue * 1800).toFixed(2)}`;
      }
      return '';
    }
  })();

  const buttonState = (() => {
    if (!isConnected) return { label: 'Connect Wallet', disabled: false };
    if (isApproving) return { label: 'Approving...', disabled: true };
    if (isSwapPending || isSwapConfirming) return { label: 'Swapping...', disabled: true };
    if (!inputAmount) return { label: 'Enter an amount', disabled: true };
    if (isQuoting) return { label: 'Quoting...', disabled: true };
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
                type="text"
                inputMode="decimal"
                value={inputAmount}
                onChange={(e) => { const v = e.target.value; if (/^[0-9]*\.?[0-9]*$/.test(v)) { setInputAmount(v); setError(null); setWillRevert(null); } }}
                placeholder="0"
                className="bg-transparent text-4xl font-medium outline-none w-full text-white placeholder-gray-600"
              />
              <button
                onClick={handleSwitchTokens}
                disabled={isBusy}
                className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-[#2C2C2C] hover:bg-[#3C3C3C] transition-all disabled:opacity-50 flex-shrink-0"
              >
                {fromToken === 'ETH' ? (
                  <>
                    <div className="w-7 h-7 rounded-full bg-[#627EEA] flex items-center justify-center">
                      <span className="text-white text-xs font-bold">E</span>
                    </div>
                    <span className="text-white font-medium">ETH</span>
                  </>
                ) : (
                  <>
                    <div className="w-7 h-7 rounded-full overflow-hidden border border-amber-400/40">
                      <img src="/icon.png" alt="ETIM" className="w-full h-full object-cover" />
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
                {isQuoting ? '...' : formatAmount(outputAmount)}
              </span>
              <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-[#2C2C2C] flex-shrink-0">
                {toToken === 'ETH' ? (
                  <>
                    <div className="w-7 h-7 rounded-full bg-[#627EEA] flex items-center justify-center">
                      <span className="text-white text-xs font-bold">E</span>
                    </div>
                    <span className="text-white font-medium">ETH</span>
                  </>
                ) : (
                  <>
                    <div className="w-7 h-7 rounded-full overflow-hidden border border-amber-400/40">
                      <img src="/icon.png" alt="ETIM" className="w-full h-full object-cover" />
                    </div>
                    <span className="text-white font-medium">ETIM</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Approve Step */}
        {isApproving && (
          <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
            <p className="text-yellow-400 text-sm">Step 1/2 - Approving {fromToken === 'ETIM' ? 'ETIM' : 'WETH'} for swap...</p>
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
              href={`https://bscscan.com/tx/${successTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-300 text-xs underline hover:text-green-200"
            >
              View on BscScan</a>
          </div>
        )}

        {/* Timeout - Transaction pending for too long */}
        {timeoutHash && !isSwapSuccess && !isSwapError && (
          <div className="mt-3 p-3 bg-blue-500/10 border border-blue-500/30 rounded-xl">
            <p className="text-blue-400 text-sm">Transaction submitted. Waiting for confirmation...</p>
            <p className="text-gray-400 text-xs mt-1">Check status on BscScan:</p>
            <a
              href={`https://bscscan.com/tx/${timeoutHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-300 text-xs underline hover:text-blue-200 font-mono break-all"
            >
              {timeoutHash}
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
