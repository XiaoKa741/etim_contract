// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {SafeCast} from "@uniswap/v4-core/src/libraries/SafeCast.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

import "hardhat/console.sol";

// @notice Uniswap V4 Hook — 买入/卖出征税，税收暂存本合约，由 owner 统一提取
contract ETIMTaxHook is BaseHook, ReentrancyGuard, Pausable {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    // =========================================================
    //                        ERRORS
    // =========================================================

    error NotOwner();
    error NotPendingOwner();
    error OnlyPoolManager();
    error ZeroAddress();
    error InvalidBps();
    error NothingToWithdraw();
    error TransferFailed();
    error TradingNotEnabled();
    error ExactOutputNotSupported();

    // =========================================================
    //                        EVENTS
    // =========================================================

    event TaxCollected(
        PoolId  indexed poolId,
        address indexed trader,
        address indexed currency,
        uint256 taxAmount,
        bool    isBuy
    );
    event TaxWithdrawn(address indexed currency, uint256 amount, address indexed to);
    event TaxRateUpdated(uint256 buyBps, uint256 sellBps);
    event ExemptUpdated(address indexed account, bool exempt);
    event OwnershipTransferStarted(address indexed currentOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // =========================================================
    //                      CONSTANTS
    // =========================================================

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_TAX_BPS     = 1_000; // 最大 10%

    // =========================================================
    //                    TAX CONFIGURATION
    // =========================================================

    uint256 public buyTaxBps;
    uint256 public sellTaxBps;

    // =========================================================
    //                    ACCESS CONTROL
    // =========================================================

    address public owner;
    address public pendingOwner;
    bool public tradingEnabled;

    // =========================================================
    //                  WHITELIST (免税地址)
    // =========================================================

    // @notice 免税白名单，ETIMPoolManager 等内部合约加入后不收税
    mapping(address => bool) public isExempt;

    // =========================================================
    //                  TAX ACCUMULATOR
    // =========================================================

    // @notice currency => 累积税收余额
    mapping(address => uint256) public taxBalance;

    // =========================================================
    //                      CONSTRUCTOR
    // =========================================================

    constructor(
        address      _poolManager,
        address      _owner,
        uint256      _buyTaxBps,
        uint256      _sellTaxBps
    ) BaseHook(IPoolManager(_poolManager)) {
        if (_owner      == address(0)) revert ZeroAddress();
        if (_buyTaxBps  > MAX_TAX_BPS) revert InvalidBps();
        if (_sellTaxBps > MAX_TAX_BPS) revert InvalidBps();

        owner       = _owner;
        buyTaxBps   = _buyTaxBps;
        sellTaxBps  = _sellTaxBps;
    }

    // =========================================================
    //                    HOOK PERMISSIONS
    // =========================================================

    function getHookPermissions()
        public
        pure
        override
        returns (Hooks.Permissions memory)
    {
        return Hooks.Permissions({
            beforeInitialize:              false,
            afterInitialize:               false,
            beforeAddLiquidity:            false,
            afterAddLiquidity:             false,
            beforeRemoveLiquidity:         false,
            afterRemoveLiquidity:          false,
            beforeSwap:                    false, // 卖出税收分配 (true)
            afterSwap:                     true,  // 交易完成后扣税
            beforeDonate:                  false,
            afterDonate:                   false,
            beforeSwapReturnDelta:         false, // 修改实际进池子的 ETIM 数量(true)
            afterSwapReturnDelta:          true,  // 修改用户实际到手金额
            afterAddLiquidityReturnDelta:  false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // =========================================================
    //                    CORE HOOK LOGIC
    // =========================================================

    // @notice _afterSwap：计算税额，从用户输出中扣除，存入本合约
    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    )
        internal
        override
        whenNotPaused
        returns (bytes4, int128)
    {
        console.log("[_afterSwap] ENTER");
        // 白名单地址直接跳过
        if (isExempt[sender]) {
             console.log("[_afterSwap] EXIT WHITE LIST");
            return (this.afterSwap.selector, 0);
        }
        // 交易控制
        if (!tradingEnabled) {
            revert TradingNotEnabled();
        }

        // zeroForOne = true  → 买入，输出是 currency1
        // zeroForOne = false → 卖出，输出是 currency0
        bool     isBuy          = params.zeroForOne;
        int128   outputDelta    = isBuy ? delta.amount1() : delta.amount0();
        Currency outputCurrency = isBuy ? key.currency1  : key.currency0;

        // 只对正向输出（用户实际收到 token）收税
        if (outputDelta <= 0) {
            return (this.afterSwap.selector, 0);
        }

        uint256 taxBps = isBuy ? buyTaxBps : sellTaxBps;
        if (taxBps == 0) {
            return (this.afterSwap.selector, 0);
        }
        uint256 taxAmount = (uint256(uint128(outputDelta)) * taxBps) / BPS_DENOMINATOR;

        if (taxAmount == 0) {
            return (this.afterSwap.selector, 0);
        }

        // 从 PoolManager 把税收 take 到本合约
        poolManager.take(outputCurrency, address(this), taxAmount);

        // 记账
        address currencyAddr = Currency.unwrap(outputCurrency);
        taxBalance[currencyAddr] += taxAmount;

        emit TaxCollected(key.toId(), sender, currencyAddr, taxAmount, isBuy);
        console.log("[_afterSwap] EXIT NOT WHITE LIST");

        // 返回负数 delta → 告知 V4 用户少收这么多
        return (this.afterSwap.selector, -taxAmount.toInt128());
    }

    /*
    // @notice _beforeSwap：用户卖出ETIM进行额外分配处理
    function _beforeSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {

        // 白名单地址直接跳过
        if (isExempt[sender]) {
             console.log("[_afterSwap] EXIT WHITE LIST");
            return (this.afterSwap.selector, 0);
        }
        // 交易控制
        if (!tradingEnabled) {
            revert TradingNotEnabled();
        }

        // 卖 ETIM 方向（zeroForOne = false）
        if (!params.zeroForOne) {

            // 禁止 exactOutput （指定得到多少的ETH，反推需要卖出的ETIM的情况，这种直接revert）
            if (params.amountSpecified > 0) revert ExactOutputNotSupported();

            // exactInput 税收处理
            uint256 etimIn = uint256(-params.amountSpecified);
            uint256 toLp   = etimIn * 85 / 100;
            uint256 toBurn = etimIn * 10 / 100;
            uint256 toNode = etimIn - toLp - toBurn;

            // 从 PoolManager 取出全部 ETIM 到本合约
            poolManager.take(key.currency1, address(this), etimIn);
            // 10% → 黑洞
            etimToken.safeTransfer(BURN_ADDRESS, toBurn);

            // 5% → 节点业绩 TODO???
            // etimToken.safeTransfer(nodeContract, toNode);
            // mainContract...

            // 85% → 还回去参与swap
            poolManager.sync(key.currency1);
            etimToken.safeTransfer(address(poolManager), toLp);
            poolManager.settle();

            // 告知 PoolManager 实际参与 swap 的 ETIM 少了 (toBurn + toNode)
            return (
                this._beforeSwap.selector,
                BeforeSwapDeltaLibrary.toBeforeSwapDelta(
                    -int128(int256(toBurn + toNode)),   // 减少的 specifiedAmount
                    0
                ),
                0
            );
        }

        return (this._beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }
    */

    // =========================================================
    //                    WITHDRAW TAX
    // =========================================================

    // @notice owner 提取指定 currency 的全部税收
    // @param  currency  token 地址（address(0) = native ETH）
    // @param  to        接收地址
    function withdrawTax(address currency, address to)
        external
        onlyOwner
        nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();

        uint256 amount = taxBalance[currency];
        if (amount == 0) revert NothingToWithdraw();

        taxBalance[currency] = 0;
        _transferOut(currency, to, amount);

        emit TaxWithdrawn(currency, amount, to);
    }

    // @notice owner 提取指定 currency 的部分税收
    // @param  currency  token 地址（address(0) = native ETH）
    // @param  amount    提取金额
    // @param  to        接收地址
    function withdrawTaxPartial(address currency, uint256 amount, address to)
        external
        onlyOwner
        nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0 || amount > taxBalance[currency]) revert NothingToWithdraw();

        taxBalance[currency] -= amount;
        _transferOut(currency, to, amount);

        emit TaxWithdrawn(currency, amount, to);
    }

    // =========================================================
    //                  INTERNAL TRANSFER
    // =========================================================

    function _transferOut(address currency, address to, uint256 amount) internal {
        if (currency == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(currency).safeTransfer(to, amount);
        }
    }

    // =========================================================
    //                   ADMIN FUNCTIONS
    // =========================================================

    // @notice 设置买入/卖出税率（bps，最大 10%）
    function setTaxRates(uint256 _buyBps, uint256 _sellBps) external onlyOwner {
        if (_buyBps > MAX_TAX_BPS || _sellBps > MAX_TAX_BPS) revert InvalidBps();
        buyTaxBps  = _buyBps;
        sellTaxBps = _sellBps;
        emit TaxRateUpdated(_buyBps, _sellBps);
    }

    // @notice 设置免税白名单（ETIMPoolManager 等内部合约）
    function setExempt(address account, bool exempt) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        isExempt[account] = exempt;
        emit ExemptUpdated(account, exempt);
    }

    // @notice 非白名单交易控制(限制买卖)
    function setTradingEnabled(bool enabled) external onlyOwner {
        tradingEnabled = enabled;
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // =========================================================
    //                  OWNERSHIP TRANSFER (2-step)
    // =========================================================

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, pendingOwner);
        owner        = pendingOwner;
        pendingOwner = address(0);
    }

    // =========================================================
    //                       MODIFIERS
    // =========================================================

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // =========================================================
    //                    VIEW FUNCTIONS
    // =========================================================

    // @notice 查询当前税率配置
    function getTaxConfig() external view returns (uint256 _buyBps, uint256 _sellBps) {
        return (buyTaxBps, sellTaxBps);
    }

    // =========================================================
    //                      RECEIVE ETH
    // =========================================================

    receive() external payable {}
}
