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
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
// import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
// import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

// import "hardhat/console.sol";

interface IETIMMain {
    function recordBuySlippage(address buyer,uint256 etimAmount,uint256 toS6S7,uint256 toOfficial) external;
}

// contract ETIMPoolManager is IUnlockCallback, BaseHook {
contract ETIMPoolManager is IUnlockCallback {
    using SafeERC20 for IERC20;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;

    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // IMMUTABLES
    IPoolManager public immutable poolManager;
    IERC20 public immutable etim;
    IERC20 public immutable usdc;

    //
    address public mainContract;
    address public OWNER;

    // POOL KEYS
    PoolKey public etimEthPoolKey;
    PoolKey public usdcEthPoolKey;

    PoolId public etimEthPoolId;
    PoolId public usdcEthPoolId;

    // CALLBACK TYPE
    enum CallbackType {
        ADD_LIQUIDITY,
        SWAP,
        SWAP_AND_ADD_LIQUIDITY,
        SWAP_AND_BURN
    }

    // CALLBACK DATA
    struct CallbackData {
        CallbackType actionType;
        address sender;
        address to;
        uint256 ethAmount;
        uint256 etimAmount;
        int24 tickLower;
        int24 tickUpper;
    }

    // MODIFIERS
    modifier onlyMainContract() {
        require(msg.sender == mainContract, "Only main contract");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == OWNER, "Only owner");
        _;
    }

    // EVENTS
    event LiquidityAdded(uint256 etimAmount, uint256 ethAmount);
    event EthSwappedToEtim(uint256 ethIn, uint256 etimOut);
    event EtimSwappedToEth(uint256 ethIn, uint256 etimOut);
    event EthSwappedAndBurned(uint256 ethIn, uint256 etimBurned);

    constructor(
        address _poolManager,
        address _etim,
        address _usdc
    ) {
    // ) BaseHook(IPoolManager(_poolManager)) {
        require(_poolManager != address(0), "PoolManager zero");
        require(_etim != address(0), "ETIM zero");
        require(_usdc != address(0), "USDC zero");
        
        poolManager = IPoolManager(_poolManager);
        etim = IERC20(_etim);
        usdc = IERC20(_usdc);

        OWNER = msg.sender;

        // ETIM + Native ETH
        Currency currency0 = Currency.wrap(address(0));
        Currency currency1 = Currency.wrap(_etim);
        if (currency0 > currency1) {
            (currency0, currency1) = (currency1, currency0);
        }
        etimEthPoolKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
            // hooks: IHooks(address(this))
        });
        etimEthPoolId = etimEthPoolKey.toId();

        // USDC/ETH 池
        currency0 = Currency.wrap(address(0));
        currency1 = Currency.wrap(_usdc);
        if (currency0 > currency1) {
            (currency0, currency1) = (currency1, currency0);
        }
        usdcEthPoolKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 500,
            tickSpacing: 10,
            hooks: IHooks(address(0))
        });
        usdcEthPoolId = usdcEthPoolKey.toId();
    }

    /* ========== PUBLIC VIEW FUNCTIONS ========== */

    function getEthReserves() external view returns (uint256 ethReserves) {
        (uint160 sqrtPriceX96, , , ) = poolManager.getSlot0(etimEthPoolId);
        uint128 liquidity = poolManager.getLiquidity(etimEthPoolId);
        if (liquidity == 0) return 0;

        // ETH 是 token0: amount0 = liquidity / sqrtPriceX96 * 2^96
        uint256 Q96 = 2 ** 96;
        ethReserves = FullMath.mulDiv(liquidity, Q96, sqrtPriceX96);
    }

    function getPriceEtimPerEth() external view returns (uint256 etimAmount) {
        (uint160 sqrtPriceX96, , , ) = poolManager.getSlot0(etimEthPoolId);
        if (sqrtPriceX96 == 0) return 0;

        // price = (sqrtPriceX96 / 2^96)^2 = token1 / token0 = ETIM / ETH
        uint256 priceX192 = uint256(sqrtPriceX96) * sqrtPriceX96;
        
        // etim per eth
        etimAmount = FullMath.mulDiv(priceX192, 10**18, 2 ** 192);
    }

    function getPriceUsdcPerEth() external view returns (uint256 usdcAmount) {
        (uint160 sqrtPriceX96, , , ) = poolManager.getSlot0(usdcEthPoolId);
        if (sqrtPriceX96 == 0) return 0;

        uint256 priceX192 = uint256(sqrtPriceX96) * sqrtPriceX96;

        // usdc per eth
        usdcAmount = FullMath.mulDiv(priceX192, 10**18, 2 ** 192);
    }

    /* ========== EXTERNAL MUTATING FUNCTIONS ========== */

    function addLiquidity(uint256 ethAmount, uint256 etimAmount) external payable {
        require(msg.value >= ethAmount, "Insufficient ETH");

        //console.log(ethAmount, etimAmount);

        // 从 mainContract 转入 ETIM
        etim.safeTransferFrom(msg.sender, address(this), etimAmount);

        (int24 tickLower, int24 tickUpper) = _getTickRange();

        //console.log("tick range", uint256(uint24(tickLower)), uint256(uint24(tickUpper)));

        // 准备回调数据
        CallbackData memory data = CallbackData({
            actionType: CallbackType.ADD_LIQUIDITY,
            sender: msg.sender,
            to: address(0),
            ethAmount: ethAmount,
            etimAmount: etimAmount,
            tickLower: tickLower,
            tickUpper: tickUpper
        }); 

        //console.log("before unlock", uint256(uint24(etimEthPoolKey.tickSpacing)), uint256(uint24(usdcEthPoolKey.tickSpacing)));

        // 通过 unlock 触发回调
        poolManager.unlock(abi.encode(data));

        //console.log("after unlock");

        emit LiquidityAdded(etimAmount, ethAmount);
    }

    function swapEthToEtim(uint256 ethAmount) external payable returns (uint256 etimAmount) {
        require(msg.value >= ethAmount, "Insufficient ETH");

        (int24 tickLower, int24 tickUpper) = _getTickRange();

        CallbackData memory data = CallbackData({
            actionType: CallbackType.SWAP,
            sender: msg.sender,
            to: address(0),
            ethAmount: ethAmount,
            etimAmount: 0,
            tickLower: tickLower,
            tickUpper: tickUpper
        });

        bytes memory result = poolManager.unlock(abi.encode(data));
        etimAmount = abi.decode(result, (uint256));

        emit EthSwappedToEtim(ethAmount, etimAmount);
        return etimAmount;
    }

    function swapEtimToEth(uint256 etimAmount, address to) external returns (uint256 ethAmount) {
        (int24 tickLower, int24 tickUpper) = _getTickRange();

        CallbackData memory data = CallbackData({
            actionType: CallbackType.SWAP,
            sender: msg.sender,
            to: to,
            ethAmount: 0,
            etimAmount: etimAmount,
            tickLower: tickLower,
            tickUpper: tickUpper
        });

        bytes memory result = poolManager.unlock(abi.encode(data));
        ethAmount = abi.decode(result, (uint256));

        emit EtimSwappedToEth(etimAmount, ethAmount);
        return ethAmount;
    }

    // swap then add liquidity
    function swapAndAddLiquidity(uint256 ethAmount) external payable {
        require(msg.value >= ethAmount, "Insufficient ETH");

       (int24 tickLower, int24 tickUpper) = _getTickRange();

        CallbackData memory data = CallbackData({
            actionType: CallbackType.SWAP_AND_ADD_LIQUIDITY,
            sender: msg.sender,
            to: address(0),
            ethAmount: ethAmount,
            etimAmount: 0,
            tickLower: tickLower,
            tickUpper: tickUpper
        });

        poolManager.unlock(abi.encode(data));
    }

    // swap then burn
    function swapAndBurn(uint256 ethAmount) external payable {
        require(msg.value >= ethAmount, "Insufficient ETH");

        (int24 tickLower, int24 tickUpper) = _getTickRange();

        CallbackData memory data = CallbackData({
            actionType: CallbackType.SWAP_AND_BURN,
            sender: msg.sender,
            to: address(0),
            ethAmount: ethAmount,
            etimAmount: 0,
            tickLower: tickLower,
            tickUpper: tickUpper
        });

        poolManager.unlock(abi.encode(data));
    }

    /* ========== UNISWAP V4 CALLBACK ========== */

    // callback
    function unlockCallback(bytes calldata rawData) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "Only PoolManager");

        CallbackData memory data = abi.decode(rawData, (CallbackData));

        //console.log("unlockCallback", data.ethAmount, data.etimAmount);

        if (data.actionType == CallbackType.ADD_LIQUIDITY) {
            return _handleAddLiquidity(data);
        } else if (data.actionType == CallbackType.SWAP) {
            return _handleSwap(data);
        } else if (data.actionType == CallbackType.SWAP_AND_ADD_LIQUIDITY) {
            return _handleSwapAndAddLiquidity(data);
        } else if (data.actionType == CallbackType.SWAP_AND_BURN) {
            return _handleSwapAndBurn(data);
        }

        return "";
    }

    /* ========== INTERNAL HANDLERS ========== */

    function _handleAddLiquidity(CallbackData memory data) internal returns (bytes memory) {
        //
        (uint160 sqrtPriceX96, , , ) = poolManager.getSlot0(etimEthPoolId);
        
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(data.tickLower),
            TickMath.getSqrtPriceAtTick(data.tickUpper),
            data.ethAmount,      // amount0 (ETH)
            data.etimAmount      // amount1 (ETIM)
        );

        //console.log("[_handleAddLiquidity] liquidity", liquidity);

        ModifyLiquidityParams memory params = ModifyLiquidityParams({
            tickLower: data.tickLower,
            tickUpper: data.tickUpper,
            liquidityDelta: int256(uint256(liquidity)),
            salt: bytes32(0)
        });

        //console.log("[_handleAddLiquidity] poolManager.modifyLiquidity");

        (BalanceDelta delta, ) = poolManager.modifyLiquidity(etimEthPoolKey, params, "");

        //console.log("[_handleAddLiquidity]", Strings.toStringSigned(int256(delta.amount0())), Strings.toStringSigned(int256(delta.amount1())));

        // settle delta. eth is token0, etim is token1
        if (delta.amount0() < 0) {
            // pay eth
            _settleETH(uint128(-delta.amount0()));
        }
        if (delta.amount1() < 0) {
            // pay etim
            _settleETIM(uint128(-delta.amount1()));
        }
        if (delta.amount0() > 0) {
            // take eth
            _takeETH(uint128(delta.amount0()));
        }
        if (delta.amount1() > 0) {
            // take etim
            _takeETIM(uint128(delta.amount1()));
        }

        return "";
    }

    function _handleSwap(CallbackData memory data) internal returns (bytes memory) {
        if (data.ethAmount > 0){
            // ETH -> ETIM, zeroForOne = true (token0 -> token1)
            SwapParams memory params = SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(data.ethAmount),  // negative
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            });

            BalanceDelta delta = poolManager.swap(etimEthPoolKey, params, "");
            
            uint256 etimOut = 0;
            
            if (delta.amount0() < 0) {
                // settle eth
                _settleETH(uint128(-delta.amount0()));
            }
            
            if (delta.amount1() > 0) {
                // take etim to sender
                etimOut = uint128(delta.amount1());
                poolManager.take(etimEthPoolKey.currency1, data.sender, etimOut);
            }

            return abi.encode(etimOut);
        } else {
            // ETIM -> ETH, zeroForOne = false (token1 -> token0)
            SwapParams memory params = SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(data.etimAmount),  // negative
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            });

            BalanceDelta delta = poolManager.swap(etimEthPoolKey, params, "");
            
            uint256 ethOut = 0;
            
            if (delta.amount0() > 0) {
                ethOut = uint128(delta.amount0());
                poolManager.take(etimEthPoolKey.currency0, data.to, ethOut);
            }
            
            if (delta.amount1() < 0) {
                _settleETIM(uint256(int256(-delta.amount1())));
            }

            return abi.encode(ethOut);
        }
    }

    function _handleSwapAndAddLiquidity(CallbackData memory data) internal returns (bytes memory) {
        uint256 swapAmount = data.ethAmount / 2;
        uint256 liquidityEthAmount = data.ethAmount - swapAmount;

        // swap ETH -> ETIM
        SwapParams memory swapParams = SwapParams({
            zeroForOne: true,
            amountSpecified: -int256(swapAmount),
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        });

        BalanceDelta swapDelta = poolManager.swap(etimEthPoolKey, swapParams, "");
        
        // swap settle
        if (swapDelta.amount0() < 0) {
            _settleETH(uint128(-swapDelta.amount0()));
        }
        
        uint256 etimReceived = 0;
        if (swapDelta.amount1() > 0) {
            etimReceived = uint128(swapDelta.amount1());
            //
            poolManager.take(etimEthPoolKey.currency1, address(this), etimReceived);
        }

        (uint160 sqrtPriceX96, , , ) = poolManager.getSlot0(etimEthPoolId);

        // add liquidity
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(data.tickLower),
            TickMath.getSqrtPriceAtTick(data.tickUpper),
            liquidityEthAmount,
            etimReceived
        );

        ModifyLiquidityParams memory liquidityParams = ModifyLiquidityParams({
            tickLower: data.tickLower,
            tickUpper: data.tickUpper,
            liquidityDelta: int256(uint256(liquidity)),
            salt: bytes32(0)
        });

        (BalanceDelta liquidityDelta, ) = poolManager.modifyLiquidity(etimEthPoolKey, liquidityParams, "");
        
        // settle liquidity
        if (liquidityDelta.amount0() < 0) {
            _settleETH(uint128(-liquidityDelta.amount0()));
        }
        if (liquidityDelta.amount1() < 0) {
            _settleETIM(uint128(-liquidityDelta.amount1()));
        }
        if (liquidityDelta.amount0() > 0) {
            _takeETH(uint128(liquidityDelta.amount0()));
        }
        if (liquidityDelta.amount1() > 0) {
            _takeETIM(uint128(liquidityDelta.amount1()));
        }

        emit LiquidityAdded(etimReceived, liquidityEthAmount);

        return "";
    }

    function _handleSwapAndBurn(CallbackData memory data) internal returns (bytes memory) {
        // ETH -> ETIM
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -int256(data.ethAmount),
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        });

        BalanceDelta delta = poolManager.swap(etimEthPoolKey, params, "");

        //console.log("[_handleSwapAndBurn]", Strings.toStringSigned(int256(delta.amount0())), Strings.toStringSigned(int256(delta.amount1())));
        
        if (delta.amount0() < 0) {
            _settleETH(uint128(-delta.amount0()));
        }
        
        uint256 etimReceived = 0;
        if (delta.amount1() > 0) {
            etimReceived = uint128(delta.amount1());
            // burn
            poolManager.take(etimEthPoolKey.currency1, BURN_ADDRESS, etimReceived);
        }

        emit EthSwappedAndBurned(data.ethAmount, etimReceived);

        return "";
    }

    /* ========== SETTLEMENT HELPERS ========== */

    // pay eth to poolmanager
    function _settleETH(uint256 amount) internal {
        poolManager.settle{value: amount}();

        //console.log("_settleETH", amount);
    }

    // pay etim to poolmanager
    function _settleETIM(uint256 amount) internal {
        uint256 currentAllowance = etim.allowance(address(this), address(poolManager));
        if (currentAllowance < amount) {
           etim.safeIncreaseAllowance(address(poolManager), amount - currentAllowance);
        }
        poolManager.sync(etimEthPoolKey.currency1);
        etim.transfer(address(poolManager), amount);
        poolManager.settle();

        //console.log("_settleETIM", amount);
    }

    // take eth from poolmanager
    function _takeETH(uint256 amount) internal {
        poolManager.take(etimEthPoolKey.currency0, address(this), amount);

        //console.log("_takeETH", amount);
    }

    // take etim from poolmanager
    function _takeETIM(uint256 amount) internal {
        poolManager.take(etimEthPoolKey.currency1, address(this), amount);

        //console.log("_takeETIM", amount);
    }

    function _getTickRange() internal view returns (int24, int24) {
        (uint160 sqrtPriceX96, , , ) = poolManager.getSlot0(etimEthPoolId);
        require(sqrtPriceX96 > 0, "Pool not initialized");

        int24 range = 2400; // ±10%
        int24 currentTick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        int24 tickLower = ((currentTick - range) / 60) * 60;
        int24 tickUpper = ((currentTick + range) / 60) * 60;
        if(tickLower < TickMath.MIN_TICK || tickLower > TickMath.MAX_TICK) {
            tickLower = TickMath.MIN_TICK;
        }
        if(tickUpper < TickMath.MIN_TICK || tickUpper > TickMath.MAX_TICK) {
            tickUpper = TickMath.MAX_TICK;
        }

        return (tickLower, tickUpper);
    }

    /* ========== HOOK FUNCTIONS ========== */
    // function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
    //     return Hooks.Permissions({
    //         beforeInitialize: false,
    //         afterInitialize: false,
    //         beforeAddLiquidity: false,
    //         afterAddLiquidity: false,
    //         beforeRemoveLiquidity: false,
    //         afterRemoveLiquidity: false,
    //         beforeSwap: true,
    //         afterSwap: false,
    //         beforeDonate: false,
    //         afterDonate: false,
    //         beforeSwapReturnDelta: false,
    //         afterSwapReturnDelta: false,
    //         afterAddLiquidityReturnDelta: false,
    //         afterRemoveLiquidityReturnDelta: false
    //     });
    // }

    // deny external call
    // function _beforeSwap(address sender, PoolKey calldata, SwapParams calldata, bytes calldata) internal override view returns (bytes4, BeforeSwapDelta, uint24){
    //     require(sender == mainContract, "Access denied");
    //     return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    // }

    /* ========== ADMIN FUNCTIONS ========== */

    function withdrawToken(IERC20 token, uint256 amount, address to) external onlyMainContract {
        token.safeTransfer(to, amount);
    }

    function withdrawETH(uint256 amount, address to) external onlyMainContract {
        (bool success, ) = to.call{value: amount}("");
        require(success, "ETH transfer failed");
    }

    function setMainContract(address _mainContract) external onlyOwner {
        // require(_mainContract == address(0), "Already set");
        mainContract = _mainContract;
    }

    // init price
    function initializePool(uint160 sqrtPriceX96) external onlyOwner {
        poolManager.initialize(etimEthPoolKey, sqrtPriceX96);
        etim.approve(address(poolManager), type(uint256).max);
    }

    receive() external payable {}
}