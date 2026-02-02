// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IETIMMain {
    function getUserLevel(address user) external view returns (uint8);
    function wethPriceInUSD() external view returns (uint256);
}

contract ETIMNode is ERC721, Ownable, ReentrancyGuard {
    uint256 public constant MAX_NODES = 500;
    uint256 public constant NODE_PRICE_USD = 1000 * 10 ** 6; // 1000 USD
    uint256 public constant NODE_QUOTA_MULTIPLIER = 300 * 10 ** 6; // 每个节点300U额度

    uint256 public totalMinted;
    address public mainContract;
    IERC20 public weth;

    // uri
    string private baseTokenURI = "https://aof.global/etim/assert/node/";

    // 节点激活状态
    mapping(uint256 => bool) public nodeActivated;

    // 用户拥有的节点列表
    mapping(address => uint256[]) public userNodes;

    // 节点业绩分红记录/累计
    mapping(uint256 => uint256) public nodePerformanceRewards;
    mapping(uint256 => uint256) public nodePerformanceAddup;

    // 全网业绩池（用于分配给激活节点）
    uint256 public totalPerformancePool;
    uint256 public lastDistributedPerformance;

    // 已激活节点数量
    uint256 public activatedNodeCount;

    event NodeMinted(
        address indexed owner,
        uint256 indexed tokenId,
        uint256 wethPaid
    );
    event NodeActivated(uint256 indexed tokenId, address indexed owner);
    event PerformanceDistributed(uint256 amount, uint256 activatedNodes);
    event RewardsClaimed(
        uint256 indexed tokenId,
        address indexed owner,
        uint256 amount
    );
    event PriceUpdateTimeRecorded(uint256 timestamp);

    constructor(
        address _weth
    ) ERC721("ETIM Node", "ENODE") Ownable(msg.sender) {
        weth = IERC20(_weth);
    }

    //
    function deposit() external payable nonReentrant {
        _processMintNode(msg.sender, msg.value);
    }

    // 转入合约触发
    receive() external payable nonReentrant {
        _processMintNode(msg.sender, msg.value);
    }

    // 购买节点NFT - 使用ETH支付
    function _processMintNode(address addr, uint256 amount) private {
        require(totalMinted < MAX_NODES, "All nodes minted");
        require(mainContract != address(0), "Main contract not set");

        // 从主合约读取WETH/USD价格
        uint256 wethPriceInUSD = IETIMMain(mainContract).wethPriceInUSD();
        require(wethPriceInUSD > 0, "Invalid WETH price");

        // 1000USD等值的WETH
        uint256 requiredWETH = (NODE_PRICE_USD * 10 ** 18) / wethPriceInUSD;

        // 检查数量
        require(requiredWETH > 0, "Required WETH amount too small");
        require(amount >= requiredWETH, "Below minimum deposit");

        // 从用户账户转账WETH到本合约
        // require(
        //     weth.transferFrom(addr, address(this), requiredWETH),
        //     "WETH transfer failed"
        // );

        // 铸造NFT
        totalMinted++;
        uint256 tokenId = totalMinted;
        _safeMint(addr, tokenId);
        userNodes[addr].push(tokenId);

        emit NodeMinted(addr, tokenId, requiredWETH);
    }

    // 激活节点（需要达到S1级别）
    function activateNode(uint256 tokenId) external {
        require(ownerOf(tokenId) == msg.sender, "Not node owner");
        require(!nodeActivated[tokenId], "Already activated");
        require(mainContract != address(0), "Main contract not set");

        // 检查用户是否达到S1级别
        uint8 level = IETIMMain(mainContract).getUserLevel(msg.sender);
        require(level >= 1, "Need S1 level to activate");

        nodeActivated[tokenId] = true;
        activatedNodeCount++;

        // 有待分配在的业绩也要马上分配
        _distributePerformance();

        emit NodeActivated(tokenId, msg.sender);
    }

    // 添加业绩到分红池（主合约调用）
    function addPerformance(uint256 amount) external {
        require(msg.sender == mainContract, "Only main contract");
        totalPerformancePool += amount;

        // 实时分配业绩
        _distributePerformance();
    }

    // 分配业绩奖励给所有激活的节点
    function _distributePerformance() internal {
        uint256 pendingDistribution = totalPerformancePool -
            lastDistributedPerformance;
        if (pendingDistribution == 0 || activatedNodeCount == 0) return;

        uint256 rewardPerNode = pendingDistribution / activatedNodeCount;
        if (rewardPerNode == 0) return;

        // 当前节点额度WETH价格
        uint256 wethPriceInUSD = IETIMMain(mainContract).wethPriceInUSD();
        uint256 nodeGotLimitInWETH = (NODE_QUOTA_MULTIPLIER * 10 ** 18) /
            wethPriceInUSD;

        // 分配给每个激活的节点
        for (uint256 i = 1; i <= totalMinted; i++) {
            if (nodeActivated[i]) {
                uint256 currentGotInWETH = nodePerformanceAddup[i];
                uint256 remainGainInWETH = nodeGotLimitInWETH -
                    currentGotInWETH; // 剩余可获取的额度
                rewardPerNode = rewardPerNode > remainGainInWETH
                    ? remainGainInWETH
                    : rewardPerNode;
                if (rewardPerNode > 0) {
                    nodePerformanceRewards[i] += rewardPerNode;
                    nodePerformanceAddup[i] += rewardPerNode;
                }
            }
        }

        lastDistributedPerformance = totalPerformancePool;

        emit PerformanceDistributed(pendingDistribution, activatedNodeCount);
    }

    // 分配业绩奖励给所有激活的节点
    /*
    function distributePerformance() external {
        _distributePerformance();
    }
    */

    // 节点持有者领取奖励
    function claimRewards(uint256 tokenId) external nonReentrant {
        require(ownerOf(tokenId) == msg.sender, "Not node owner");
        require(nodeActivated[tokenId], "Node not activated");

        uint256 rewards = nodePerformanceRewards[tokenId];
        require(rewards > 0, "No rewards to claim");

        // 检查合约WETH余额是否充足
        // require(weth.balanceOf(address(this)) >= rewards, "Insufficient contract balance");

        // 检查合约ETH数量
        require(address(this).balance >= rewards, "Insufficient ETH");

        // 转账WETH奖励
        // require(weth.transfer(msg.sender, rewards), "WETH transfer failed");
        (bool success, ) = payable(msg.sender).call{value: rewards}("");
        require(success, "ETH transfer failed");
        
        nodePerformanceRewards[tokenId] = 0;

        emit RewardsClaimed(tokenId, msg.sender, rewards);
    }

    // 获取用户所有节点
    function getUserNodes(
        address user
    ) external view returns (uint256[] memory) {
        return userNodes[user];
    }

    // 获取节点待领取奖励
    function getPendingRewards(
        uint256 tokenId
    ) external view returns (uint256) {
        return nodePerformanceRewards[tokenId];
    }

    // 检查节点是否激活
    function isNodeActivated(uint256 tokenId) external view returns (bool) {
        return nodeActivated[tokenId];
    }

    // 获取用户激活的节点数量
    function getActivatedNodeCount(
        address user
    ) external view returns (uint256) {
        uint256 count = 0;
        uint256[] memory nodes = userNodes[user];
        for (uint256 i = 0; i < nodes.length; i++) {
            if (nodeActivated[nodes[i]]) {
                count++;
            }
        }
        return count;
    }

    // 获取当前应支付的WETH数量（用于前端展示）
    function getCurrentNodePriceInWETH() public view returns (uint256) {
        if (mainContract == address(0)) return 0;

        uint256 wethPriceInUSD = IETIMMain(mainContract).wethPriceInUSD();
        if (wethPriceInUSD == 0) return 0;

        return (NODE_PRICE_USD * 10 ** 18) / wethPriceInUSD;
    }

    function _baseURI() internal view override returns (string memory) {
        return baseTokenURI;
    }

    function tokenURI(
        uint256 tokenId
    ) public view override returns (string memory) {
        // 暂时直接调用父类方法拼接即可
        return super.tokenURI(tokenId);
    }

    // 转移
    function transferFrom(
        address from,
        address to,
        uint256 tokenId
    ) public override {
        super.transferFrom(from, to, tokenId);

        uint256[] storage nodes = userNodes[from];
        uint256 length = nodes.length;
        for (uint256 i = 0; i < nodes.length; i++) {
            if (nodes[i] == tokenId) {
                nodes[i] = nodes[length - 1];
                nodes.pop();
                break;
            }
        }
        userNodes[to].push(tokenId);
    }

    // 设置逻辑合约
    function setMainContract(address _mainContract) external onlyOwner {
        require(mainContract == address(0), "Already set");
        mainContract = _mainContract;
    }

    // 设置BaseUri
    function setBaseURI(string memory baseURI) public onlyOwner {
        baseTokenURI = baseURI;
    }

    // 提取合约中的WETH（仅owner）
    function withdrawWETH(uint256 amount) external onlyOwner {
        uint256 contractBalance = weth.balanceOf(address(this));

        // 计算所有待领取的奖励总额
        uint256 totalPendingRewards = 0;
        for (uint256 i = 1; i <= totalMinted; i++) {
            totalPendingRewards += nodePerformanceRewards[i];
        }

        // 只允许提取超出待领取奖励的部分
        require(
            contractBalance >= totalPendingRewards + amount,
            "Cannot withdraw user rewards"
        );

        require(weth.transfer(owner(), amount), "WETH transfer failed");
    }
}
