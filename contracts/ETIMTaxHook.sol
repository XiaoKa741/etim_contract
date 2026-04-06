// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CLBaseHook} from "@pancakeswap/infinity-periphery/src/pool-cl/CLBaseHook.sol";
import {ICLPoolManager} from "@pancakeswap/infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {IVault} from "@pancakeswap/infinity-core/src/interfaces/IVault.sol";
import {PoolKey} from "@pancakeswap/infinity-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@pancakeswap/infinity-core/src/types/PoolId.sol";
import {BalanceDelta} from "@pancakeswap/infinity-core/src/types/BalanceDelta.sol";
import {Currency, CurrencyLibrary} from "@pancakeswap/infinity-core/src/types/Currency.sol";
import {BeforeSwapDelta, toBeforeSwapDelta, BeforeSwapDeltaLibrary} from "@pancakeswap/infinity-core/src/types/BeforeSwapDelta.sol";
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

    // =========================================================
    //                  WHITELIST (EXEMPT ADDRESSES)
    // =========================================================

    mapping(address => bool) public isExempt;

    // =========================================================
    //                  TAX ASSIGN
    // =========================================================

    uint256 public buyTax;
    uint256 public sellTaxToBurn;
    uint256 public sellTaxToS6;
    uint256 public sellTaxToFoundation;
    uint256 public sellTaxToOfficial;

    // =========================================================
    //                      CONSTRUCTOR
    // =========================================================

    constructor(
        ICLPoolManager _poolManager,
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
                afterSwap:                     true,
                beforeDonate:                  false,
                afterDonate:                   false,
                beforeSwapReturnDelta:         true,
                afterSwapReturnDelta:          true,
                afterAddLiquidityReturnDelta:  false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
    }

    // =========================================================
    //                    CORE HOOK LOGIC
    // =========================================================

    function _afterSwap(
        address,
        PoolKey calldata,
        ICLPoolManager.SwapParams calldata,
        BalanceDelta,
        bytes calldata
    )
        internal
        override
        whenNotPaused
        returns (bytes4, int128)
    {
        return (this.afterSwap.selector, 0);
    }

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

        bool isBuy = params.zeroForOne;

        // Buy disabled when growth pool is not depleted
        if (isBuy && !(IETIMMain(mainContract).isGrowthPoolDepleted())) revert BuyNotEnabled();

        // Only exactInput
        if (params.amountSpecified > 0) revert ExactOutputNotSupported();

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
            // Take native BNB/ETH tax via vault
            vault.take(key.currency0, address(this), taxAmount);
            buyTax += taxAmount;
        } else {
            // Take ETIM tax via vault
            vault.take(key.currency1, address(this), taxAmount);
            uint256 toS6         = taxAmount / 6;
            uint256 toFoundation = taxAmount / 6;
            uint256 toOfficial   = taxAmount / 6;
            uint256 toBurn       = taxAmount - toS6 - toFoundation - toOfficial;

            sellTaxToS6         += toS6;
            sellTaxToFoundation += toFoundation;
            sellTaxToOfficial   += toOfficial;
            sellTaxToBurn       += toBurn;
        }

        return (
            this.beforeSwap.selector,
            toBeforeSwapDelta(
                int128(int256(taxAmount)),
                0
            ),
            0
        );
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

    function burnSellTax() external onlyOwner nonReentrant {
        uint256 amount = sellTaxToBurn;
        if (amount == 0) revert NothingToWithdraw();
        sellTaxToBurn = 0;
        IERC20(etimContract).safeTransfer(BURN_ADDRESS, amount);
    }

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

    function getTaxConfig() external view returns (uint256 _buyBps, uint256 _sellBps) {
        return (buyTaxBps, sellTaxBps);
    }

    // =========================================================

    receive() external payable {}
}
