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

import "hardhat/console.sol";

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

    IPoolManager public immutable poolManager;
    IERC20       public immutable etim;
    IERC20       public immutable usdc;

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
        address _hook
    ) {
        if (_poolManager == address(0)) revert ZeroAddress();
        if (_etim        == address(0)) revert ZeroAddress();
        if (_usdc        == address(0)) revert ZeroAddress();

        poolManager = IPoolManager(_poolManager);
        etim        = IERC20(_etim);
        usdc        = IERC20(_usdc);
        owner       = msg.sender;

        // ETIM / Native ETH 池（fee 3000, tickSpacing 60）
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

        // USDC / Native ETH 池（fee 500, tickSpacing 10）
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

    // @notice 返回 ETIM/ETH 池的虚拟 ETH 储备量（基于当前价格和流动性推算）
    function getEthReserves() external view returns (uint256 ethReserves) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(etimEthPoolId);
        uint128 liquidity = poolManager.getLiquidity(etimEthPoolId);
        if (liquidity == 0 || sqrtPriceX96 == 0) return 0;

        // ETH 为 currency0 时: amount0 = liquidity * 2^96 / sqrtPriceX96
        ethReserves = FullMath.mulDiv(liquidity, 2 ** 96, sqrtPriceX96);
    }

    // @notice 返回 1 ETH 可换到的 ETIM 数量（基于当前池价格）
    function getEtimPerEth() external view returns (uint256 etimAmount) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(etimEthPoolId);
        if (sqrtPriceX96 == 0) return 0;

        // price = (sqrtPriceX96 / 2^96)^2 = token1/token0 = ETIM/ETH
        uint256 priceX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        etimAmount = FullMath.mulDiv(priceX192, 1e18, 2 ** 192);
    }

    // @notice 返回 1 ETH 对应的 USDC 价格
    function getUsdcPerEth() external view returns (uint256 usdcAmount) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(usdcEthPoolId);
        if (sqrtPriceX96 == 0) return 0;

        uint256 priceX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        usdcAmount = FullMath.mulDiv(priceX192, 1e18, 2 ** 192);
    }

    // =========================================================
    //               EXTERNAL MUTATING FUNCTIONS
    // =========================================================

    // @notice 直接添加流动性（ETH + ETIM 双边），用于首次初始化或手动补充流动性
    // @param  ethAmount   投入的 ETH 数量（必须 == msg.value）
    // @param  etimAmount  投入的 ETIM 数量（需提前 approve 给本合约）
    function addLiquidity(uint256 ethAmount, uint256 etimAmount)
        external
        payable
        onlyOwner
    {
        if (msg.value < ethAmount) revert InsufficientETH();

        // 将 ETIM 从调用者转入本合约，由本合约在 callback 里 settle
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

    // @notice 用 ETH 换 ETIM，ETIM 直接发给调用者
    // @param  ethAmount  花多少 ETH（必须 == msg.value）
    // @return etimOut    实际换得的 ETIM 数量
    function swapEthToEtim(uint256 ethAmount)
        external
        payable
        onlyMainContract
        returns (uint256 etimOut)
    {
        if (msg.value < ethAmount) revert InsufficientETH();

        (int24 tickLower, int24 tickUpper) = _getTickRange();
        console.log("[swapEthToEtim] tickLower:", uint256(uint24(tickLower)));
        console.log("[swapEthToEtim] tickUpper:", uint256(uint24(tickUpper)));

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

    // @notice 用 ETIM 换 ETH，ETH 发到指定地址
    // @param  etimAmount  花多少 ETIM（需提前 approve 给本合约）
    // @param  to          ETH 接收地址
    // @return ethOut      实际换得的 ETH 数量
    function swapEtimToEth(uint256 etimAmount, address to)
        external
        onlyMainContract
        returns (uint256 ethOut)
    {
        if (to == address(0)) revert ZeroAddress();

        // 拉 ETIM 到本合约，由本合约负责 settle
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

    // @notice 用 ETH 换 ETIM 后加入流动性
    // @param  ethAmount  总 ETH 数量，一半用于 swap，一半用于加流动性
    function swapAndAddLiquidity(uint256 ethAmount)
        external
        payable
        onlyMainContract
    {
        if (msg.value < ethAmount) revert InsufficientETH();

        (int24 tickLower, int24 tickUpper) = _getTickRange();
        console.log("[swapAndAddLiquidity] tickLower:", uint256(int256(tickLower)));
        console.log("[swapAndAddLiquidity] tickUpper:", uint256(int256(tickUpper)));

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

    // @notice 用 ETH 换 ETIM 后直接 burn（发到 dead 地址）
    // @param  ethAmount  花多少 ETH
    function swapAndBurn(uint256 ethAmount)
        external
        payable
        onlyMainContract
    {
        if (msg.value < ethAmount) revert InsufficientETH();

        // burn 不需要 tick range，传 0 占位
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

        console.log("[_handleAddLiquidity]:");
        console.logInt(int256(delta.amount0()));
        console.logInt(int256(delta.amount1()));

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

            // 付出 ETH
            if (delta.amount0() < 0) {
                _settleEth(uint256(-int256(delta.amount0())));
            }

            // 收 ETIM，发给 to
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

            // 收 ETH，发给 to
            uint256 ethOut = 0;
            if (delta.amount0() > 0) {
                ethOut = uint256(int256(delta.amount0()));
                poolManager.take(etimEthPoolKey.currency0, data.to, ethOut);
            }

            // 付出 ETIM
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

        console.logInt(int256(swapDelta.amount0()));
        console.logInt(int256(swapDelta.amount1()));

        if (swapDelta.amount0() < 0) {
            _settleEth(uint256(-int256(swapDelta.amount0())));
        }

        uint256 etimReceived = 0;
        if (swapDelta.amount1() > 0) {
            etimReceived = uint256(int256(swapDelta.amount1()));
            poolManager.take(etimEthPoolKey.currency1, address(this), etimReceived);
        }

        // 2. 添加流动性
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(etimEthPoolId);

        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(data.tickLower),
            TickMath.getSqrtPriceAtTick(data.tickUpper),
            liquidityEth,
            etimReceived
        );

        console.log("[_handleSwapAndAddLiquidity] liquidity:", uint256(liquidity));
        console.log("[_handleSwapAndAddLiquidity] data.tickLower:", uint256(int256(data.tickLower)));
        console.log("[_handleSwapAndAddLiquidity] data.tickUpper:", uint256(int256(data.tickUpper)));

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
        // ETH → ETIM，ETIM 直接 take 到 burn 地址
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

    // @dev 统一处理 modifyLiquidity 后的四向 delta 结算
    function _settleDelta(BalanceDelta delta) internal {
        if (delta.amount0() < 0) _settleEth(uint256(-int256(delta.amount0())));
        if (delta.amount1() < 0) _settleEtim(uint256(-int256(delta.amount1())));
        if (delta.amount0() > 0) poolManager.take(etimEthPoolKey.currency0, address(this), uint256(int256(delta.amount0())));
        if (delta.amount1() > 0) poolManager.take(etimEthPoolKey.currency1, address(this), uint256(int256(delta.amount1())));
    }

    // @dev 将 native ETH settle 给 PoolManager
    function _settleEth(uint256 amount) internal {
        poolManager.settle{value: amount}();
    }

    // @dev 将 ETIM settle 给 PoolManager（sync → safeTransfer → settle）
    function _settleEtim(uint256 amount) internal {
        poolManager.sync(etimEthPoolKey.currency1);
        etim.safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }

    // =========================================================
    //                      TICK HELPERS
    // =========================================================

    // @dev 以当前价格为中心，计算 ±10% 的 tick 范围（对齐 tickSpacing）
    function _getTickRange() internal view returns (int24 tickLower, int24 tickUpper) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(etimEthPoolId);
        if (sqrtPriceX96 == 0) revert PoolNotInitialized();

        int24 spacing     = etimEthPoolKey.tickSpacing; // 60
        int24 range       = 2400;                       // ±10%
        int24 currentTick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);

        tickLower = ((currentTick - range) / spacing) * spacing;
        tickUpper = ((currentTick + range) / spacing) * spacing;

        if (tickLower < TickMath.MIN_TICK) tickLower = TickMath.MIN_TICK;
        if (tickUpper > TickMath.MAX_TICK) tickUpper = TickMath.MAX_TICK;
    }

    // =========================================================
    //                     ADMIN FUNCTIONS
    // =========================================================

    // @notice 提取合约内的 ERC20 token（仅 mainContract 可调）
    function withdrawToken(IERC20 token, uint256 amount, address to) external onlyMainContract {
        if (to == address(0)) revert ZeroAddress();
        token.safeTransfer(to, amount);
    }

    // @notice 提取合约内的 ETH（仅 mainContract 可调）
    function withdrawEth(uint256 amount, address to) external onlyMainContract {
        if (to == address(0)) revert ZeroAddress();
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert ETHTransferFailed();
    }

    // @notice 设置主业务合约地址（仅 owner）
    function setMainContract(address _mainContract) external onlyOwner {
        if (_mainContract == address(0)) revert ZeroAddress();
        emit MainContractUpdated(mainContract, _mainContract);
        mainContract = _mainContract;
    }

    // @notice 初始化池子价格并 max approve ETIM 给 PoolManager（仅 owner，只需调一次）
    function initializePool(uint160 sqrtPriceX96) external onlyOwner {
        poolManager.initialize(etimEthPoolKey, sqrtPriceX96);
        etim.approve(address(poolManager), type(uint256).max);
    }

    // ---- 两步 ownership 转移 ----

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