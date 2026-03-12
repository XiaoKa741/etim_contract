// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

// import "hardhat/console.sol"; // only for local debugging

interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}

contract ETIMPoolHelper is IUnlockCallback {
    using SafeERC20 for IERC20;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;

    // =========================================================
    //                       CONSTANTS
    // =========================================================

    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // =========================================================
    //                       IMMUTABLES
    // =========================================================

    IPoolManager          public immutable poolManager;
    IERC20                public immutable etim;
    IERC20                public immutable usdc;
    AggregatorV3Interface public immutable ethUsdFeed;

    // =========================================================
    //                        STORAGE
    // =========================================================

    address public mainContract;
    address public owner;
    address public pendingOwner;

    PoolKey public etimEthPoolKey;
    PoolKey public usdcEthPoolKey;

    PoolId public etimEthPoolId;
    PoolId public usdcEthPoolId;

    // =========================================================
    //                     CALLBACK TYPES
    // =========================================================

    enum ActionType {
        ADD_LIQUIDITY,
        SWAP,
        SWAP_AND_ADD_LIQUIDITY,
        SWAP_AND_BURN
    }

    struct CallbackData {
        ActionType actionType;
        address    sender;
        address    to;
        uint256    ethAmount;
        uint256    etimAmount;
        int24      tickLower;
        int24      tickUpper;
    }

    // =========================================================
    //                        ERRORS
    // =========================================================

    error OnlyMainContract();
    error OnlyOwner();
    error OnlyPendingOwner();
    error OnlyPoolManager();
    error ZeroAddress();
    error InsufficientETH();
    error ETHTransferFailed();
    error PoolNotInitialized();

    // =========================================================
    //                        EVENTS
    // =========================================================

    event LiquidityAdded(uint256 etimAmount, uint256 ethAmount);
    event SwappedEthToEtim(uint256 ethIn, uint256 etimOut);
    event SwappedEtimToEth(uint256 etimIn, uint256 ethOut);
    event SwappedAndBurned(uint256 ethIn, uint256 etimBurned);
    event MainContractUpdated(address indexed previous, address indexed next);
    event OwnershipTransferStarted(address indexed currentOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // =========================================================
    //                       MODIFIERS
    // =========================================================

    modifier onlyMainContract() {
        if (msg.sender != mainContract) revert OnlyMainContract();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    // =========================================================
    //                      CONSTRUCTOR
    // =========================================================

    constructor(
        address _poolManager,
        address _etim,
        address _usdc,
        address _hook,
        address _ethUsdFeed
    ) {
        if (_poolManager == address(0)) revert ZeroAddress();
        if (_etim        == address(0)) revert ZeroAddress();
        if (_usdc        == address(0)) revert ZeroAddress();
        if (_ethUsdFeed  == address(0)) revert ZeroAddress();

        poolManager = IPoolManager(_poolManager);
        etim        = IERC20(_etim);
        usdc        = IERC20(_usdc);
        ethUsdFeed  = AggregatorV3Interface(_ethUsdFeed);
        owner       = msg.sender;

        // ETIM / Native ETH pool (fee 3000, tickSpacing 60)
        {
            Currency c0 = Currency.wrap(address(0)); // native ETH
            Currency c1 = Currency.wrap(_etim);
            if (c0 > c1) (c0, c1) = (c1, c0);
            etimEthPoolKey = PoolKey({
                currency0:   c0,
                currency1:   c1,
                fee:         3000,
                tickSpacing: 60,
                hooks:       IHooks(_hook)  // set Tax hook
            });
            etimEthPoolId = etimEthPoolKey.toId();
        }

        // USDC / Native ETH pool (fee 500, tickSpacing 10)
        {
            Currency c0 = Currency.wrap(address(0));
            Currency c1 = Currency.wrap(_usdc);
            if (c0 > c1) (c0, c1) = (c1, c0);
            usdcEthPoolKey = PoolKey({
                currency0:   c0,
                currency1:   c1,
                fee:         500,
                tickSpacing: 10,
                hooks:       IHooks(address(0))
            });
            usdcEthPoolId = usdcEthPoolKey.toId();
        }
    }

    // =========================================================
    //                    VIEW FUNCTIONS
    // =========================================================

    /// @notice Returns the virtual ETH reserve of the ETIM/ETH pool (estimated based on current price and liquidity)
    function getEthReserves() external view returns (uint256 ethReserves) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(etimEthPoolId);
        uint128 liquidity = poolManager.getLiquidity(etimEthPoolId);
        if (liquidity == 0 || sqrtPriceX96 == 0) return 0;

        // When ETH is currency0: amount0 = liquidity * 2^96 / sqrtPriceX96
        ethReserves = FullMath.mulDiv(liquidity, 2 ** 96, sqrtPriceX96);
    }

    /// @notice Returns the amount of ETIM obtainable for 1 ETH (based on current pool price)
    function getEtimPerEth() external view returns (uint256 etimAmount) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(etimEthPoolId);
        if (sqrtPriceX96 == 0) return 0;

        // price = (sqrtPriceX96 / 2^96)^2 = token1/token0 = ETIM/ETH
        uint256 priceX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        etimAmount = FullMath.mulDiv(priceX192, 1e18, 2 ** 192);
    }

    /// @notice Returns the USDC price per 1 ETH — Chainlink primary, Uniswap V4 fallback
    function getUsdcPerEth() external view returns (uint256 usdcAmount) {
        usdcAmount = getUsdcPerEthChainlink();
        if (usdcAmount == 0) usdcAmount = getUsdcPerEthUniswapV4();
    }

    /// @notice Returns the USDC price per 1 ETH via Chainlink ETH/USD feed
    function getUsdcPerEthChainlink() public view returns (uint256 usdcAmount) {
        (, int256 answer,, uint256 updatedAt,) = ethUsdFeed.latestRoundData();
        if (answer <= 0) return 0;
        if (block.timestamp - updatedAt > 2 hours) return 0; // stale price guard
        // Chainlink ETH/USD is 8 decimals → scale down to 6 decimals (USDC)
        usdcAmount = uint256(answer) / 10 ** 2;
    }

    /// @notice Returns the USDC price per 1 ETH via Uniswap V4 pool spot price
    function getUsdcPerEthUniswapV4() public view returns (uint256 usdcAmount) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(usdcEthPoolId);
        if (sqrtPriceX96 == 0) return 0;

        uint256 priceX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        usdcAmount = FullMath.mulDiv(priceX192, 10 ** 18, 2 ** 192);
    }

    // =========================================================
    //               EXTERNAL MUTATING FUNCTIONS
    // =========================================================

    /// @notice Directly add liquidity (both ETH and ETIM), used for initial seeding or manual liquidity addition
    /// @param  ethAmount   Amount of ETH to deposit (must equal msg.value)
    /// @param  etimAmount  Amount of ETIM to deposit (must be pre-approved to this contract)
    function addLiquidity(uint256 ethAmount, uint256 etimAmount)
        external
        payable
        onlyOwner
    {
        if (msg.value < ethAmount) revert InsufficientETH();

        // Transfer ETIM from caller to this contract; it will be settled in callback
        etim.safeTransferFrom(msg.sender, address(this), etimAmount);

        (int24 tickLower, int24 tickUpper) = _getTickRange();

        poolManager.unlock(abi.encode(CallbackData({
            actionType: ActionType.ADD_LIQUIDITY,
            sender:     msg.sender,
            to:         address(0),
            ethAmount:  ethAmount,
            etimAmount: etimAmount,
            tickLower:  tickLower,
            tickUpper:  tickUpper
        })));
    }

    /// @notice Swap ETH for ETIM; ETIM is sent directly to the caller
    /// @param  ethAmount  Amount of ETH to spend (must equal msg.value)
    /// @return etimOut    Actual amount of ETIM received
    function swapEthToEtim(uint256 ethAmount)
        external
        payable
        onlyMainContract
        returns (uint256 etimOut)
    {
        if (msg.value < ethAmount) revert InsufficientETH();

        (int24 tickLower, int24 tickUpper) = _getTickRange();
        // console.log("[swapEthToEtim] tickLower:", uint256(uint24(tickLower))); // DEBUG
        // console.log("[swapEthToEtim] tickUpper:", uint256(uint24(tickUpper))); // DEBUG

        bytes memory result = poolManager.unlock(abi.encode(CallbackData({
            actionType: ActionType.SWAP,
            sender:     msg.sender,
            to:         msg.sender,
            ethAmount:  ethAmount,
            etimAmount: 0,
            tickLower:  tickLower,
            tickUpper:  tickUpper
        })));

        etimOut = abi.decode(result, (uint256));
        emit SwappedEthToEtim(ethAmount, etimOut);
    }

    /// @notice Swap ETIM for ETH; ETH is sent to the specified address
    /// @param  etimAmount  Amount of ETIM to spend (must be pre-approved to this contract)
    /// @param  to          Recipient address for ETH
    /// @return ethOut      Actual amount of ETH received
    function swapEtimToEth(uint256 etimAmount, address to)
        external
        onlyMainContract
        returns (uint256 ethOut)
    {
        if (to == address(0)) revert ZeroAddress();

        // Pull ETIM into this contract; it will be settled during the operation
        etim.safeTransferFrom(msg.sender, address(this), etimAmount);

        (int24 tickLower, int24 tickUpper) = _getTickRange();

        bytes memory result = poolManager.unlock(abi.encode(CallbackData({
            actionType: ActionType.SWAP,
            sender:     msg.sender,
            to:         to,
            ethAmount:  0,
            etimAmount: etimAmount,
            tickLower:  tickLower,
            tickUpper:  tickUpper
        })));

        ethOut = abi.decode(result, (uint256));
        emit SwappedEtimToEth(etimAmount, ethOut);
    }

    /// @notice Use ETH to swap for ETIM, then add both as liquidity
    /// @param  ethAmount  Total ETH amount: half used for swap, half for liquidity
    function swapAndAddLiquidity(uint256 ethAmount)
        external
        payable
        onlyMainContract
    {
        if (msg.value < ethAmount) revert InsufficientETH();

        (int24 tickLower, int24 tickUpper) = _getTickRange();
        // console.log("[swapAndAddLiquidity] tickLower:", uint256(int256(tickLower))); // DEBUG
        // console.log("[swapAndAddLiquidity] tickUpper:", uint256(int256(tickUpper))); // DEBUG

        poolManager.unlock(abi.encode(CallbackData({
            actionType: ActionType.SWAP_AND_ADD_LIQUIDITY,
            sender:     msg.sender,
            to:         address(0),
            ethAmount:  ethAmount,
            etimAmount: 0,
            tickLower:  tickLower,
            tickUpper:  tickUpper
        })));
    }

    /// @notice Swap ETH for ETIM and immediately burn the ETIM (send to dead address)
    /// @param  ethAmount  Amount of ETH to spend
    function swapAndBurn(uint256 ethAmount)
        external
        payable
        onlyMainContract
    {
        if (msg.value < ethAmount) revert InsufficientETH();

        // Burn does not require a tick range; pass 0 as placeholder
        poolManager.unlock(abi.encode(CallbackData({
            actionType: ActionType.SWAP_AND_BURN,
            sender:     msg.sender,
            to:         BURN_ADDRESS,
            ethAmount:  ethAmount,
            etimAmount: 0,
            tickLower:  0,
            tickUpper:  0
        })));
    }

    // =========================================================
    //                  UNISWAP V4 CALLBACK
    // =========================================================

    function unlockCallback(bytes calldata rawData)
        external
        override
        returns (bytes memory)
    {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();

        CallbackData memory data = abi.decode(rawData, (CallbackData));

        if (data.actionType == ActionType.ADD_LIQUIDITY) {
            return _handleAddLiquidity(data);
        } else if (data.actionType == ActionType.SWAP) {
            return _handleSwap(data);
        } else if (data.actionType == ActionType.SWAP_AND_ADD_LIQUIDITY) {
            return _handleSwapAndAddLiquidity(data);
        } else {
            // SWAP_AND_BURN
            return _handleSwapAndBurn(data);
        }
    }

    // =========================================================
    //                   INTERNAL HANDLERS
    // =========================================================

    function _handleAddLiquidity(CallbackData memory data) internal returns (bytes memory) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(etimEthPoolId);

        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(data.tickLower),
            TickMath.getSqrtPriceAtTick(data.tickUpper),
            data.ethAmount,
            data.etimAmount
        );

        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            etimEthPoolKey,
            ModifyLiquidityParams({
                tickLower:      data.tickLower,
                tickUpper:      data.tickUpper,
                liquidityDelta: int256(uint256(liquidity)),
                salt:           bytes32(0)
            }),
            ""
        );

        // console.log("[_handleAddLiquidity]:"); // DEBUG
        // console.logInt(int256(delta.amount0())); // DEBUG
        // console.logInt(int256(delta.amount1())); // DEBUG

        _settleDelta(delta);

        emit LiquidityAdded(data.etimAmount, data.ethAmount);
        return "";
    }

    function _handleSwap(CallbackData memory data) internal returns (bytes memory) {
        if (data.ethAmount > 0) {
            // ETH → ETIM (zeroForOne: currency0=ETH → currency1=ETIM)
            BalanceDelta delta = poolManager.swap(
                etimEthPoolKey,
                SwapParams({
                    zeroForOne:        true,
                    amountSpecified:   -int256(data.ethAmount),
                    sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
                }),
                ""
            );

            // Pay ETH
            if (delta.amount0() < 0) {
                _settleEth(uint256(-int256(delta.amount0())));
            }

            // Receive ETIM and send to `to`
            uint256 etimOut = 0;
            if (delta.amount1() > 0) {
                etimOut = uint256(int256(delta.amount1()));
                poolManager.take(etimEthPoolKey.currency1, data.to, etimOut);
            }

            return abi.encode(etimOut);

        } else {
            // ETIM → ETH (zeroForOne: currency1=ETIM → currency0=ETH)
            BalanceDelta delta = poolManager.swap(
                etimEthPoolKey,
                SwapParams({
                    zeroForOne:        false,
                    amountSpecified:   -int256(data.etimAmount),
                    sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
                }),
                ""
            );

            // Receive ETH and send to `to`
            uint256 ethOut = 0;
            if (delta.amount0() > 0) {
                ethOut = uint256(int256(delta.amount0()));
                poolManager.take(etimEthPoolKey.currency0, data.to, ethOut);
            }

            // Pay ETIM
            if (delta.amount1() < 0) {
                _settleEtim(uint256(-int256(delta.amount1())));
            }

            return abi.encode(ethOut);
        }
    }

    function _handleSwapAndAddLiquidity(CallbackData memory data) internal returns (bytes memory) {
        uint256 swapEth      = data.ethAmount / 2;
        uint256 liquidityEth = data.ethAmount - swapEth;

        // 1. ETH → ETIM
        BalanceDelta swapDelta = poolManager.swap(
            etimEthPoolKey,
            SwapParams({
                zeroForOne:        true,
                amountSpecified:   -int256(swapEth),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );

        // console.logInt(int256(swapDelta.amount0())); // DEBUG
        // console.logInt(int256(swapDelta.amount1())); // DEBUG

        if (swapDelta.amount0() < 0) {
            _settleEth(uint256(-int256(swapDelta.amount0())));
        }

        uint256 etimReceived = 0;
        if (swapDelta.amount1() > 0) {
            etimReceived = uint256(int256(swapDelta.amount1()));
            poolManager.take(etimEthPoolKey.currency1, address(this), etimReceived);
        }

        // 2. Add liquidity
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(etimEthPoolId);

        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(data.tickLower),
            TickMath.getSqrtPriceAtTick(data.tickUpper),
            liquidityEth,
            etimReceived
        );

        // console.log("[_handleSwapAndAddLiquidity] liquidity:", uint256(liquidity)); // DEBUG
        // console.log("[_handleSwapAndAddLiquidity] data.tickLower:", uint256(int256(data.tickLower))); // DEBUG
        // console.log("[_handleSwapAndAddLiquidity] data.tickUpper:", uint256(int256(data.tickUpper))); // DEBUG

        (BalanceDelta liqDelta,) = poolManager.modifyLiquidity(
            etimEthPoolKey,
            ModifyLiquidityParams({
                tickLower:      data.tickLower,
                tickUpper:      data.tickUpper,
                liquidityDelta: int256(uint256(liquidity)),
                salt:           bytes32(0)
            }),
            ""
        );

        _settleDelta(liqDelta);

        emit LiquidityAdded(etimReceived, liquidityEth);
        return "";
    }

    function _handleSwapAndBurn(CallbackData memory data) internal returns (bytes memory) {
        // ETH → ETIM, send ETIM directly to burn address
        BalanceDelta delta = poolManager.swap(
            etimEthPoolKey,
            SwapParams({
                zeroForOne:        true,
                amountSpecified:   -int256(data.ethAmount),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );

        if (delta.amount0() < 0) {
            _settleEth(uint256(-int256(delta.amount0())));
        }

        uint256 etimBurned = 0;
        if (delta.amount1() > 0) {
            etimBurned = uint256(int256(delta.amount1()));
            poolManager.take(etimEthPoolKey.currency1, BURN_ADDRESS, etimBurned);
        }

        emit SwappedAndBurned(data.ethAmount, etimBurned);
        return "";
    }

    // =========================================================
    //                   SETTLEMENT HELPERS
    // =========================================================

    /// @dev Unified handler to settle all four directions of delta after modifyLiquidity
    function _settleDelta(BalanceDelta delta) internal {
        if (delta.amount0() < 0) _settleEth(uint256(-int256(delta.amount0())));
        if (delta.amount1() < 0) _settleEtim(uint256(-int256(delta.amount1())));
        if (delta.amount0() > 0) poolManager.take(etimEthPoolKey.currency0, address(this), uint256(int256(delta.amount0())));
        if (delta.amount1() > 0) poolManager.take(etimEthPoolKey.currency1, address(this), uint256(int256(delta.amount1())));
    }

    /// @dev Settle native ETH to PoolManager
    function _settleEth(uint256 amount) internal {
        poolManager.settle{value: amount}();
    }

    /// @dev Settle ETIM to PoolManager (sync → safeTransfer → settle)
    function _settleEtim(uint256 amount) internal {
        poolManager.sync(etimEthPoolKey.currency1);
        etim.safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }

    // =========================================================
    //                      TICK HELPERS
    // =========================================================

    /// @dev Computes a tick range ±10% around the current price, aligned to tickSpacing
    function _getTickRange() internal view returns (int24 tickLower, int24 tickUpper) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(etimEthPoolId);
        if (sqrtPriceX96 == 0) revert PoolNotInitialized();

        int24 spacing     = etimEthPoolKey.tickSpacing; // 60
        // int24 range       = 4055; // ±50% in ticks (same as original)
        // int24 currentTick = TickMath.getTickAtSqrtRatio(sqrtPriceX96);
        // tickLower = ((currentTick - range) / spacing) * spacing;
        // tickUpper = ((currentTick + range) / spacing) * spacing;

        tickLower = (TickMath.MIN_TICK / spacing) * spacing;
        tickUpper = (TickMath.MAX_TICK / spacing) * spacing;
    }

    // =========================================================
    //                     ADMIN FUNCTIONS
    // =========================================================

    /// @notice Withdraw ERC20 tokens from this contract (only callable by mainContract)
    function withdrawToken(IERC20 token, uint256 amount, address to) external onlyMainContract {
        if (to == address(0)) revert ZeroAddress();
        token.safeTransfer(to, amount);
    }

    /// @notice Withdraw ETH from this contract (only callable by mainContract)
    function withdrawEth(uint256 amount, address to) external onlyMainContract {
        if (to == address(0)) revert ZeroAddress();
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert ETHTransferFailed();
    }

    /// @notice Set the main business contract address (only owner)
    function setMainContract(address _mainContract) external onlyOwner {
        if (_mainContract == address(0)) revert ZeroAddress();
        emit MainContractUpdated(mainContract, _mainContract);
        mainContract = _mainContract;
    }

    /// @notice Initialize pool price and max-approve ETIM to PoolManager (only owner, call once)
    function initializePool(uint160 sqrtPriceX96) external onlyOwner {
        poolManager.initialize(etimEthPoolKey, sqrtPriceX96);
        etim.approve(address(poolManager), type(uint256).max);
    }

    // ---- Two-step ownership transfer ----

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert OnlyPendingOwner();
        emit OwnershipTransferred(owner, pendingOwner);
        owner        = pendingOwner;
        pendingOwner = address(0);
    }

    // =========================================================

    receive() external payable {}
}