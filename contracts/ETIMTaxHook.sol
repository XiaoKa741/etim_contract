// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CLBaseHook} from "./lib/CLBaseHook.sol";
import {ICLPoolManager} from "@pancakeswap/infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {IVault} from "@pancakeswap/infinity-core/src/interfaces/IVault.sol";
import {PoolKey} from "@pancakeswap/infinity-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@pancakeswap/infinity-core/src/types/PoolId.sol";
import {BalanceDelta} from "@pancakeswap/infinity-core/src/types/BalanceDelta.sol";
import {Currency, CurrencyLibrary} from "@pancakeswap/infinity-core/src/types/Currency.sol";
import {BeforeSwapDelta, toBeforeSwapDelta, BeforeSwapDeltaLibrary} from "@pancakeswap/infinity-core/src/types/BeforeSwapDelta.sol";
import {FullMath} from "@pancakeswap/infinity-core/src/pool-cl/libraries/FullMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

// Progress sell — no business logic
interface IETIMMain {
    function isGrowthPoolDepleted() external view returns (bool);
}

/// @notice PancakeSwap V4 (Infinity) Hook — applies tax on buys/sells
contract ETIMTaxHook is CLBaseHook, ReentrancyGuard, Pausable {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using SafeERC20 for IERC20;

    // =========================================================
    //                        ERRORS
    // =========================================================

    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();
    error InvalidBps();
    error NothingToWithdraw();
    error TransferFailed();
    error BuyNotEnabled();
    error ExactOutputNotSupported();
    error AlreadySet();
    error NotMainContract();
    error InvalidParams();
    error NoLiquidity();

    // =========================================================
    //                        EVENTS
    // =========================================================

    event TaxRateUpdated(uint256 buyBps, uint256 sellBps);
    event ExemptUpdated(address indexed account, bool exempt);
    event OwnershipTransferStarted(address indexed currentOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event TokenContractUpdated(address indexed current);
    event MainContractUpdated(address indexed previous, address indexed next);
    event AutoBurned(uint256 amount);
    event BasePriceUpdated(uint256 price);
    event DropProtectionUpdated(uint256 thresholdBps, uint256 extraTaxBps, uint256 maxBps);

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

    address public etimContract;
    address public mainContract;
    address public wethAddress;  // BSC bridged ETH — for buy/sell direction detection

    // =========================================================
    //                    ACCESS CONTROL
    // =========================================================

    address public owner;
    address public pendingOwner;

    // =========================================================
    //                  WHITELIST (EXEMPT ADDRESSES)
    // =========================================================

    mapping(address => bool) public isExempt;

    // =========================================================
    //                  TAX ASSIGN
    // =========================================================

    uint256 public buyTax;
    uint256 public sellTaxToS6;
    uint256 public sellTaxToFoundation;
    uint256 public sellTaxToOfficial;

    // =========================================================
    //                  DROP PROTECTION
    // =========================================================

    uint256 public basePrice;           // Base price: ETIM per WETH (18 decimals), set by owner
    uint256 public dropThresholdBps;    // Drop threshold in bps (1000 = 10%)
    uint256 public dropExtraTaxBps;     // Extra sell tax when drop exceeds threshold (bps)
    uint256 public maxSellTaxBps;       // Max sell tax cap (bps), default 3000 = 30%

    // =========================================================
    //                      CONSTRUCTOR
    // =========================================================

    constructor(
        ICLPoolManager  _poolManager,
        address         _owner,
        uint256         _buyTaxBps,
        uint256         _sellTaxBps
    ) CLBaseHook(_poolManager) {
        if (_owner      == address(0)) revert ZeroAddress();
        if (_buyTaxBps  > MAX_TAX_BPS) revert InvalidBps();
        if (_sellTaxBps > MAX_TAX_BPS) revert InvalidBps();

        owner        = _owner;
        buyTaxBps    = _buyTaxBps;
        sellTaxBps   = _sellTaxBps;
        maxSellTaxBps = 3000; // 30% default cap
    }

    // =========================================================
    //                    HOOK PERMISSIONS
    // =========================================================

    function getHooksRegistrationBitmap() external pure override returns (uint16) {
        return _hooksRegistrationBitmapFrom(
            Permissions({
                beforeInitialize:              false,
                afterInitialize:               false,
                beforeAddLiquidity:            false,
                afterAddLiquidity:             false,
                beforeRemoveLiquidity:         false,
                afterRemoveLiquidity:          false,
                beforeSwap:                    true,
                afterSwap:                     false,
                beforeDonate:                  false,
                afterDonate:                   false,
                beforeSwapReturnDelta:         true,
                afterSwapReturnDelta:          false,
                afterAddLiquidityReturnDelta:  false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
    }

    // =========================================================
    //                    CORE HOOK LOGIC
    // =========================================================

    function _beforeSwap(
        address sender,
        PoolKey calldata key,
        ICLPoolManager.SwapParams calldata params,
        bytes calldata
    )
        internal
        override
        whenNotPaused
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        // Check liquidity first
        uint128 liquidity = poolManager.getLiquidity(key.toId());
        if (liquidity == 0) revert NoLiquidity();

        // Skip for whitelisted addresses
        if (isExempt[sender]) {
            return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        // Contracts not fully configured — bypass tax
        if (wethAddress == address(0) || mainContract == address(0) || etimContract == address(0)) {
            return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        // Only exactInput
        if (params.amountSpecified > 0) revert ExactOutputNotSupported();

        // Determine buy/sell direction
        bool wethIs0 = Currency.unwrap(key.currency0) == wethAddress;
        bool isBuy = wethIs0 ? params.zeroForOne : !params.zeroForOne;

        // Buy disabled when growth pool is not depleted
        if (isBuy && !(IETIMMain(mainContract).isGrowthPoolDepleted())) revert BuyNotEnabled();

        // Determine which currency is WETH and which is ETIM
        Currency wethCurr = wethIs0 ? key.currency0 : key.currency1;
        Currency etimCurr = wethIs0 ? key.currency1 : key.currency0;

        uint256 inAmount = uint256(-params.amountSpecified);

        if (isBuy) {
            // === BUY: take WETH tax ===
            if (buyTaxBps == 0) {
                return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
            }
            uint256 taxAmount = (inAmount * buyTaxBps) / BPS_DENOMINATOR;
            vault.take(wethCurr, address(this), taxAmount);
            buyTax += taxAmount;

            return (
                this.beforeSwap.selector,
                toBeforeSwapDelta(int128(int256(taxAmount)), 0),
                0
            );
        } else {
            // === SELL: apply drop protection + auto burn ===
            uint256 effectiveSellTaxBps = sellTaxBps;

            // Drop protection: if price dropped beyond threshold, increase sell tax
            if (basePrice > 0 && dropThresholdBps > 0) {
                uint256 currentPrice = _getCurrentPrice(key);
                if (currentPrice < basePrice) {
                    uint256 dropBps = (basePrice - currentPrice) * BPS_DENOMINATOR / basePrice;
                    if (dropBps >= dropThresholdBps) {
                        effectiveSellTaxBps += dropExtraTaxBps;
                        if (maxSellTaxBps > 0 && effectiveSellTaxBps > maxSellTaxBps) {
                            effectiveSellTaxBps = maxSellTaxBps;
                        }
                    }
                }
            }

            if (effectiveSellTaxBps == 0) {
                return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
            }

            uint256 taxAmount = (inAmount * effectiveSellTaxBps) / BPS_DENOMINATOR;

            // Split sell tax: burn(50%) + S6 + Foundation + Official (each ~16.7%)
            uint256 toS6         = taxAmount / 6;
            uint256 toFoundation = taxAmount / 6;
            uint256 toOfficial   = taxAmount / 6;
            uint256 toBurn       = taxAmount - toS6 - toFoundation - toOfficial;

            // Auto burn: send directly to dead address
            if (toBurn > 0) {
                vault.take(etimCurr, BURN_ADDRESS, toBurn);
                emit AutoBurned(toBurn);
            }
            // Remaining tax to hook for S6/Foundation/Official
            uint256 toHook = toS6 + toFoundation + toOfficial;
            if (toHook > 0) {
                vault.take(etimCurr, address(this), toHook);
            }

            sellTaxToS6         += toS6;
            sellTaxToFoundation += toFoundation;
            sellTaxToOfficial   += toOfficial;

            return (
                this.beforeSwap.selector,
                toBeforeSwapDelta(int128(int256(taxAmount)), 0),
                0
            );
        }
    }

    /// @dev Read current ETIM/WETH price from pool (ETIM per 1 WETH, 18 decimals)
    function _getCurrentPrice(PoolKey calldata key) private view returns (uint256) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(key.toId());
        if (sqrtPriceX96 == 0) return 0;
        uint256 priceX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        bool wethIs0 = Currency.unwrap(key.currency0) == wethAddress;
        if (wethIs0) {
            // currency0=WETH, currency1=ETIM → price = ETIM per WETH
            return FullMath.mulDiv(priceX192, 1e18, 2 ** 192);
        } else {
            // currency0=ETIM, currency1=WETH → invert to get ETIM per WETH
            return FullMath.mulDiv(2 ** 192, 1e18, priceX192);
        }
    }

    // =========================================================
    //                   ADMIN FUNCTIONS
    // =========================================================

    function setTaxRates(uint256 _buyBps, uint256 _sellBps) external onlyOwner {
        if (_buyBps > MAX_TAX_BPS || _sellBps > MAX_TAX_BPS) revert InvalidBps();
        buyTaxBps  = _buyBps;
        sellTaxBps = _sellBps;
        emit TaxRateUpdated(_buyBps, _sellBps);
    }

    function setExempt(address account, bool exempt) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        isExempt[account] = exempt;
        emit ExemptUpdated(account, exempt);
    }

    function setTokenContract(address _etimContract) external onlyOwner {
        if (address(0) != etimContract) revert AlreadySet();
        if (address(0) == _etimContract) revert ZeroAddress();
        emit TokenContractUpdated(_etimContract);
        etimContract = _etimContract;
    }

    function setMainContract(address _mainContract) external onlyOwner {
        if (_mainContract == address(0)) revert ZeroAddress();
        emit MainContractUpdated(mainContract, _mainContract);
        mainContract = _mainContract;
    }

    function setWethAddress(address _weth) external onlyOwner {
        if (_weth == address(0)) revert ZeroAddress();
        wethAddress = _weth;
    }

    function flushS6ToMain(uint256 amount) external nonReentrant {
        if (msg.sender != mainContract) revert NotMainContract();
        if (mainContract == address(0) || etimContract == address(0)) revert InvalidParams();
        if (amount == 0 || amount > sellTaxToS6) revert InvalidParams();
        sellTaxToS6 -= amount;
        IERC20(etimContract).safeTransfer(mainContract, amount);
    }

    function withdrawSellTaxOfficial(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = sellTaxToOfficial;
        if (amount == 0) revert NothingToWithdraw();
        sellTaxToOfficial = 0;
        IERC20(etimContract).safeTransfer(to, amount);
    }

    function withdrawSellTaxFoundation(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = sellTaxToFoundation;
        if (amount == 0) revert NothingToWithdraw();
        sellTaxToFoundation = 0;
        IERC20(etimContract).safeTransfer(to, amount);
    }

    // burnSellTax() removed — burn is now automatic in _beforeSwap

    function setBasePrice(uint256 _price) external onlyOwner {
        basePrice = _price;
        emit BasePriceUpdated(_price);
    }

    function setDropProtection(uint256 _thresholdBps, uint256 _extraTaxBps, uint256 _maxBps) external onlyOwner {
        if (_maxBps > 5000) revert InvalidBps(); // hard cap 50%
        dropThresholdBps = _thresholdBps;
        dropExtraTaxBps  = _extraTaxBps;
        maxSellTaxBps    = _maxBps;
        emit DropProtectionUpdated(_thresholdBps, _extraTaxBps, _maxBps);
    }

    function withdrawBuyTax(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (wethAddress == address(0)) revert ZeroAddress();
        uint256 amount = buyTax;
        if (amount == 0) revert NothingToWithdraw();
        buyTax = 0;
        IERC20(wethAddress).safeTransfer(to, amount);
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

    function getTaxConfig() external view returns (uint256 _buyBps, uint256 _sellBps) {
        return (buyTaxBps, sellTaxBps);
    }

    function getDropProtection() external view returns (
        uint256 _basePrice,
        uint256 _thresholdBps,
        uint256 _extraTaxBps,
        uint256 _maxBps
    ) {
        return (basePrice, dropThresholdBps, dropExtraTaxBps, maxSellTaxBps);
    }

}
