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
    function isGrowthPoolDepleted() external view returns (bool);
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
    error BuyNotEnabled();
    error SellNotEnabled();
    error ExactOutputNotSupported();
    error AlreadySet();
    error NotMainContract();

    // =========================================================
    //                        EVENTS
    // =========================================================

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
    // bool    public buyEnabled;
    // bool    public sellEnabled;

    // =========================================================
    //                  WHITELIST (EXEMPT ADDRESSES)
    // =========================================================

    /// @notice Exempt whitelist: internal contracts like ETIMPoolHelper are added here to avoid taxation
    mapping(address => bool) public isExempt;

    // =========================================================
    //                  TAX ASSIGN
    // =========================================================

    /// @notice buyTax official record
    uint256 public buyTax;

    /// @notice sellTax: 50% burn, 1/6 to S6, 1/6 to Foundation, 1/6 to Official
    uint256 public sellTaxToBurn;
    uint256 public sellTaxToS6;
    uint256 public sellTaxToFundation;
    uint256 public sellTaxToOfficial;

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
        address /* sender */,
        PoolKey calldata /* key */,
        SwapParams calldata /* params */ ,
        BalanceDelta /* delta */,
        bytes calldata
    )
        internal
        override
        whenNotPaused
        returns (bytes4, int128)
    {
        return (this.afterSwap.selector, 0);
        /*
        // console.log("[_afterSwap] ENTER"); // DEBUG
        // Skip for whitelisted addresses
        if (isExempt[sender]) {
            // console.log("[_afterSwap] EXIT WHITE LIST"); // DEBUG
            return (this.afterSwap.selector, 0);
        }

        // zeroForOne = true  → buy, output is currency1
        // zeroForOne = false → sell, output is currency0
        bool     isBuy          = params.zeroForOne;
        int128   outputDelta    = isBuy ? delta.amount1() : delta.amount0();
        Currency outputCurrency = isBuy ? key.currency1  : key.currency0;

        // Check trading
        if (isBuy && !buyEnabled) revert BuyNotEnabled();
        if (!isBuy && !sellEnabled) revert SellNotEnabled();

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

        // Return positive delta → tells V4 that user receives less by this amount
        return (this.afterSwap.selector, taxAmount.toInt128());
        */
    }

    /// @notice _beforeSwap: handle additional allocation logic when user sells ETIM
    function _beforeSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {

        // console.log("[_beforeSwap] ENTER ............."); // DEBUG
        // Skip for whitelisted addresses
        if (isExempt[sender]) {
            // console.log("[_beforeSwap] EXIT WHITE LIST"); // DEBUG
            return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        // currency0 < currency1 (ETH/ETIM)
        // zeroForOne = true  → buy
        // zeroForOne = false → sell
        bool isBuy = params.zeroForOne;

        // Check trading
        // if (isBuy && !buyEnabled) revert BuyNotEnabled();
        // if (!isBuy && !sellEnabled) revert SellNotEnabled();
        if(isBuy && !(IETIMMain(mainContract).isGrowthPoolDepleted())) revert BuyNotEnabled();

        // Only exactInput, not support exactOutput
        if (params.amountSpecified > 0) revert ExactOutputNotSupported();

        // If business or token contract not set, do nothing
        if (address(0) == mainContract || address(0) == etimContract) {
            return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        uint256 taxBps = isBuy ? buyTaxBps : sellTaxBps;
        if (taxBps == 0) {
            return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        uint256 inAmount = uint256(-params.amountSpecified);
        uint256 taxAmount = (inAmount * taxBps) / BPS_DENOMINATOR;
        if (isBuy) {
            // mint/burn
            // poolManager.mint(address(this), key.currency0.toId(), taxAmount);
            poolManager.take(key.currency0, address(this), taxAmount);
            // assign
            buyTax += taxAmount;
        } else {
            // poolManager.mint(address(this), key.currency1.toId(), taxAmount);
            poolManager.take(key.currency1, address(this), taxAmount);
            // assign
            uint256 toS6        = taxAmount / 6;
            uint256 toFundation = taxAmount / 6;
            uint256 toOfficial  = taxAmount / 6;
            uint256 toBurn      = taxAmount - toS6 - toFundation - toOfficial; // ~50% + dust

            sellTaxToS6        += toS6;
            sellTaxToFundation += toFundation;
            sellTaxToOfficial  += toOfficial;
            sellTaxToBurn      += toBurn;
        }

        // Inform PoolManager that hook take (taxAmount)
        return (
            this.beforeSwap.selector,
            toBeforeSwapDelta(
                int128(int256(taxAmount)),   // Hook take this
                0
            ),
            0
        );
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

    /// @notice Enable/disable buy for non-exempt addresses
    // function setBuyEnabled(bool enabled) external onlyOwner {
    //     buyEnabled = enabled;
    // }

    /// @notice Enable/disable sell for non-exempt addresses
    // function setSellEnabled(bool enabled) external onlyOwner {
    //     sellEnabled = enabled;
    // }

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

    /// @notice Flush all accumulated S6 rewards to ETIMMain for distribution
    function flushS6ToMain() external nonReentrant {
        if (msg.sender != mainContract) revert NotMainContract();
        if (mainContract == address(0) || etimContract == address(0)) return;
        uint256 amount = sellTaxToS6;
        if (amount == 0) return;
        sellTaxToS6 = 0;
        IERC20(etimContract).safeTransfer(mainContract, amount);
    }

    /// @notice withdraw s6 etim tax (only owner)
    function withdrawSellTaxS6(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = sellTaxToS6;
        if (amount == 0) revert NothingToWithdraw();
        sellTaxToS6 = 0;
        IERC20(etimContract).safeTransfer(to, amount);
    }

    /// @notice withdraw official etim tax (only owner)
    function withdrawSellTaxOfficial(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = sellTaxToOfficial;
        if (amount == 0) revert NothingToWithdraw();
        sellTaxToOfficial = 0;
        IERC20(etimContract).safeTransfer(to, amount);
    }

    /// @notice withdraw foundation etim tax (only owner)
    function withdrawSellTaxFundation(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = sellTaxToFundation;
        if (amount == 0) revert NothingToWithdraw();
        sellTaxToFundation = 0;
        IERC20(etimContract).safeTransfer(to, amount);
    }

    /// @notice burn accumulated sell tax burn portion (only owner)
    function burnSellTax() external onlyOwner nonReentrant {
        uint256 amount = sellTaxToBurn;
        if (amount == 0) revert NothingToWithdraw();
        sellTaxToBurn = 0;
        IERC20(etimContract).safeTransfer(BURN_ADDRESS, amount);
    }

    /// @notice withdraw buy eth tax (only owner)
    function withdrawBuyTax(address payable to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = buyTax;
        if (amount == 0) revert NothingToWithdraw();
        buyTax = 0;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
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