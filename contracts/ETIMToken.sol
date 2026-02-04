// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IETIMMain {
    function procTokenTransfer(
        address from,
        address to,
        uint256 value
    ) external;
}

interface IETIMNode {
    function addPerformance(uint256 amount) external;
}

contract ETIMToken is ERC20, Ownable {
    uint256 public constant TOTAL_SUPPLY = 2_100_000_000 * 10 ** 18;
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // 各模块分配
    uint256 public constant GROWTH_POOL = 1_925_700_000 * 10 ** 18; // 91.7%
    uint256 public constant MARKET_INFRA = 105_000_000 * 10 ** 18; // 5%
    uint256 public constant ECOSYSTEM_FUND = 21_000_000 * 10 ** 18; // 1%
    uint256 public constant COMMUNITY_FUND = 21_000_000 * 10 ** 18; // 1%
    uint256 public constant AIRDROP = 21_000_000 * 10 ** 18; // 1%
    uint256 public constant ETH_FOUNDATION = 6_300_000 * 10 ** 18; // 0.3%

    // 分配地址
    // address public growthPool; // 增长池 92.7%
    address public marketInfra; // 市场基础设施 5%
    address public ecoFund; // 生态建设基金 1%
    address public communityFund; // 社区建设 1%
    address public airdrop; // 空投 1%
    address public ethFoundation; // 以太坊基金会 0.3%

    // 增长池已释放数量
    uint256 public growthPoolReleased;

    // 主逻辑合约
    address public mainContract;
    address public nodeContract;

    address public lpPair;
    address public lpRouter;

    // 买卖滑点
    uint256 public buySlippage = 30; // 3% = 30/1000
    uint256 public sellSlippage = 30; // 3%  = 30/1000
    
    // 卖出分配
    uint256 public constant SELL_LP = 850; // 85% = 850/1000
    uint256 public constant SELL_BURN = 100; // 10%
    uint256 public constant SELL_NODE = 50; // 5%

    uint256 public constant FEE_DENOMINATOR = 1000;

    modifier onlyMainContract() {
        require(msg.sender == mainContract, "Only main contract");
        _;
    }

    constructor(
        address _marketInfra,
        address _ecoFund,
        address _communityFund,
        address _airdrop,
        address _ethFoundation
    ) ERC20("ETIM Token", "ETIM") Ownable(msg.sender) {
        marketInfra = _marketInfra;
        ecoFund = _ecoFund;
        communityFund = _communityFund;
        airdrop = _airdrop;
        ethFoundation = _ethFoundation;

        // 初始分配
        _mint(address(this), TOTAL_SUPPLY);
        _transfer(address(this), marketInfra, MARKET_INFRA);
        _transfer(address(this), ecoFund, ECOSYSTEM_FUND);
        _transfer(address(this), communityFund, COMMUNITY_FUND);
        _transfer(address(this), airdrop, AIRDROP);
        _transfer(address(this), ethFoundation, ETH_FOUNDATION);
    }

    // 设置主合约
    function setMainContract(address _mainContract) external onlyOwner {
        require(mainContract == address(0), "Main already set");
        mainContract = _mainContract;
    }

    // 设置节点合约
    function setNodeContract(address _nodeContract) external onlyOwner {
        require(nodeContract == address(0), "Node already set");
        nodeContract = _nodeContract;
    }

    // 增长池释放代币
    function releaseFromGrowthPool(
        address to,
        uint256 amount
    ) external {
        require(msg.sender == mainContract || msg.sender == nodeContract, "Only main/node contract");
        require(growthPoolReleased + amount <= GROWTH_POOL, "Exceeds growth pool");
        
        growthPoolReleased += amount;
        _transfer(address(this), to, amount);
    }

    // 销毁功能
    function burnToBlackHole(uint256 amount) external onlyMainContract {
        _transfer(address(this), BURN_ADDRESS, amount);
    }

    // 获取剩余增长池数量
    function remainingGrowthPool() external view returns (uint256) {
        return GROWTH_POOL - growthPoolReleased;
    }

    // 检查增长池是否挖完
    function isGrowthPoolDepleted() public view returns (bool) {
        return growthPoolReleased >= GROWTH_POOL;
    }

    // 代币变化触发main合约逻辑处理
    function _update(address from, address to, uint256 value) internal override {
        // mint/burn
        if (from == address(0) || to == address(0) || to == BURN_ADDRESS || mainContract == address(0)) {
            super._update(from, to, value);
            return;
        }
        
        // transfer
        if(from == lpPair) {
            // 移除流动性
            if (msg.sender == lpRouter) return;
            // 买入
            buyETIM(from, to, value);
        } else if (to == lpPair) {
            // 添加流动性
            if (msg.sender == lpRouter) return;
            // 卖出
            sellETIM(from, to, value);
        }

        // main
        try IETIMMain(mainContract).procTokenTransfer(from, to, value) {} catch {}
    }

    // 检查是否合约
    function _isContract(address addr) internal view returns (bool) {
        return addr.code.length > 0;
    }

    // 设置LP pair、router地址
    function setUniswapV2PairRouter(address router, address pair) external onlyMainContract {
        require(router != address(0) && pair != address(0), "Invalid pair");
        lpRouter = router;
        lpPair = pair;
    }

    // 卖出
    function sellETIM(address from, address to, uint256 value) internal {
        // 计算分配
        uint256 lpAmount = (value * SELL_LP) / FEE_DENOMINATOR;
        uint256 burnAmount = (value * SELL_BURN) / FEE_DENOMINATOR;
        uint256 nodeAmount = (value * SELL_NODE) / FEE_DENOMINATOR;
        
        // 85% 去LP
        if (lpAmount > 0) {
            super._update(from, to, lpAmount);
        }
        // 10% 销毁
        if (burnAmount > 0) {
            super._update(from, BURN_ADDRESS, burnAmount);
        }
        // 5% 参与节点业绩分配
        if (nodeAmount > 0) {
            try IETIMNode(nodeContract).addPerformance(value) {} catch {}
        }
    }

    // 买入
    function buyETIM(address, address, uint256) view internal {
        require(isGrowthPoolDepleted(), "GP not depleted");
    }
}
