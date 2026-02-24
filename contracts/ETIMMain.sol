// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

interface IETIMPoolManager {
    function getEthReserves() external view returns (uint256);
    function getPriceEtimPerEth() external view returns (uint256);
    function getPriceUsdcPerEth() external view returns (uint256);
    // function addLiquidity(uint256 ethAmount, uint256 etimAmount) external payable;
    function swapEthToEtim(uint256 ethAmount) external payable returns (uint256);
    function swapEtimToEth(uint256 etimAmount, address to) external returns (uint256);
    function swapAndAddLiquidity(uint256 ethAmount) external payable;
    function swapAndBurn(uint256 ethAmount) external payable;
}

contract ETIMMain is Ownable, ReentrancyGuard {
    IERC20 public etimToken;
    IERC721 public etimNode;
    IETIMPoolManager public etimPoolManager;

    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    
    // grow pool etim amount
    uint256 public constant GROWTH_POOL = 1_925_700_000 * 10 ** 18;
    
    // 基础参数（可由owner调整）
    uint256 public participationAmountMin = 100 * 10**6; // 100U
    uint256 public participationAmountMax = 150 * 10**6; // 150U
    uint256 public dailyReleaseRate = 10; // 1% = 10/1000
    
    // 费用分配比例（进场的分配）
    uint256 public constant NODE_SHARE = 10; // 1% = 10/1000
    uint256 public constant LP_SHARE = 690; // 69%
    uint256 public constant BURN_SHARE = 300; // 30%
    uint256 public constant FEE_DENOMINATOR = 1000;

    // sell/buy slippage
    uint256 public buySlippage = 30; // 3% = 30/1000
    uint256 public sellSlippage = 30; // 3%  = 30/1000
    uint256 public slippageToS6S7 = 500; // 50% = 500/1000
    bool public buyEnabled;
    bool public sellEnabled;
    
    // sell assign
    uint256 public constant SELL_LP = 850; // 85% = 850/1000
    uint256 public constant SELL_BURN = 100; // 10%
    uint256 public constant SELL_NODE = 50; // 5%


    // 延迟分配
    bool public delaySwitch = false; 
    uint256 public delayAssignAmountInU = 0;
    uint256 public delayAssignAmountInETH = 0;

    // 节点
    uint256 public constant NODE_QUOTA = 300 * 10 ** 6;
    uint256 public rewardPerNode;       // 当前每个节点可领的奖励
    uint256 public totalActiveNode;     // 当前已激活的节点数量
    
    // 用户信息
    struct UserInfo {
        uint256 participationTime; // 参与时间
        uint256 investedAmount; // 投入的WETH数量
        uint256 investedValueInU; // 投入时的U价值（用于U本位结算）
        uint256 claimedValue; // 已领取的U本位价值
        uint256 lastClaimTime; // 上次领取时间
        uint256 directReferrals; // 直推人数
        uint256 teamTokenAmount; // 团队币量（不包含自己）
        uint8 level; // 等级 S0-S7

        uint256 nodeAmount;     // 上次同步时的节点数量
        uint256 nodeRewarded;   // 已计入的节点奖励
        uint256 pendingRewards; // 待领取的奖励
    }
    
    // 每日价格记录（ETIM/WETH）
    mapping(uint256 => uint256) public dailyPriceInWeth; // day => price (ETIM per WETH, 18 decimals)
    // 每日价格记录（ETIM/USD）
    mapping(uint256 => uint256) public dailyPriceInU; // day => price (ETIM per USD, 18 decimals)
    // WETH/USD 实时价格
    uint256 public wethPriceInUSD = 2000 * 10**6;   // 1 WETH = 2000 U
    // WETH/ETIM 实时价格
    uint256 public wethPriceInEtim = 2000 * 10**18; // 1 WETH = 2000 ETIM
    // ETIM/USD 价格记录
    uint256 public usdPriceInEtim = 1 * 10**18;
    // 最近更新时间
    uint256 public latestTimeWE = 0;
    uint256 public latestTimeWU = 0;

    // 转入的ETH数量限制
    uint256 public dailyDepositMax = 0;
    uint256 public dailyDepositRate = 200;     // 20% = 200 / 1000
    // ETH数量限制更新时间
    uint256 public dailyMaxDay = 0;
    // 当日转入ETH数量
    uint256 public dailyDepositAmount = 0;
    // 当日时间记录
    uint256 public dailyDepositDay = 0;

    // 增长池已释放数量
    uint256 public growthPoolReleased;

    // 买/卖手续费
    uint256 public totalEtimToS6S7;
    uint256 public totalEtimToOfficial;
    
    // 等级要求
    struct LevelCondition {
        uint256 minDirectReferrals;
        uint256 minPersonalTokens;
        uint256 minTeamTokens;
        uint256 accelerationRate; // 加速比例，百分比
    }
    
    mapping(address => UserInfo) public users;
    address[] public participants;
    mapping(uint8 => LevelCondition) public levelConditions;
    
    // 邀请关系状态
    mapping(address => mapping(address => uint256)) public transferRecords; // 记录转账 from -> to -> 转账时间戳
    mapping(address => mapping(address => uint256)) public referralsOf; // 邀请下级 referrer -> invitee -> 邀请关系确定时间
    mapping(address => address[]) public referralsOfList; // 邀请下级列表 referrer -> invitee[]
    mapping(address => address) public referrerOf; // 邀请上级 user -> referrer
    
    // 统计数据
    uint256 public totalUsers;
    uint256 public totalDeposited;

    // MODIFIERS
    modifier onlyPoolManagerContract () {
        require(msg.sender == address(etimPoolManager), "Only pool manager contract");
        _;
    }
    
    event Participated(address indexed user, uint256 amount);
    event ETIMClaimed(address indexed user, uint256 amount, uint256 uValue);
    event TokenSold(address indexed user, uint256 etimAmount, uint256 wethReceived);
    event ReferralAdded(address indexed inviter, address indexed invitee, uint256 timestamp);
    event LevelUpgraded(address indexed user, uint8 newLevel);
    event PriceUpdated(uint256 day, uint256 wePrice, uint256 wuPrice);
    
    constructor(
        address _etimToken,
        address _etimNode,
        address _etimPoolManager
    ) Ownable(msg.sender) {
        etimToken = IERC20(_etimToken);
        etimNode = IERC721(_etimNode);
        etimPoolManager = IETIMPoolManager(_etimPoolManager);

        _initializeLevels();
    }
    
    // 初始化会员条件
    function _initializeLevels() private {
        levelConditions[0] = LevelCondition(0, 0, 0, 3);
        levelConditions[1] = LevelCondition(5, 100000 * 10**18, 500000 * 10**18, 7);
        levelConditions[2] = LevelCondition(10, 500000 * 10**18, 3000000 * 10**18, 10);
        levelConditions[3] = LevelCondition(15, 1000000 * 10**18, 7000000  * 10**18, 12);
        levelConditions[4] = LevelCondition(20, 1500000 * 10**18, 16000000 * 10**18, 15);
        levelConditions[5] = LevelCondition(25, 2000000 * 10**18, 25000000 * 10**18, 18);
        levelConditions[6] = LevelCondition(30, 3000000 * 10**18, 50000000 * 10**18, 20);
        levelConditions[7] = LevelCondition(40, 3500000 * 10**18, 80000000 * 10**18, 22);
    }

    // 用户存入ETH进行参与
    function deposit() external payable nonReentrant {
        _processParticipation(msg.sender, msg.value);
    }

    // 参与逻辑函数
    function _processParticipation(address addr, uint256 amount) private {
        require(users[addr].directReferrals > 0, "No binding found");

        // 检查并重置当日eth deposit
        uint256 currentDay = block.timestamp / 1 days;
        if (dailyDepositDay != currentDay) {
            dailyDepositDay = currentDay;
            dailyDepositAmount = 0;
        }
        require(dailyDepositAmount <= dailyDepositMax * dailyDepositRate / 1000, "Daily deposit limit");

        // 更新价格
        refreshPriceWethInU();
        refreshPriceWethInEtim();

        // 计算投入价值（U本位）
        uint256 requiredMinEth = (participationAmountMin * 10 ** 18) / wethPriceInUSD;
        uint256 requiredMaxEth = (participationAmountMax * 10 ** 18) / wethPriceInUSD;
        require(amount >= requiredMinEth && amount <= requiredMaxEth, "Invalid transfer amount");
        
        // 投入等值的U数量
        uint256 participationAmount = amount * wethPriceInUSD / 10 ** 18;

        // 开启了延迟注入则记录数据即可
        if(delaySwitch) {
            delayAssignAmountInU = delayAssignAmountInU + participationAmount;
            delayAssignAmountInETH = delayAssignAmountInETH + amount;
        } else {
            // 分配资金
            uint256 nodeAmount = (amount * NODE_SHARE) / FEE_DENOMINATOR;
            uint256 lpAmount = (amount * LP_SHARE) / FEE_DENOMINATOR;
            uint256 burnAmount = (amount * BURN_SHARE) / FEE_DENOMINATOR;
            
            // 69% 加入LP
            if (lpAmount > 0) {
                uint256 halfEth = lpAmount / 2;
                etimPoolManager.swapAndAddLiquidity{value: lpAmount}(halfEth);
            }
            // 30% 置换ETIM并销毁
            if (burnAmount > 0) {
                etimPoolManager.swapAndBurn(burnAmount);
            }
            // 1% 给节点（置换成etim转入本合约）
            if (nodeAmount > 0) {
                uint256 nodeEtimAmount = etimPoolManager.swapEthToEtim{value: nodeAmount}(nodeAmount);
                _distributePerformance(nodeEtimAmount);
            }
        }
        
        // 记录用户信息
        users[addr].participationTime = block.timestamp;
        users[addr].investedAmount = amount;                // eth 数量
        users[addr].investedValueInU = participationAmount; // U 价值（用于U本位结算）
        users[addr].claimedValue = 0;                       // 已领取的U价值
        users[addr].lastClaimTime = block.timestamp;
        // 团队信息由邀请部分确定
        // users[addr].directReferrals
        // users[addr].teamTokenAmount
        // users[addr].level
        
        participants.push(addr);
        totalUsers++;
        totalDeposited += amount;

        // 记录当前转入
        dailyDepositAmount += amount;
        
        emit Participated(addr, amount);
    }
    
    // 计算当前可领取的挖矿收益
    function getClaimableAmount() external view returns (uint256) {
        (uint256 etimAmount, ) = _calculatePendingRewards(msg.sender);
        return etimAmount;
    }
    
    // 领取挖矿收益
    function claim() external nonReentrant {
        UserInfo storage user = users[msg.sender];
        require(user.participationTime > 0, "Not participated");
        
        uint256 remainingValueInU = user.investedValueInU - user.claimedValue;
        require(remainingValueInU > 0, "No remaining value");
        
        // 计算可领取奖励（ETIM数量）
        (uint256 pending, uint256 equalU) = _calculatePendingRewards(msg.sender);
        require(pending > 0, "No rewards to claim");
        
        // 更新用户状态
        user.claimedValue += equalU;
        user.lastClaimTime = block.timestamp;
        
        // 从增长池释放代币
        releaseFromGrowthPool(address(this), pending);
        
        // 团队代币更新
        //
        // 更新用户等级
        _checkAndUpdateLevel(msg.sender);
        
        emit ETIMClaimed(msg.sender, pending, equalU);
    }

    // 某一天U能兑换出ETIM的数量
    function _getDayU2ETIM(uint256 timestamp, uint256 valueInU) private view returns (uint256) {
        uint256 theDay = timestamp / 1 days;
        uint256 currentEtimPriceInU = dailyPriceInU[theDay];
        if (currentEtimPriceInU == 0) {
            currentEtimPriceInU = usdPriceInEtim;
        }
        if (currentEtimPriceInU == 0) return 0;
        // valueInU → ETIM数量
        uint256 etimAmount = valueInU * currentEtimPriceInU / 10**6;

        return etimAmount;
    }

    // 计算待领取奖励（按天来聚合处理）
    function _calculatePendingRewards(address userAddr) private view returns (uint256, uint256) {
        UserInfo storage user = users[userAddr];
        
        if (user.participationTime == 0) return (0, 0);
        
        // 使用U本位计算剩余价值
        uint256 totalQuotaInU = user.investedValueInU + _calcNodeQuotaBonusInU(userAddr);
        uint256 initRemainingValueInU = totalQuotaInU - user.claimedValue;
        uint256 remainingValueInU = initRemainingValueInU;
        if (remainingValueInU <= 0) return (0, 0);

        // 按照当日整点处理（UTC-0）
        uint256 startTime = user.lastClaimTime / 1 days * 1 days;
        uint256 endTime = block.timestamp / 1 days * 1 days;

        // 个人产出计算按天来聚合处理（团队加速调整为个人的加速）
        uint256 accelerationRate = levelConditions[user.level].accelerationRate;
        uint256 rewardValueInEtim = 0;
        for(uint256 t = startTime; t < endTime; t += 1 days) {
            uint256 dailyValueInU = (user.investedValueInU * dailyReleaseRate) / 1000;
            dailyValueInU += (dailyValueInU * accelerationRate) / 100;

            dailyValueInU = dailyValueInU > remainingValueInU ? remainingValueInU : dailyValueInU;

            // 与U等值的ETIM数量
            uint256 dailyValueInEtim = _getDayU2ETIM(t, dailyValueInU);

            rewardValueInEtim += dailyValueInEtim;
            remainingValueInU -= dailyValueInU;

            if (remainingValueInU <= 0) break;
        }

        /*
        // 团队产出按天来聚合处理（直推下级）
        uint256 accelerationRate = 0;
        if (user.level > 0) {
            accelerationRate = levelConditions[user.level].accelerationRate;
        }
        if (accelerationRate > 0 && remainingValueInU > 0) {
            address[] memory directInvitees = referralsOfList[userAddr];
            for (uint256 i = 0; i < directInvitees.length; i++) {
                address member = directInvitees[i];
                UserInfo storage memberInfo = users[member];
                if (memberInfo.participationTime == 0) continue;

                // 计算每个直推下级在这段时间的产出（U价值）
                uint256 memberRemainingValueInU = memberInfo.investedValueInU - memberInfo.claimedValue;
                for(uint256 t = startTime; t < endTime; t += 1 days) {
                    if(memberInfo.participationTime > t) continue;

                    uint256 memberDailyValueInU = (memberInfo.investedValueInU * dailyReleaseRate) / 1000;
                    memberDailyValueInU = memberDailyValueInU > memberRemainingValueInU ? memberRemainingValueInU : memberDailyValueInU;

                    // 产出U给直推人的部分
                    uint256 accelerationValueInU = (memberDailyValueInU * accelerationRate) / 100;
                    accelerationValueInU = accelerationValueInU > remainingValueInU ? remainingValueInU : accelerationValueInU;

                    // 与U等值的ETIM数量
                    uint256 accelerationValueInEtim = _getDayU2ETIM(t, accelerationValueInU);

                    rewardValueInEtim += accelerationValueInEtim;

                    remainingValueInU -= accelerationValueInU;
                    memberRemainingValueInU -= memberDailyValueInU;

                    if (remainingValueInU <= 0 || memberRemainingValueInU <= 0) break;
                }
                if (remainingValueInU <= 0) break;
            }
        }
        */
        return (rewardValueInEtim, remainingValueInU >= 0 ? initRemainingValueInU - remainingValueInU : initRemainingValueInU);
    }
    
    // refresh
    function refreshPriceWethInEtim() private {
        if (latestTimeWE + 5 < block.timestamp) {
            uint256 price = etimPoolManager.getPriceEtimPerEth();
            if(price > 0) {
                wethPriceInEtim = price;
                latestTimeWE = block.timestamp;
            }
        }
    }

    // refresh
    function refreshPriceWethInU() private {
        if (latestTimeWU + 5 < block.timestamp) {
            uint256 price = etimPoolManager.getPriceUsdcPerEth();
            if(price > 0) {
                wethPriceInUSD = price;
                latestTimeWU = block.timestamp;
            }
        }
    }
    
    
    // etim transfer callback (trigger by etim token)
    function procTokenTransfer(
        address from,
        address to,
        uint256 value
    ) external nonReentrant {
        if(msg.sender != address(etimToken)) return;
        
        // 邀请关系
        _procInvitation(from, to, value);
        // 更新团队持币量
        _updateTeamTokenAmount(from, to, value);
        // 更新等级
        _checkAndUpdateLevel(from);
        _checkAndUpdateLevel(to);
    }
    
    // 处理邀请关系
    function _procInvitation(address from, address to, uint256 value) private {
        if (
            !_isContract(from) &&
            !_isContract(to) &&
            from != address(0) &&
            to != address(0) &&
            from != to &&
            value > 0
        ) {
            uint256 referralTime = referralsOf[from][to];
            uint256 reverseReferralTime = referralsOf[to][from];
            
            if (referralTime > 0 || reverseReferralTime > 0) {
                // 清理存储状态
                if (transferRecords[from][to] > 0) delete transferRecords[from][to];
                if (transferRecords[to][from] > 0) delete transferRecords[to][from];
                return;
            }
            
            uint256 transferTime = transferRecords[from][to];
            uint256 reverseTransferTime = transferRecords[to][from];
            
            if (transferTime == 0) {
                transferTime = block.timestamp;
                transferRecords[from][to] = transferTime;
            }
            
            if (transferTime > 0 && reverseTransferTime > 0) {
                // 按照先后顺序处理
                address inviter = from;
                address invitee = to;
                if (transferTime >= reverseTransferTime) {
                    inviter = to;
                    invitee = from;
                }
                
                referralsOf[inviter][invitee] = block.timestamp;
                referralsOfList[inviter].push(invitee);
                referrerOf[invitee] = inviter;

                uint256 inviteeBalance = etimToken.balanceOf(invitee);
                uint256 oldInviteeBalance = invitee == from ? inviteeBalance + value : inviteeBalance - value;
                if (oldInviteeBalance < 0) oldInviteeBalance = 0;

                users[inviter].directReferrals++;
                users[inviter].teamTokenAmount += oldInviteeBalance;
                
                emit ReferralAdded(inviter, invitee, block.timestamp);
                
                // 清理存储状态
                if (transferRecords[inviter][invitee] > 0) delete transferRecords[inviter][invitee];
                if (transferRecords[invitee][inviter] > 0) delete transferRecords[invitee][inviter];
            }
        }
    }
    
    // 更新用户等级
    function _checkAndUpdateLevel(address user) private {
        if(user == address(0) || _isContract(user)) return;

        UserInfo storage userInfo = users[user];

        uint256 personalTokens = etimToken.balanceOf(user);
        uint256 directReferrals = userInfo.directReferrals;
        uint256 teamTokens = userInfo.teamTokenAmount;
        
        uint8 newLevel = 0;
        for (uint8 level = 7; level >= 1; level--) {
            LevelCondition memory condition = levelConditions[level];
            
            if (
                directReferrals >= condition.minDirectReferrals &&
                personalTokens >= condition.minPersonalTokens &&
                teamTokens >= condition.minTeamTokens
            ) {
                newLevel = level;
                break;
            }
        }
        
        if (userInfo.level != newLevel) {
            userInfo.level = newLevel;
            emit LevelUpgraded(user, newLevel);

            // 如果是节点用户则主动激活节点
            // TODO
        }
    }
    
    // 更新团队持币量
    function _updateTeamTokenAmount(address from, address to, uint256 amount) private {
        // 更新发送方上级团队持币量
        if (from != address(0) && !_isContract(from)) {
            uint256 fromNewBalance = etimToken.balanceOf(from);
            uint256 fromOldBalance = fromNewBalance + amount;
            
            if (fromOldBalance != fromNewBalance) {
                _propagateTeamTokenChange(from, int256(fromNewBalance) - int256(fromOldBalance));
            }
        }
        
        if (to != address(0) && !_isContract(from) && to != BURN_ADDRESS) {
            // 更新接收方上级团队持币量
            uint256 toNewBalance = etimToken.balanceOf(to);
            uint256 toOldBalance = toNewBalance - amount;
            
            if (toOldBalance != toNewBalance) {
                _propagateTeamTokenChange(to, int256(toNewBalance) - int256(toOldBalance));
            }
        }
    }
    
    // 传播团队持币量变化
    function _propagateTeamTokenChange(address user, int256 change) private {
        if (change == 0) return;
        
        address referrer = referrerOf[user];
        if (referrer != address(0)) {
            if (change > 0) {
                users[referrer].teamTokenAmount += uint256(change);
            } else {
                uint256 absChange = uint256(-change);
                if (users[referrer].teamTokenAmount >= absChange) {
                    users[referrer].teamTokenAmount -= absChange;
                } else {
                    users[referrer].teamTokenAmount = 0;
                }
            }
        }
    }
    
    // 检查是否合约
    function _isContract(address addr) private view returns (bool) {
        return addr.code.length > 0;
    }

    // 查询函数
    function getUserLevel(address user) external view returns (uint8) {
        return users[user].level;
    }
    
    // 调整参数（U数量）
    function setParticipationAmount(uint256 min, uint256 max) external onlyOwner {
        require(min > 0 && min <= max, "Params invalid");
        participationAmountMin = min;
        participationAmountMax = max;
    }
    
    // 每日产出比例
    function setDailyReleaseRate(uint256 rate) external onlyOwner {
        dailyReleaseRate = rate;
    }

    // 每日存入限制比例
    function setDailyDepositRate(uint256 rate) external onlyOwner {
        dailyDepositRate = rate;
    }
    
    // 滑点
    function setSlippage(uint256 buy, uint256 sell) external onlyOwner {
        buySlippage = buy;
        sellSlippage = sell;
    }

    // 更新每日价格（定时更新）
    function updateDailyPrice() external onlyOwner {
        uint256 currentDay = block.timestamp / 1 days;

        // etim per eth
        uint256 priceWethPriceInEtim = etimPoolManager.getPriceEtimPerEth();
        require(priceWethPriceInEtim > 0, "Price for Etim per Eth error");
        if(priceWethPriceInEtim > 0) {
            wethPriceInEtim = priceWethPriceInEtim;
            latestTimeWE = block.timestamp;
        }
        // usdc per eth
        uint256 priceWethPriceInUSD = etimPoolManager.getPriceUsdcPerEth();
        require(priceWethPriceInUSD > 0, "Price for Etim per Eth error");
        if(priceWethPriceInUSD > 0) {
            wethPriceInUSD = priceWethPriceInUSD;
            latestTimeWU = block.timestamp;
        }
        // pair中获取eth余量
        uint256 ethReserves = etimPoolManager.getEthReserves();
        if(currentDay != dailyMaxDay) {
            dailyDepositMax = ethReserves;
        }

        // usdc 6位
        usdPriceInEtim = (priceWethPriceInEtim * 10**6 ) / priceWethPriceInUSD;
        dailyPriceInU[currentDay] = usdPriceInEtim;

        emit PriceUpdated(currentDay, priceWethPriceInEtim, priceWethPriceInUSD);
    }

    // 延迟注入开关
    function setDelaySwitch(bool s) external onlyOwner {
        delaySwitch = s;
    }

    // 触发延迟分配（U本位）
    function TriggerDelayAssign(uint256 valueInU) external onlyOwner {
        require(valueInU <= delayAssignAmountInU, "Invalid value");
        
        // 更新价格
        refreshPriceWethInU();
        refreshPriceWethInEtim();

        // 转等值的WETH
        uint256 requiredWETH = (valueInU * 10 ** 18) / wethPriceInUSD;

        // 分配资金(按照WETH来)
        uint256 nodeAmount = (requiredWETH * NODE_SHARE) / FEE_DENOMINATOR;
        uint256 lpAmount = (requiredWETH * LP_SHARE) / FEE_DENOMINATOR;
        uint256 burnAmount = (requiredWETH * BURN_SHARE) / FEE_DENOMINATOR;

        // 69% 加入LP
        if (lpAmount > 0) {
            uint256 halfEth = lpAmount / 2;
            etimPoolManager.swapAndAddLiquidity{value: lpAmount}(halfEth);
        }
        // 30% 置换ETIM并销毁
        if (burnAmount > 0) {
            etimPoolManager.swapAndBurn(burnAmount);
        }
        // 1% 给节点（置换成etim转入本合约）
        if (nodeAmount > 0) {
            uint256 nodeEtimAmount = etimPoolManager.swapEthToEtim{value: nodeAmount}(nodeAmount);
            _distributePerformance(nodeEtimAmount);
        }

        delayAssignAmountInU -= valueInU;
    }

    // 原生代币转入合约触发
    receive() external payable nonReentrant {
        if (!_isContract(msg.sender)) {
            _processParticipation(msg.sender, msg.value);
        }
    }

    // fallback() external payable {
    //     revert("This contract only accepts pure ETH transfers.");
    // }

    /* ========== NODE ========== */

    // node quota bonus 
    function _calcNodeQuotaBonusInU(address user) private view returns (uint256) {
        uint256 amount = etimNode.balanceOf(user);
        return NODE_QUOTA * amount;
    }

    //
    function _distributePerformance(uint256 etimAmount) internal {
        if (totalActiveNode > 0) {
            rewardPerNode += etimAmount / totalActiveNode;
        }
    }

    // sync user nodes and settle rewards
    function _syncUserNodes(address user) internal {
        UserInfo storage userInfo = users[user];

        // check condition for update
        if (userInfo.participationTime == 0) {
            return;
        }

        uint256 oldNodeAmount = userInfo.nodeAmount;
        uint256 newNodeAmount = userInfo.level >= 1 ? etimNode.balanceOf(user) : 0;

        if (oldNodeAmount == newNodeAmount) {
            // settle
            uint256 accumulateOld = rewardPerNode * oldNodeAmount;
            uint256 pendingOld = accumulateOld > userInfo.nodeRewarded ? accumulateOld - userInfo.nodeRewarded : 0;

            userInfo.pendingRewards += pendingOld;
            userInfo.nodeRewarded = accumulateOld;
            return;
        }

        if (oldNodeAmount > 0) {
            // settle
            uint256 accumulateOld = rewardPerNode * oldNodeAmount;
            uint256 pendingOld = accumulateOld > userInfo.nodeRewarded ? accumulateOld - userInfo.nodeRewarded : 0;

            userInfo.pendingRewards += pendingOld;
            userInfo.nodeRewarded = accumulateOld;
        }

        // update active node amount
        if (oldNodeAmount > 0) totalActiveNode -= oldNodeAmount;
        if (newNodeAmount > 0) totalActiveNode += newNodeAmount;

        // reset
        userInfo.nodeAmount = newNodeAmount;
        userInfo.nodeRewarded = rewardPerNode * newNodeAmount;
    }

    // user need real-time sync node nft
    function syncNode() external {
        _syncUserNodes(msg.sender);
    }

    // claim node rewards
    function claimNodeReward() external nonReentrant {
        address user = msg.sender;
        _syncUserNodes(user);

        UserInfo storage userInfo = users[user];
        uint256 amount = userInfo.pendingRewards;

        // require(userInfo.nodeAmount > 0, "No nodes");
        require(amount > 0, "No rewards to claim");

        userInfo.pendingRewards = 0;

        etimToken.transfer(user, amount);
    }

    /* ========== TOKEN ========== */

    // release from growth pool
    function releaseFromGrowthPool(address to, uint256 amount) internal {
        require(growthPoolReleased + amount <= GROWTH_POOL, "Exceeds growth pool");
        
        growthPoolReleased += amount;
        etimToken.transfer(to, amount);
    }

    // growth pool remain etim amount
    function remainingGrowthPool() external view returns (uint256) {
        return GROWTH_POOL - growthPoolReleased;
    }

    // growth pool all released
    function isGrowthPoolDepleted() public view returns (bool) {
        return growthPoolReleased >= GROWTH_POOL;
    }

    /* ========== BUY/SELL ========== */
    // 买入ETIM
    function buyETIM() external payable returns (uint256 etimReceived) {
        require(buyEnabled, "Buy not enable");
        require(msg.value > 0, "Must send ETH");

        uint256 ethAmount = msg.value;
        uint256 slippageFee = ethAmount * buySlippage / FEE_DENOMINATOR;    // TO s6、s7

        ethAmount = ethAmount - slippageFee;
        etimReceived = etimPoolManager.swapEthToEtim{value: ethAmount}(ethAmount);

        etimToken.transfer(msg.sender, etimReceived);
    }

    // 卖出ETIM
    function sellETIM(uint256 etimAmount) external returns (uint256 ethReceived){
        require(etimAmount > 0, "Invalid amount");
        require(etimToken.balanceOf(msg.sender) >= etimAmount, "Insufficient balance");
        
        // 转账（需要用户先授权）
        etimToken.transferFrom(msg.sender, address(this), etimAmount);

        // uint256 slippageFee = etimAmount * sellSlippage / FEE_DENOMINATOR;

        // 计算分配
        uint256 lpAmount = (etimAmount * SELL_LP) / FEE_DENOMINATOR;
        uint256 burnAmount = (etimAmount * SELL_BURN) / FEE_DENOMINATOR;
        uint256 nodeAmount = (etimAmount * SELL_NODE) / FEE_DENOMINATOR;
        
        // 85% 去LP
        if (lpAmount > 0) {
            ethReceived = etimPoolManager.swapEtimToEth(lpAmount, msg.sender);
        }
        
        // 10% 销毁
        if (burnAmount > 0) {
            etimToken.transfer(BURN_ADDRESS, burnAmount);
        }
        
        // 5% 参与节点业绩分配
        if (nodeAmount > 0) {
            _distributePerformance(nodeAmount);
        }
    }
}