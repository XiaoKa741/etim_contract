// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

interface IETIMPoolHelper {
    function getEthReserves() external view returns (uint256);
    function getEtimPerEth() external view returns (uint256);
    function getUsdcPerEth() external view returns (uint256);
    // function addLiquidity(uint256 ethAmount, uint256 etimAmount) external payable;
    function swapEthToEtim(uint256 ethAmount) external payable returns (uint256);
    function swapEtimToEth(uint256 etimAmount, address to) external returns (uint256);
    function swapAndAddLiquidity(uint256 ethAmount) external payable;
    function swapAndBurn(uint256 ethAmount) external payable;
}

contract ETIMMain is Ownable, ReentrancyGuard {

    // =========================================================
    //                        ERRORS
    // =========================================================

    error OnlyPoolManager();
    error AlreadyParticipated();
    error NoReferralBinding();
    error DailyDepositLimitExceeded();
    error InvalidDepositAmount();
    error NotParticipated();
    error NoRemainingValue();
    error NoRewardsToClaim();
    error InvalidParams();
    error InvalidPrice();
    error InvalidDelayAmount();
    error GrowthPoolExceeded();
    error BuyNotEnabled();
    error MustSendETH();
    error InvalidSellAmount();
    error InsufficientBalance();

    IERC20 public etimToken;
    IERC721 public etimNode;
    IETIMPoolHelper public etimPoolHelper;

    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // Total ETIM allocated to growth pool
    uint256 public constant GROWTH_POOL_SUPPLY = 1_925_700_000 * 10 ** 18;

    // Base participation params
    uint256 public participationAmountMin = 100 * 10**6; // 100 USD (6 decimals)
    uint256 public participationAmountMax = 150 * 10**6; // 150 USD (6 decimals)
    uint256 public dailyReleaseRate = 10; // 1% = 10/1000

    // Deposit fee distribution ratios (denominator = 1000)
    uint256 public constant NODE_SHARE = 10;  // 1%
    uint256 public constant LP_SHARE = 690;   // 69%
    uint256 public constant BURN_SHARE = 300; // 30%
    uint256 public constant FEE_DENOMINATOR = 1000;

    // Buy/sell
    bool public buyEnabled;
    bool public sellEnabled;

    // Sell fee distribution ratios
    uint256 public constant SELL_LP_RATIO   = 850; // 85%
    uint256 public constant SELL_BURN_RATIO = 100; // 10%
    uint256 public constant SELL_NODE_RATIO = 50;  // 5%

    // Delayed allocation
    bool public delayEnabled = false;
    uint256 public pendingAllocationInUsd = 0;
    uint256 public pendingAllocationInEth = 0;

    // Node reward tracking
    uint256 public constant NODE_QUOTA = 300 * 10 ** 6;
    uint256 public rewardPerNode;
    uint256 public totalActiveNodes;

    // User info
    struct UserInfo {
        uint256 participationTime;
        uint256 investedEthAmount;      // ETH deposited
        uint256 investedValueInUsd;     // USD-equivalent at deposit time (6 decimals)
        uint256 claimedValueInUsd;      // Total USD value already claimed
        uint256 lastClaimTime;
        uint256 directReferralCount;
        uint256 teamTokenBalance;       // Team total ETIM (excluding self)
        uint8 level;

        uint256 syncedNodeCount;        // Node count at last sync
        uint256 nodeRewardDebt;         // Accumulated reward debt for node accounting
        uint256 pendingNodeRewards;     // Settled but unclaimed node rewards
    }

    // Price storage
    mapping(uint256 => uint256) public dailyEthEtimPrice; // day => ETIM per ETH (18 decimals)
    mapping(uint256 => uint256) public dailyUsdEtimPrice;  // day => ETIM per USD (18 decimals)

    uint256 public ethPriceInUsd  = 2000 * 10**6;   // 1 ETH = 2000 USD (6 decimals)
    uint256 public ethPriceInEtim = 2000 * 10**18;  // 1 ETH = 2000 ETIM (18 decimals)
    uint256 public etimPerUsd     = 1 * 10**18;     // 1 USD = 1 ETIM (18 decimals)

    uint256 public lastEthEtimPriceTime = 0;
    uint256 public lastEthUsdPriceTime  = 0;

    // Daily deposit limit
    uint256 public dailyDepositCap    = 0;
    uint256 public dailyDepositRate   = 200; // 20% = 200/1000
    uint256 public dailyCapUpdatedDay = 0;
    uint256 public dailyDepositTotal  = 0;
    uint256 public dailyDepositDay    = 0;

    // Growth pool
    uint256 public growthPoolReleased;

    // Level upgrade conditions
    struct LevelCondition {
        uint256 minDirectReferrals;
        uint256 minPersonalTokens;
        uint256 minTeamTokens;
        uint256 accelerationRate;
    }

    mapping(address => UserInfo) public users;
    address[] public participants;
    mapping(uint8 => LevelCondition) public levelConditions;

    // Referral relationships
    mapping(address => mapping(address => uint256)) public transferRecords;  // from -> to -> timestamp
    mapping(address => mapping(address => uint256)) public referralsOf;      // referrer -> invitee -> confirm timestamp
    mapping(address => address[]) public referralsOfList;                    // referrer -> invitee[]
    mapping(address => address) public referrerOf;                           // user -> referrer

    // Global stats
    uint256 public totalUsers;
    uint256 public totalDeposited;

    // MODIFIERS
    modifier onlyPoolManagerContract() {
        if (msg.sender != address(etimPoolHelper)) revert OnlyPoolManager();
        _;
    }

    event Participated(address indexed user, uint256 ethAmount);
    event ETIMClaimed(address indexed user, uint256 etimAmount, uint256 usdValue);
    event TokenSold(address indexed user, uint256 etimAmount, uint256 ethReceived);
    event ReferralAdded(address indexed referrer, address indexed invitee, uint256 timestamp);
    event LevelUpgraded(address indexed user, uint8 newLevel);
    event DailyPriceUpdated(uint256 day, uint256 ethEtimPrice, uint256 ethUsdPrice);

    constructor(
        address _etimToken,
        address _etimNode,
        address _etimPoolHelper
    ) Ownable(msg.sender) {
        etimToken = IERC20(_etimToken);
        etimNode = IERC721(_etimNode);
        etimPoolHelper = IETIMPoolHelper(_etimPoolHelper);

        _initializeLevelConditions();
    }

    // Initialize membership level conditions
    function _initializeLevelConditions() private {
        levelConditions[0] = LevelCondition(0,  0,                 0,                 3);
        levelConditions[1] = LevelCondition(1,  0,                 0 ,                7);
        // levelConditions[1] = LevelCondition(5,  100000  * 10**18,  500000  * 10**18,  7);
        levelConditions[2] = LevelCondition(10, 500000  * 10**18,  3000000 * 10**18, 10);
        levelConditions[3] = LevelCondition(15, 1000000 * 10**18,  7000000 * 10**18, 12);
        levelConditions[4] = LevelCondition(20, 1500000 * 10**18, 16000000 * 10**18, 15);
        levelConditions[5] = LevelCondition(25, 2000000 * 10**18, 25000000 * 10**18, 18);
        levelConditions[6] = LevelCondition(30, 3000000 * 10**18, 50000000 * 10**18, 20);
        levelConditions[7] = LevelCondition(40, 3500000 * 10**18, 80000000 * 10**18, 22);
    }

    // User deposits ETH to participate
    function deposit() external payable nonReentrant {
        _processParticipation(msg.sender, msg.value);
    }

    // Participation logic
    function _processParticipation(address addr, uint256 ethAmount) private {
        if (users[addr].participationTime != 0) revert AlreadyParticipated();
        if (users[addr].directReferralCount == 0) revert NoReferralBinding();

        // Check and reset daily ETH deposit limit
        uint256 currentDay = block.timestamp / 1 days;
        if (dailyDepositDay != currentDay) {
            dailyDepositDay = currentDay;
            dailyDepositTotal = 0;
        }
        if (dailyDepositTotal > dailyDepositCap * dailyDepositRate / FEE_DENOMINATOR) revert DailyDepositLimitExceeded();

        // Update prices
        _updateEthUsdPrice();
        _updateEthEtimPrice();

        // Validate deposit amount in USD terms
        uint256 requiredMinEth = (participationAmountMin * 10 ** 18) / ethPriceInUsd;
        uint256 requiredMaxEth = (participationAmountMax * 10 ** 18) / ethPriceInUsd;
        if (ethAmount < requiredMinEth || ethAmount > requiredMaxEth) revert InvalidDepositAmount();

        // USD-equivalent participation amount
        uint256 participationValueInUsd = ethAmount * ethPriceInUsd / 10 ** 18;

        if (delayEnabled) {
            // Delay mode: accumulate for later allocation
            pendingAllocationInUsd += participationValueInUsd;
            pendingAllocationInEth += ethAmount;
        } else {
            _allocateDepositFunds(ethAmount);
        }

        // Record user info
        users[addr].participationTime    = block.timestamp;
        users[addr].investedEthAmount    = ethAmount;
        users[addr].investedValueInUsd   = participationValueInUsd;
        users[addr].claimedValueInUsd    = 0;
        users[addr].lastClaimTime        = block.timestamp;

        participants.push(addr);
        totalUsers++;
        totalDeposited   += ethAmount;
        dailyDepositTotal += ethAmount;

        emit Participated(addr, ethAmount);
    }

    // Allocate ETH according to fee split: 69% LP / 30% burn / 1% nodes
    function _allocateDepositFunds(uint256 ethAmount) private {
        uint256 nodeEth = (ethAmount * NODE_SHARE) / FEE_DENOMINATOR;
        uint256 lpEth   = (ethAmount * LP_SHARE)   / FEE_DENOMINATOR;
        uint256 burnEth = (ethAmount * BURN_SHARE)  / FEE_DENOMINATOR;

        if (lpEth > 0) {
            uint256 halfEth = lpEth / 2;
            etimPoolHelper.swapAndAddLiquidity{value: lpEth}(halfEth);
        }
        if (burnEth > 0) {
            etimPoolHelper.swapAndBurn{value: burnEth}(burnEth);
        }
        if (nodeEth > 0) {
            uint256 nodeEtimAmount = etimPoolHelper.swapEthToEtim{value: nodeEth}(nodeEth);
            _distributeNodeRewards(nodeEtimAmount);
        }
    }

    // Calculate claimable mining rewards (view)
    function getClaimableAmount() external view returns (uint256) {
        (uint256 etimAmount, ) = _calculatePendingRewards(msg.sender);
        return etimAmount;
    }

    // Claim mining rewards
    function claim() external nonReentrant {
        UserInfo storage user = users[msg.sender];
        if (user.participationTime == 0) revert NotParticipated();

        uint256 remainingValueInUsd = user.investedValueInUsd - user.claimedValueInUsd;
        if (remainingValueInUsd == 0) revert NoRemainingValue();

        _checkAndUpdateLevel(msg.sender);
        
        (uint256 pendingEtim, uint256 claimableUsd) = _calculatePendingRewards(msg.sender);
        if (pendingEtim == 0) revert NoRewardsToClaim();

        // Update user state
        user.claimedValueInUsd += claimableUsd;
        user.lastClaimTime = block.timestamp;

        // Check and send rewards
        uint256 growthPoolRemain = GROWTH_POOL_SUPPLY - growthPoolReleased;
        pendingEtim = pendingEtim > growthPoolRemain ? growthPoolRemain : pendingEtim;
        _releaseFromGrowthPool(msg.sender, pendingEtim);

        _checkAndUpdateLevel(msg.sender);

        emit ETIMClaimed(msg.sender, pendingEtim, claimableUsd);
    }

    // Convert USD value to ETIM using the price recorded on a given day
    function _convertUsdToEtim(uint256 timestamp, uint256 valueInUsd) private view returns (uint256) {
        uint256 day = timestamp / 1 days;
        uint256 price = dailyUsdEtimPrice[day];
        if (price == 0) price = etimPerUsd;
        if (price == 0) return 0;
        return valueInUsd * price / 10**6;
    }

    // Calculate pending rewards aggregated by day
    function _calculatePendingRewards(address userAddr) private view returns (uint256 etimAmount, uint256 usdClaimed) {
        UserInfo storage user = users[userAddr];

        if (user.participationTime == 0) return (0, 0);
        if (isGrowthPoolDepleted()) return (0, 0);

        uint256 totalQuotaInUsd    = user.investedValueInUsd + _calcNodeQuotaBonusInUsd(userAddr);
        uint256 remainingValueInUsd = totalQuotaInUsd - user.claimedValueInUsd;
        if (remainingValueInUsd == 0) return (0, 0);

        uint256 startDay = user.lastClaimTime / 1 days * 1 days;
        uint256 endDay   = block.timestamp    / 1 days * 1 days;

        uint256 accelerationRate = levelConditions[user.level].accelerationRate;
        uint256 rewardInEtim     = 0;
        uint256 initialRemaining = remainingValueInUsd;

        for (uint256 t = startDay; t < endDay; t += 1 days) {
            uint256 dailyUsd = (user.investedValueInUsd * dailyReleaseRate) / 1000;
            dailyUsd += (dailyUsd * accelerationRate) / 100;
            if (dailyUsd > remainingValueInUsd) dailyUsd = remainingValueInUsd;

            rewardInEtim        += _convertUsdToEtim(t, dailyUsd);
            remainingValueInUsd -= dailyUsd;

            if (remainingValueInUsd == 0) break;
        }

        usdClaimed = initialRemaining - remainingValueInUsd;
        return (rewardInEtim, usdClaimed);
    }

    // Update cached ETH/ETIM price (throttled to once per 5 seconds)
    function _updateEthEtimPrice() private {
        if (lastEthEtimPriceTime + 5 < block.timestamp) {
            uint256 price = etimPoolHelper.getEtimPerEth();
            if (price > 0) {
                ethPriceInEtim      = price;
                lastEthEtimPriceTime = block.timestamp;
            }
        }
    }

    // Update cached ETH/USD price (throttled to once per 5 seconds)
    function _updateEthUsdPrice() private {
        if (lastEthUsdPriceTime + 5 < block.timestamp) {
            uint256 price = etimPoolHelper.getUsdcPerEth();
            if (price > 0) {
                ethPriceInUsd      = price;
                lastEthUsdPriceTime = block.timestamp;
            }
        }
    }

    // ETIM token transfer callback (called by ETIM token contract)
    function onTokenTransfer(
        address from,
        address to,
        uint256 value
    ) external nonReentrant {
        if (msg.sender != address(etimToken)) return;

        _processReferralBinding(from, to, value);
        _updateTeamTokenBalance(from, to, value);
        _checkAndUpdateLevel(from);
        _checkAndUpdateLevel(to);
    }

    // Determine and record referral relationship from bilateral transfers
    function _processReferralBinding(address from, address to, uint256 value) private {
        if (
            !_isContract(from) &&
            !_isContract(to)   &&
            from != address(0) &&
            to   != address(0) &&
            from != to         &&
            value > 0
        ) {
            // If referral relationship already exists, clean up pending records
            if (referralsOf[from][to] > 0 || referralsOf[to][from] > 0) {
                if (transferRecords[from][to] > 0) delete transferRecords[from][to];
                if (transferRecords[to][from] > 0) delete transferRecords[to][from];
                return;
            }

            uint256 forwardTime = transferRecords[from][to];
            uint256 reverseTime = transferRecords[to][from];

            if (forwardTime == 0) {
                transferRecords[from][to] = block.timestamp;
                forwardTime = block.timestamp;
            }

            // Both directions exist — establish referral: earlier sender is the referrer
            if (forwardTime > 0 && reverseTime > 0) {
                address referrer = (forwardTime < reverseTime) ? from : to;
                address invitee  = (forwardTime < reverseTime) ? to   : from;

                referralsOf[referrer][invitee] = block.timestamp;
                referralsOfList[referrer].push(invitee);
                referrerOf[invitee] = referrer;

                // Approximate invitee's pre-transfer balance for team accounting
                uint256 inviteeCurrentBalance = etimToken.balanceOf(invitee);
                uint256 inviteePreBalance     = (invitee == from)
                    ? inviteeCurrentBalance + value
                    : (inviteeCurrentBalance >= value ? inviteeCurrentBalance - value : 0);

                users[referrer].directReferralCount++;
                users[referrer].teamTokenBalance += inviteePreBalance;

                emit ReferralAdded(referrer, invitee, block.timestamp);

                // Clean up transfer records
                if (transferRecords[referrer][invitee] > 0) delete transferRecords[referrer][invitee];
                if (transferRecords[invitee][referrer] > 0) delete transferRecords[invitee][referrer];
            }
        }
    }

    // Update user level based on current stats
    function _checkAndUpdateLevel(address user) private {
        if (user == address(0) || _isContract(user)) return;

        UserInfo storage userInfo = users[user];
        if (userInfo.participationTime == 0) return;

        uint256 personalTokens  = etimToken.balanceOf(user);
        uint256 directReferrals = userInfo.directReferralCount;
        uint256 teamTokens      = userInfo.teamTokenBalance;

        uint8 newLevel = 0;
        for (uint8 lvl = 7; lvl >= 1; lvl--) {
            LevelCondition memory cond = levelConditions[lvl];
            if (
                directReferrals >= cond.minDirectReferrals &&
                personalTokens  >= cond.minPersonalTokens  &&
                teamTokens      >= cond.minTeamTokens
            ) {
                newLevel = lvl;
                break;
            }
        }

        if (userInfo.level != newLevel) {
            userInfo.level = newLevel;
            emit LevelUpgraded(user, newLevel);
        }
    }

    // Reflect token transfer in referrer's team token balance
    function _updateTeamTokenBalance(address from, address to, uint256 amount) private {
        if (from != address(0) && !_isContract(from) && referrerOf[from] != address(0)) {
            uint256 fromNewBalance = etimToken.balanceOf(from);
            uint256 fromOldBalance = fromNewBalance + amount;
            if (fromOldBalance != fromNewBalance) {
                _propagateTeamBalanceChange(from, int256(fromNewBalance) - int256(fromOldBalance));
            }
        }

        if (to != address(0) && !_isContract(to) && to != BURN_ADDRESS && referrerOf[to] != address(0)) {
            uint256 toNewBalance = etimToken.balanceOf(to);
            uint256 toOldBalance = toNewBalance >= amount ? toNewBalance - amount : 0;
            if (toOldBalance != toNewBalance) {
                _propagateTeamBalanceChange(to, int256(toNewBalance) - int256(toOldBalance));
            }
        }
    }

    // Propagate team balance change to direct referrer
    function _propagateTeamBalanceChange(address user, int256 delta) private {
        if (delta == 0) return;
        address referrer = referrerOf[user];
        if (referrer == address(0)) return;

        if (delta > 0) {
            users[referrer].teamTokenBalance += uint256(delta);
        } else {
            uint256 absDelta = uint256(-delta);
            users[referrer].teamTokenBalance = users[referrer].teamTokenBalance >= absDelta
                ? users[referrer].teamTokenBalance - absDelta
                : 0;
        }
    }

    // =========================================================
    //                        NODE
    // =========================================================

    // Calculate node NFT quota bonus in USD (6 decimals)
    function _calcNodeQuotaBonusInUsd(address user) private view returns (uint256) {
        return NODE_QUOTA * etimNode.balanceOf(user);
    }

    // Distribute ETIM rewards evenly across all active nodes
    function _distributeNodeRewards(uint256 etimAmount) internal {
        if (totalActiveNodes > 0) {
            rewardPerNode += etimAmount / totalActiveNodes;
        }
    }

    // Sync user's node NFT count and settle pending rewards
    function _syncUserNodes(address user) internal {
        UserInfo storage userInfo = users[user];
        if (userInfo.participationTime == 0) return;

        uint256 oldCount = userInfo.syncedNodeCount;
        uint256 newCount = userInfo.level >= 1 ? etimNode.balanceOf(user) : 0;

        // Settle accumulated rewards based on current count
        if (oldCount > 0) {
            uint256 accumulated = rewardPerNode * oldCount;
            uint256 pending     = accumulated > userInfo.nodeRewardDebt
                ? accumulated - userInfo.nodeRewardDebt
                : 0;
            userInfo.pendingNodeRewards += pending;
            userInfo.nodeRewardDebt      = accumulated;
        }

        if (oldCount == newCount) return;

        // Adjust global active node count
        if (oldCount > 0) totalActiveNodes -= oldCount;
        if (newCount > 0) totalActiveNodes += newCount;

        userInfo.syncedNodeCount = newCount;
        userInfo.nodeRewardDebt  = rewardPerNode * newCount;
    }

    // Public sync for user to call manually
    function syncNodes() external {
        _syncUserNodes(msg.sender);
    }

    // Claim accumulated node rewards
    function claimNodeRewards() external nonReentrant {
        address user = msg.sender;
        _syncUserNodes(user);

        UserInfo storage userInfo = users[user];
        uint256 amount = userInfo.pendingNodeRewards;
        if (amount == 0) revert NoRewardsToClaim();

        userInfo.pendingNodeRewards = 0;
        etimToken.transfer(user, amount);
    }

    // =========================================================
    //                     GROWTH POOL
    // =========================================================

    // Release ETIM from growth pool to recipient
    function _releaseFromGrowthPool(address to, uint256 amount) internal {
        if (growthPoolReleased + amount > GROWTH_POOL_SUPPLY) revert GrowthPoolExceeded();
        growthPoolReleased += amount;
        etimToken.transfer(to, amount);
    }

    // Remaining ETIM in growth pool
    function remainingGrowthPool() external view returns (uint256) {
        return GROWTH_POOL_SUPPLY - growthPoolReleased;
    }

    // Whether growth pool is fully depleted
    function isGrowthPoolDepleted() public view returns (bool) {
        return growthPoolReleased >= GROWTH_POOL_SUPPLY;
    }

    // =========================================================
    //                       BUY / SELL
    // =========================================================

    // Buy ETIM with ETH
    function buyETIM() external payable returns (uint256 etimReceived) {
        if (!buyEnabled) revert BuyNotEnabled();
        if (msg.value == 0) revert MustSendETH();

        uint256 ethAmount  = msg.value;
        etimReceived = etimPoolHelper.swapEthToEtim{value: ethAmount}(ethAmount);
        etimToken.transfer(msg.sender, etimReceived);
    }

    // Sell ETIM for ETH
    function sellETIM(uint256 etimAmount) external returns (uint256 ethReceived) {
        if (etimAmount == 0) revert InvalidSellAmount();
        if (etimToken.balanceOf(msg.sender) < etimAmount) revert InsufficientBalance();

        etimToken.transferFrom(msg.sender, address(this), etimAmount);

        uint256 lpAmount   = (etimAmount * SELL_LP_RATIO)   / FEE_DENOMINATOR; // 85%
        uint256 burnAmount = (etimAmount * SELL_BURN_RATIO)  / FEE_DENOMINATOR; // 10%
        uint256 nodeAmount = (etimAmount * SELL_NODE_RATIO)  / FEE_DENOMINATOR; // 5%

        if (lpAmount > 0) {
            ethReceived = etimPoolHelper.swapEtimToEth(lpAmount, msg.sender);
        }
        if (burnAmount > 0) {
            etimToken.transfer(BURN_ADDRESS, burnAmount);
        }
        if (nodeAmount > 0) {
            _distributeNodeRewards(nodeAmount);
        }

        emit TokenSold(msg.sender, etimAmount, ethReceived);
    }

    // =========================================================
    //                   PRICE & DAILY STATS
    // =========================================================

    // Update daily prices (called by owner once per day)
    function updateDailyPrice() external onlyOwner {
        uint256 currentDay = block.timestamp / 1 days;

        uint256 newEthEtimPrice = etimPoolHelper.getEtimPerEth();
        if (newEthEtimPrice == 0) revert InvalidPrice();
        ethPriceInEtim       = newEthEtimPrice;
        lastEthEtimPriceTime = block.timestamp;
        dailyEthEtimPrice[currentDay] = newEthEtimPrice;

        uint256 newEthUsdPrice = etimPoolHelper.getUsdcPerEth();
        if (newEthUsdPrice == 0) revert InvalidPrice();
        ethPriceInUsd       = newEthUsdPrice;
        lastEthUsdPriceTime = block.timestamp;

        // Update daily deposit cap from pool reserves
        uint256 ethReserves = etimPoolHelper.getEthReserves();
        if (currentDay != dailyCapUpdatedDay) {
            dailyDepositCap    = ethReserves;
            dailyCapUpdatedDay = currentDay;
        }

        // Update ETIM/USD derived price
        etimPerUsd = (newEthEtimPrice * 10**6) / newEthUsdPrice;
        dailyUsdEtimPrice[currentDay] = etimPerUsd;

        emit DailyPriceUpdated(currentDay, newEthEtimPrice, newEthUsdPrice);
    }

    // =========================================================
    //                   DELAYED ALLOCATION
    // =========================================================

    // Toggle delayed allocation mode
    function setDelayEnabled(bool enabled) external onlyOwner {
        delayEnabled = enabled;
    }

    // Execute a portion of pending delayed allocation
    function triggerDelayedAllocation(uint256 usdValue) external onlyOwner {
        if (usdValue > pendingAllocationInUsd) revert InvalidDelayAmount();

        _updateEthUsdPrice();
        _updateEthEtimPrice();

        uint256 ethAmount = (usdValue * 10 ** 18) / ethPriceInUsd;

        uint256 nodeEth = (ethAmount * NODE_SHARE) / FEE_DENOMINATOR;
        uint256 lpEth   = (ethAmount * LP_SHARE)   / FEE_DENOMINATOR;
        uint256 burnEth = (ethAmount * BURN_SHARE)  / FEE_DENOMINATOR;

        if (lpEth > 0) {
            etimPoolHelper.swapAndAddLiquidity{value: lpEth}(lpEth / 2);
        }
        if (burnEth > 0) {
            etimPoolHelper.swapAndBurn{value: burnEth}(burnEth);
        }
        if (nodeEth > 0) {
            uint256 nodeEtim = etimPoolHelper.swapEthToEtim{value: nodeEth}(nodeEth);
            _distributeNodeRewards(nodeEtim);
        }

        pendingAllocationInUsd -= usdValue;
    }

    // =========================================================
    //                       OWNER CONFIG
    // =========================================================

    // Set participation amount bounds (in USD, 6 decimals)
    function setParticipationAmountBounds(uint256 min, uint256 max) external onlyOwner {
        if (min == 0 || min > max) revert InvalidParams();
        participationAmountMin = min;
        participationAmountMax = max;
    }

    function setDailyReleaseRate(uint256 rate) external onlyOwner {
        dailyReleaseRate = rate;
    }

    function setDailyDepositRate(uint256 rate) external onlyOwner {
        dailyDepositRate = rate;
    }

    // =========================================================
    //                       VIEWS
    // =========================================================

    function getUserLevel(address user) external view returns (uint8) {
        return users[user].level;
    }

    // =========================================================
    //                       RECEIVE
    // =========================================================

    receive() external payable nonReentrant {
        if (!_isContract(msg.sender)) {
            _processParticipation(msg.sender, msg.value);
        }
    }

    // =========================================================
    //                       HELPERS
    // =========================================================

    function _isContract(address addr) private view returns (bool) {
        return addr.code.length > 0;
    }
}