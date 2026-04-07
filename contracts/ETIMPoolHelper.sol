// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ICLPoolManager} from "@pancakeswap/infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {IVault} from "@pancakeswap/infinity-core/src/interfaces/IVault.sol";
import {ILockCallback} from "@pancakeswap/infinity-core/src/interfaces/ILockCallback.sol";
import {CLPoolManagerLibrary} from "@pancakeswap/infinity-core/src/pool-cl/libraries/CLPoolManagerLibrary.sol";
import {Currency, CurrencyLibrary} from "@pancakeswap/infinity-core/src/types/Currency.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PoolKey} from "@pancakeswap/infinity-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@pancakeswap/infinity-core/src/types/PoolId.sol";
import {TickMath} from "@pancakeswap/infinity-core/src/pool-cl/libraries/TickMath.sol";
import {FullMath} from "@pancakeswap/infinity-core/src/pool-cl/libraries/FullMath.sol";
import {CLPoolParametersHelper} from "@pancakeswap/infinity-core/src/pool-cl/libraries/CLPoolParametersHelper.sol";
import {LiquidityAmounts} from "@pancakeswap/infinity-periphery/src/pool-cl/libraries/LiquidityAmounts.sol";
import {BalanceDelta} from "@pancakeswap/infinity-core/src/types/BalanceDelta.sol";

interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}

