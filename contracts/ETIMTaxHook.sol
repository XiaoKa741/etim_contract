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
import {BeforeSwapDelta, toBeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

// import "hardhat/console.sol"; // only for local debugging

// Progress sell — no business logic
interface IETIMMain {
    function distributeNodePerformanceOnEtimSell(uint256 etimAmount) external;
}

/// @notice Uniswap V4 Hook — applies tax on buys/sells; tax is held in this contract and can be withdrawn by owner
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
    error AlreadySet();

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
    event TokenContractUpdated(address indexed current);
    event MainContractUpdated(address indexed previous, address indexed next);

    // =========================================================
    //                      CONSTANTS
    // =========================================================

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_TAX_BPS     = 1_000; // Max 10%
    address public constant BURN_ADDRESS    = 0x000000000000000000000000000000000000dEaD;

    // =========================================================
    //                    TAX CONFIGURATION
    // =========================================================

    uint256 public buyTaxBps;
    uint256 public sellTaxBps;

    // =========================================================
    //                    BUSINESS CONTRACT
    // =========================================================

    address etimContract;
    address mainContract;

    // =========================================================
    //                    ACCESS CONTROL
    // =========================================================

    address public owner;
    address public pendingOwner;
    bool    public tradingEnabled;

    // =========================================================
    //                  WHITELIST (EXEMPT ADDRESSES)
    // =========================================================

    /// @notice Exempt whitelist: internal contracts like ETIMPoolHelper are added here to avoid taxation
    mapping(address => bool) public isExempt;

    // =========================================================
    //                  TAX ACCUMULATOR
    // =========================================================

    /// @notice currency => accumulated tax balance
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
        if (_poolManager  == address(0)) revert ZeroAddress();
        if (_owner        == address(0)) revert ZeroAddress();
        if (_buyTaxBps    > MAX_TAX_BPS) revert InvalidBps();
        if (_sellTaxBps   > MAX_TAX_BPS) revert InvalidBps();

        owner        = _owner;
        buyTaxBps    = _buyTaxBps;
        sellTaxBps   = _sellTaxBps;
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
            beforeSwap:                    true,  // Handle sell-side allocation logic
            afterSwap:                     true,  // Deduct tax after trade
            beforeDonate:                  false,
            afterDonate:                   false,
            beforeSwapReturnDelta:         true,  // Modify actual ETIM input to pool
            afterSwapReturnDelta:          true,  // Modify user's actual output amount
            afterAddLiquidityReturnDelta:  false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // =========================================================
    //                    CORE HOOK LOGIC
    // =========================================================

    /// @notice _afterSwap: calculate tax, deduct from user output, and hold in this contract
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
        // console.log("[_afterSwap] ENTER"); // DEBUG
        // Skip for whitelisted addresses
        if (isExempt[sender]) {
            // console.log("[_afterSwap] EXIT WHITE LIST"); // DEBUG
            return (this.afterSwap.selector, 0);
        }
        // Enforce trading status
        if (!tradingEnabled) {
            revert TradingNotEnabled();
        }

        // zeroForOne = true  → buy, output is currency1
        // zeroForOne = false → sell, output is currency0
        bool     isBuy          = params.zeroForOne;
        int128   outputDelta    = isBuy ? delta.amount1() : delta.amount0();
        Currency outputCurrency = isBuy ? key.currency1  : key.currency0;

        // Selling ETIM direction (zeroForOne = false)
        if (!isBuy) {
            // beforeSwap has done!
            // if (params.amountSpecified > 0) revert ExactOutputNotSupported();

            // exactInput: user specifies how much ETIM to sell
            uint256 etimIn = uint256(-params.amountSpecified);
            uint256 toLp   = etimIn * 85 / 100;  // 85% goes to liquidity
            uint256 toBurn = etimIn * 10 / 100;  // 10% burned
            uint256 toNode = etimIn - toLp - toBurn; // 5% to node performance

            // Hook take burn+node (can use poolManager.mint/poolManager.burn instead)
            poolManager.take(key.currency1, address(this), toBurn + toNode);
            // 10% → burn address
            IERC20(etimContract).safeTransfer(BURN_ADDRESS, toBurn);
            // 5% → main contract for node rewards
            IERC20(etimContract).safeTransfer(mainContract, toNode);
            // call distribute node performance
            try IETIMMain(etimContract).distributeNodePerformanceOnEtimSell(toNode) {} catch {}
            // 85% → had swapped
        }

        // console.log("[_afterSwap] params:"); // DEBUG
        // console.logBool(params.zeroForOne); // DEBUG
        // console.logInt(params.amountSpecified); // DEBUG

        // console.log("[_afterSwap] outputDelta:"); // DEBUG
        // console.logInt(delta.amount0()); // DEBUG
        // console.logInt(delta.amount1()); // DEBUG
        // console.logAddress(Currency.unwrap(key.currency0)); // DEBUG
        // console.logAddress(Currency.unwrap(key.currency1)); // DEBUG

        // Only tax positive output (i.e., user actually receives tokens)
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

        // Take the tax amount from PoolManager into this contract
        poolManager.take(outputCurrency, address(this), taxAmount);

        // Record accounting
        address currencyAddr = Currency.unwrap(outputCurrency);
        taxBalance[currencyAddr] += taxAmount;

        emit TaxCollected(key.toId(), sender, currencyAddr, taxAmount, isBuy);
        // console.log("[_afterSwap] EXIT NOT WHITE LIST"); // DEBUG
        // console.log("[_afterSwap] taxAmount:", taxAmount); // DEBUG
        // console.log("[_afterSwap] taxAmount to int128:"); // DEBUG
        // console.logInt(taxAmount.toInt128()); // DEBUG

        // Return positive delta → tells V4 that user receives less by this amount
        return (this.afterSwap.selector, taxAmount.toInt128());
    }

    /// @notice _beforeSwap: handle additional allocation logic when user sells ETIM
    function _beforeSwap(
        address sender,
        PoolKey calldata,
        SwapParams calldata params,
        bytes calldata
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {

        // console.log("[_beforeSwap] ENTER ............."); // DEBUG
        // Skip for whitelisted addresses
        if (isExempt[sender]) {
            // console.log("[_beforeSwap] EXIT WHITE LIST"); // DEBUG
            return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        // Enforce trading status
        if (!tradingEnabled) {
            revert TradingNotEnabled();
        }

        // If business or token contract not set, do nothing
        if (address(0) == mainContract || address(0) == etimContract) {
            return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        // console.log("[_beforeSwap] params:"); // DEBUG
        // console.logBool(params.zeroForOne); // DEBUG
        // console.logInt(params.amountSpecified); // DEBUG

        // Selling ETIM direction (zeroForOne = false)
        if (!params.zeroForOne) {

            // Disallow exactOutput mode (where output ETH is specified and input ETIM is derived)
            if (params.amountSpecified > 0) revert ExactOutputNotSupported();

            // exactInput: user specifies how much ETIM to sell
            uint256 etimIn = uint256(-params.amountSpecified);
            uint256 toLp   = etimIn * 85 / 100;  // 85% goes to liquidity
            uint256 toBurn = etimIn * 10 / 100;  // 10% burned
            uint256 toNode = etimIn - toLp - toBurn; // 5% to node performance

            // Inform PoolManager that hook take (toBurn + toNode)
            return (
                this.beforeSwap.selector,
                toBeforeSwapDelta(
                    int128(int256(toBurn + toNode)),   // Hook take this
                    0
                ),
                0
            );
        }

        return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    // =========================================================
    //                    WITHDRAW TAX
    // =========================================================

    /// @notice Owner withdraws all accumulated tax of a given currency
    /// @param  currency  Token address (address(0) = native ETH)
    /// @param  to        Recipient address
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

    /// @notice Owner withdraws partial tax of a given currency
    /// @param  currency  Token address (address(0) = native ETH)
    /// @param  amount    Amount to withdraw
    /// @param  to        Recipient address
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

    /// @notice Set buy/sell tax rates (in bps, max 10%)
    function setTaxRates(uint256 _buyBps, uint256 _sellBps) external onlyOwner {
        if (_buyBps > MAX_TAX_BPS || _sellBps > MAX_TAX_BPS) revert InvalidBps();
        buyTaxBps  = _buyBps;
        sellTaxBps = _sellBps;
        emit TaxRateUpdated(_buyBps, _sellBps);
    }

    /// @notice Manage tax-exempt whitelist (e.g., add ETIMPoolHelper)
    function setExempt(address account, bool exempt) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        isExempt[account] = exempt;
        emit ExemptUpdated(account, exempt);
    }

    /// @notice Enable/disable trading for non-exempt addresses
    function setTradingEnabled(bool enabled) external onlyOwner {
        tradingEnabled = enabled;
    }

    /// @notice Set the ETIM token contract address (only once, by owner)
    function setTokenContract(address _etimContract) external onlyOwner {
        if (address(0) != etimContract) revert AlreadySet();
        if (address(0) == _etimContract) revert ZeroAddress();
        emit TokenContractUpdated(_etimContract);
        etimContract = _etimContract;
    }

    /// @notice Set the main business contract address (only owner)
    function setMainContract(address _mainContract) external onlyOwner {
        if (_mainContract == address(0)) revert ZeroAddress();
        emit MainContractUpdated(mainContract, _mainContract);
        mainContract = _mainContract;
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

    /// @notice Query current tax configuration
    function getTaxConfig() external view returns (uint256 _buyBps, uint256 _sellBps) {
        return (buyTaxBps, sellTaxBps);
    }

    // =========================================================
    //                      RECEIVE ETH
    // =========================================================

    receive() external payable {}
}