/// @notice ETIM Pool Helper — manages WETH/ETIM pool on PancakeSwap V4 (BSC)
/// Uses ERC-20 WETH (bridged ETH on BSC: 0x2170Ed0880ac9A755fd29B2688956BD959F933F8)
contract ETIMPoolHelper is ILockCallback {
    using SafeERC20 for IERC20;
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;
    using CLPoolParametersHelper for bytes32;

    // =========================================================
    //                       CONSTANTS
    // =========================================================

    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // =========================================================
    //                       IMMUTABLES
    // =========================================================

    IVault                public immutable vault;
    ICLPoolManager        public immutable poolManager;
    IERC20                public immutable weth;       // BSC bridged ETH (ERC-20)
    IERC20                public immutable etim;
    IERC20                public immutable usdc;
    AggregatorV3Interface public immutable ethUsdFeed;  // Chainlink ETH/USD on BSC

    // =========================================================
    //                        STORAGE
    // =========================================================

    address public mainContract;
    address public owner;
    address public pendingOwner;

    PoolKey public etimEthPoolKey;   // WETH / ETIM pool
    PoolKey public usdcEthPoolKey;   // USDC / WETH pool (for price fallback)

    PoolId public etimEthPoolId;
    PoolId public usdcEthPoolId;

    // =========================================================
    //                     CALLBACK TYPES
    // =========================================================

    enum ActionType {
        ADD_LIQUIDITY,
        SWAP,
        SWAP_AND_ADD_LIQUIDITY,
        SWAP_AND_BURN,
        COLLECT_FEES
    }

    struct CallbackData {
        ActionType actionType;
        address    sender;
        address    to;
        uint256    ethAmount;    // WETH amount (ERC-20)
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
    error OnlyVault();
    error ZeroAddress();
    error InsufficientETH();
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
    event FeesCollected(uint256 ethAmount, uint256 etimAmount);

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
        address _vault,
        address _poolManager,
        address _weth,
        address _etim,
        address _usdc,
        address _hook,
        address _ethUsdFeed
    ) {
        if (_vault       == address(0)) revert ZeroAddress();
        if (_poolManager == address(0)) revert ZeroAddress();
        if (_weth        == address(0)) revert ZeroAddress();
        if (_etim        == address(0)) revert ZeroAddress();
        if (_usdc        == address(0)) revert ZeroAddress();
        if (_ethUsdFeed  == address(0)) revert ZeroAddress();

        vault       = IVault(_vault);
        poolManager = ICLPoolManager(_poolManager);
        weth        = IERC20(_weth);
        etim        = IERC20(_etim);
        usdc        = IERC20(_usdc);
        ethUsdFeed  = AggregatorV3Interface(_ethUsdFeed);
        owner       = msg.sender;

        int24 tickSpacing60 = 60;
        int24 tickSpacing10 = 10;

        // WETH / ETIM pool (fee 3000, tickSpacing 60)
        {
            Currency c0 = Currency.wrap(_weth);
            Currency c1 = Currency.wrap(_etim);
            if (c0 > c1) (c0, c1) = (c1, c0);
            etimEthPoolKey = PoolKey({
                currency0:   c0,
                currency1:   c1,
                hooks:       IHooks(_hook),
                poolManager: poolManager,
                fee:         3000,
                parameters:  bytes32(0).setTickSpacing(tickSpacing60)
            });
            etimEthPoolId = etimEthPoolKey.toId();
        }

        // USDC / WETH pool (fee 500, tickSpacing 10) — for price fallback
        {
            Currency c0 = Currency.wrap(_weth);
            Currency c1 = Currency.wrap(_usdc);
            if (c0 > c1) (c0, c1) = (c1, c0);
            usdcEthPoolKey = PoolKey({
                currency0:   c0,
                currency1:   c1,
                hooks:       IHooks(address(0)),
                poolManager: poolManager,
                fee:         500,
                parameters:  bytes32(0).setTickSpacing(tickSpacing10)
            });
            usdcEthPoolId = usdcEthPoolKey.toId();
        }
    }

    // =========================================================
    //                    VIEW FUNCTIONS
    // =========================================================

    /// @notice Returns the virtual WETH reserve of the ETIM/WETH pool
    function getEthReserves() external view returns (uint256 ethReserves) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(etimEthPoolId);
        uint128 liquidity = poolManager.getLiquidity(etimEthPoolId);
        if (liquidity == 0 || sqrtPriceX96 == 0) return 0;
        ethReserves = FullMath.mulDiv(liquidity, 2 ** 96, sqrtPriceX96);
    }

    /// @notice Returns the amount of ETIM obtainable for 1 WETH
    function getEtimPerEth() external view returns (uint256 etimAmount) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(etimEthPoolId);
        if (sqrtPriceX96 == 0) return 0;
        uint256 priceX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        etimAmount = FullMath.mulDiv(priceX192, 1e18, 2 ** 192);
    }

    /// @notice Returns the USDC price per 1 WETH — Chainlink primary, pool fallback
    function getUsdcPerEth() external view returns (uint256 usdcAmount) {
        usdcAmount = getUsdcPerEthChainlink();
        if (usdcAmount == 0) usdcAmount = getUsdcPerEthPool();
    }

    /// @notice Returns the USDC price per 1 ETH via Chainlink ETH/USD feed
    function getUsdcPerEthChainlink() public view returns (uint256 usdcAmount) {
        (, int256 answer,, uint256 updatedAt,) = ethUsdFeed.latestRoundData();
        if (answer <= 0) return 0;
        if (block.timestamp - updatedAt > 2 hours) return 0;
        // Chainlink ETH/USD is 8 decimals → scale to 6 decimals (USDC)
        usdcAmount = uint256(answer) / 10 ** 2;
    }

    /// @notice Returns the USDC price per 1 WETH via pool spot price
    function getUsdcPerEthPool() public view returns (uint256 usdcAmount) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(usdcEthPoolId);
        if (sqrtPriceX96 == 0) return 0;
        uint256 priceX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        usdcAmount = FullMath.mulDiv(priceX192, 10 ** 18, 2 ** 192);
    }

    // =========================================================
    //               EXTERNAL MUTATING FUNCTIONS
    // =========================================================

    /// @notice Directly add liquidity (both WETH and ETIM)
    function addLiquidity(uint256 ethAmount, uint256 etimAmount) external onlyOwner {
        weth.safeTransferFrom(msg.sender, address(this), ethAmount);
        etim.safeTransferFrom(msg.sender, address(this), etimAmount);
        (int24 tickLower, int24 tickUpper) = _getTickRange();

        vault.lock(abi.encode(CallbackData({
            actionType: ActionType.ADD_LIQUIDITY,
            sender:     msg.sender,
            to:         address(0),
            ethAmount:  ethAmount,
            etimAmount: etimAmount,
            tickLower:  tickLower,
            tickUpper:  tickUpper
        })));
    }

    /// @notice Swap WETH for ETIM; ETIM is sent directly to the caller
    function swapEthToEtim(uint256 ethAmount)
        external
        onlyMainContract
        returns (uint256 etimOut)
    {
        weth.safeTransferFrom(msg.sender, address(this), ethAmount);
        (int24 tickLower, int24 tickUpper) = _getTickRange();

        bytes memory result = vault.lock(abi.encode(CallbackData({
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

    /// @notice Swap ETIM for WETH; WETH is sent to the specified address
    function swapEtimToEth(uint256 etimAmount, address to)
        external
        onlyMainContract
        returns (uint256 ethOut)
    {
        if (to == address(0)) revert ZeroAddress();
        etim.safeTransferFrom(msg.sender, address(this), etimAmount);
        (int24 tickLower, int24 tickUpper) = _getTickRange();

        bytes memory result = vault.lock(abi.encode(CallbackData({
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

    /// @notice Use WETH to swap for ETIM, then add both as liquidity
    function swapAndAddLiquidity(uint256 ethAmount) external onlyMainContract {
        weth.safeTransferFrom(msg.sender, address(this), ethAmount);
        (int24 tickLower, int24 tickUpper) = _getTickRange();

        vault.lock(abi.encode(CallbackData({
            actionType: ActionType.SWAP_AND_ADD_LIQUIDITY,
            sender:     msg.sender,
            to:         address(0),
            ethAmount:  ethAmount,
            etimAmount: 0,
            tickLower:  tickLower,
            tickUpper:  tickUpper
        })));
    }

    /// @notice Swap WETH for ETIM and burn
    function swapAndBurn(uint256 ethAmount) external onlyMainContract {
        weth.safeTransferFrom(msg.sender, address(this), ethAmount);

        vault.lock(abi.encode(CallbackData({
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
    //                PANCAKESWAP V4 CALLBACK
    // =========================================================

    function lockAcquired(bytes calldata rawData)
        external
        override
        returns (bytes memory)
    {
        if (msg.sender != address(vault)) revert OnlyVault();

        CallbackData memory data = abi.decode(rawData, (CallbackData));

        if (data.actionType == ActionType.ADD_LIQUIDITY) {
            return _handleAddLiquidity(data);
        } else if (data.actionType == ActionType.SWAP) {
            return _handleSwap(data);
        } else if (data.actionType == ActionType.SWAP_AND_ADD_LIQUIDITY) {
            return _handleSwapAndAddLiquidity(data);
        } else if (data.actionType == ActionType.COLLECT_FEES) {
            return _handleCollectFees(data);
        } else {
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
            ICLPoolManager.ModifyLiquidityParams({
                tickLower:      data.tickLower,
                tickUpper:      data.tickUpper,
                liquidityDelta: int256(uint256(liquidity)),
                salt:           bytes32(0)
            }),
            ""
        );

        _settleDelta(delta);

        emit LiquidityAdded(data.etimAmount, data.ethAmount);
        return "";
    }

    function _handleSwap(CallbackData memory data) internal returns (bytes memory) {
        if (data.ethAmount > 0) {
            // WETH → ETIM
            BalanceDelta delta = poolManager.swap(
                etimEthPoolKey,
                ICLPoolManager.SwapParams({
                    zeroForOne:        true,
                    amountSpecified:   -int256(data.ethAmount),
                    sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
                }),
                ""
            );

            if (delta.amount0() < 0) {
                _settleWeth(uint256(-int256(delta.amount0())));
            }

            uint256 etimOut = 0;
            if (delta.amount1() > 0) {
                etimOut = uint256(int256(delta.amount1()));
                vault.take(etimEthPoolKey.currency1, data.to, etimOut);
            }

            return abi.encode(etimOut);
        } else {
            // ETIM → WETH
            BalanceDelta delta = poolManager.swap(
                etimEthPoolKey,
                ICLPoolManager.SwapParams({
                    zeroForOne:        false,
                    amountSpecified:   -int256(data.etimAmount),
                    sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
                }),
                ""
            );

            uint256 ethOut = 0;
            if (delta.amount0() > 0) {
                ethOut = uint256(int256(delta.amount0()));
                vault.take(etimEthPoolKey.currency0, data.to, ethOut);
            }

            if (delta.amount1() < 0) {
                _settleEtim(uint256(-int256(delta.amount1())));
            }

            return abi.encode(ethOut);
        }
    }

    function _handleSwapAndAddLiquidity(CallbackData memory data) internal returns (bytes memory) {
        uint256 swapEth      = data.ethAmount / 2;
        uint256 liquidityEth = data.ethAmount - swapEth;

        // 1. WETH → ETIM
        BalanceDelta swapDelta = poolManager.swap(
            etimEthPoolKey,
            ICLPoolManager.SwapParams({
                zeroForOne:        true,
                amountSpecified:   -int256(swapEth),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );

        if (swapDelta.amount0() < 0) {
            _settleWeth(uint256(-int256(swapDelta.amount0())));
        }

        uint256 etimReceived = 0;
        if (swapDelta.amount1() > 0) {
            etimReceived = uint256(int256(swapDelta.amount1()));
            vault.take(etimEthPoolKey.currency1, address(this), etimReceived);
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

        (BalanceDelta liqDelta,) = poolManager.modifyLiquidity(
            etimEthPoolKey,
            ICLPoolManager.ModifyLiquidityParams({
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
        BalanceDelta delta = poolManager.swap(
            etimEthPoolKey,
            ICLPoolManager.SwapParams({
                zeroForOne:        true,
                amountSpecified:   -int256(data.ethAmount),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );

        if (delta.amount0() < 0) {
            _settleWeth(uint256(-int256(delta.amount0())));
        }

        uint256 etimBurned = 0;
        if (delta.amount1() > 0) {
            etimBurned = uint256(int256(delta.amount1()));
            vault.take(etimEthPoolKey.currency1, BURN_ADDRESS, etimBurned);
        }

        emit SwappedAndBurned(data.ethAmount, etimBurned);
        return "";
    }

    function _handleCollectFees(CallbackData memory) internal returns (bytes memory) {
        (int24 tickLower, int24 tickUpper) = _getTickRange();

        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            etimEthPoolKey,
            ICLPoolManager.ModifyLiquidityParams({
                tickLower:      tickLower,
                tickUpper:      tickUpper,
                liquidityDelta: 0,
                salt:           bytes32(0)
            }),
            ""
        );

        uint256 fee0 = delta.amount0() > 0 ? uint256(int256(delta.amount0())) : 0;
        uint256 fee1 = delta.amount1() > 0 ? uint256(int256(delta.amount1())) : 0;

        if (fee0 > 0) vault.take(etimEthPoolKey.currency0, address(this), fee0);
        if (fee1 > 0) vault.take(etimEthPoolKey.currency1, address(this), fee1);

        emit FeesCollected(fee0, fee1);
        return "";
    }

    // =========================================================
    //                   SETTLEMENT HELPERS
    // =========================================================

    function _settleDelta(BalanceDelta delta) internal {
        if (delta.amount0() < 0) _settleWeth(uint256(-int256(delta.amount0())));
        if (delta.amount1() < 0) _settleEtim(uint256(-int256(delta.amount1())));
        if (delta.amount0() > 0) vault.take(etimEthPoolKey.currency0, address(this), uint256(int256(delta.amount0())));
        if (delta.amount1() > 0) vault.take(etimEthPoolKey.currency1, address(this), uint256(int256(delta.amount1())));
    }

    /// @dev Settle WETH (ERC-20) to Vault: sync → transfer → settle
    function _settleWeth(uint256 amount) internal {
        vault.sync(etimEthPoolKey.currency0);
        weth.safeTransfer(address(vault), amount);
        vault.settle();
    }

    /// @dev Settle ETIM to Vault: sync → transfer → settle
    function _settleEtim(uint256 amount) internal {
        vault.sync(etimEthPoolKey.currency1);
        etim.safeTransfer(address(vault), amount);
        vault.settle();
    }

    // =========================================================
    //                      TICK HELPERS
    // =========================================================

    function _getTickRange() internal view returns (int24 tickLower, int24 tickUpper) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(etimEthPoolId);
        if (sqrtPriceX96 == 0) revert PoolNotInitialized();

        int24 spacing = int24(etimEthPoolKey.parameters.getTickSpacing());
        tickLower = (TickMath.MIN_TICK / spacing) * spacing;
        tickUpper = (TickMath.MAX_TICK / spacing) * spacing;
    }

    // =========================================================
    //                     ADMIN FUNCTIONS
    // =========================================================

    function withdrawToken(uint256 amount, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        etim.safeTransfer(to, amount);
    }

    function withdrawEth(uint256 amount, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        weth.safeTransfer(to, amount);
    }

    function collectFees() external onlyOwner {
        vault.lock(abi.encode(CallbackData({
            actionType: ActionType.COLLECT_FEES,
            sender:     msg.sender,
            to:         address(this),
            ethAmount:  0,
            etimAmount: 0,
            tickLower:  0,
            tickUpper:  0
        })));
    }

    function setMainContract(address _mainContract) external onlyOwner {
        if (_mainContract == address(0)) revert ZeroAddress();
        emit MainContractUpdated(mainContract, _mainContract);
        mainContract = _mainContract;
    }

    function initializePool(uint160 sqrtPriceX96) external onlyOwner {
        poolManager.initialize(etimEthPoolKey, sqrtPriceX96);
        weth.approve(address(vault), type(uint256).max);
        etim.approve(address(vault), type(uint256).max);
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
}
