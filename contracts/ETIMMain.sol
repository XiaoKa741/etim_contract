// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IETIMTaxHook {
    function flushS6ToMain(uint256 amount) external;
    function sellTaxToS6() external view returns (uint256);
}

interface IPancakeRouter {
    function swapExactETHForTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable returns (uint[] memory amounts);
    function WETH() external pure returns (address);
}

interface IETIMPoolHelper {
    function getEthReserves() external view returns (uint256);
    function getEtimPerEth() external view returns (uint256);
    function getUsdcPerEth() external view returns (uint256);
    function swapEthToEtim(uint256 ethAmount) external returns (uint256);
    function swapEtimToEth(uint256 etimAmount, address to) external returns (uint256);
    function swapAndAddLiquidity(uint256 ethAmount) external;
    function swapAndBurn(uint256 ethAmount) external;
}

contract ETIMMain is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ERRORS
    error OnlyEtimToken();
    error OnlyTaxHook();
    error AlreadyParticipated();
    error NoReferralBinding();
    error DailyDepositLimitExceeded();
    error InvalidDepositAmount();
    error NotParticipated();
    error NoRemainingValue();
    error NoRewardsToClaim();
    error InvalidParams();
    error InvalidPrice();
    error NothingPending();
    error CooldownNotElapsed();
    error GrowthPoolExceeded();
    error ZeroAddress();
    error NothingToWithdraw();
    error TransferFailed();

    // Other contract
    IERC20          public etimToken;
    IERC20          public weth;        // BSC bridged ETH (ERC-20)
    IERC721         public etimNode;
    IETIMPoolHelper public etimPoolHelper;
    address         public etimTaxHook;
    IPancakeRouter  public pancakeRouter;   // PancakeSwap V2 Router for BNB→WETH swap
    address         public wbnb;            // WBNB address on BSC

    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // Total ETIM allocated to growth pool
    uint256 public constant GROWTH_POOL_SUPPLY = 87_900_000 * 10 ** 18;

    // Base participation params
    uint256 public participationAmountMin = 100 * 10**6; // 100 USD (6 decimals)
    uint256 public participationAmountMax = 150 * 10**6; // 150 USD (6 decimals)
    uint256 public dailyMiningRate = 1; // 0.1% = 1/1000

    // Deposit fee distribution ratios (denominator = 1000)
    uint256 public constant NODE_SHARE = 15;  // 1.5%
    uint256 public constant LP_SHARE = 690;   // 69%
    uint256 public constant BURN_SHARE = 250; // 25%
    uint256 public constant REWARD_SHARE = 45; // 4.5%
    uint256 public constant FEE_DENOMINATOR = 1000;

    // Deposit reward distribution ratios (denominator = 1000)
    // S2+=1%, S3+=1%, Foundation=1.5%, Pot=0.5%, Official=0.5% of total deposit
    uint256 public constant REWARD_S2         = 222; // ~22.2% of REWARD (= 1% of total)
    uint256 public constant REWARD_S3         = 222; // ~22.2% of REWARD (= 1% of total)
    uint256 public constant REWARD_FOUNDATION = 333; // ~33.3% of REWARD (= 1.5% of total)
    uint256 public constant REWARD_POT        = 111; // ~11.1% of REWARD (= 0.5% of total)
    uint256 public constant REWARD_OFFICIAL   = 112; // ~11.2% of REWARD (= 0.5% of total, remainder)

    // Deposit reward stats
    uint256 public foundationRewardEth;
    uint256 public potRewardEth;
    uint256 public officialRewardEth;

    // Team depth & S0 acceleration
    uint256 public maxTeamDepth       = 20;  // max recursion depth for team balance propagation (owner adjustable)
    uint256 public s0AccelerationRate = 100; // S0 acceleration: direct referrals daily output * rate / 1000 (default 10%)

    // Branch token balance: total tokens held by user + ALL their downstream (for big/small zone calc)
    mapping(address => uint256) public branchTokenBalance;

    // LP+Burn rate-limited allocation
    uint256 public pendingLpEth       = 0;
    uint256 public pendingSwapBurnEth = 0;
    uint256 public lpBurnCooldown     = 15 minutes;
    uint256 public lpBurnLastTrigger  = 0;
    uint256 public lpBurnAutoRatio    = 1000; // ratio applied to LP and burn portions separately (denominator 1000)

    // LP+Burn manual trigger
    uint256 public lpBurnManualRatio    = 10; // manual allocation ratio (LP+Burn)
    uint256 public lpManualAmount       = 0;  // manual allocation a fixed amount for LP
    uint256 public swapBurnManualAmount = 0;  // manual allocation a fixed amount for Burn

    // Node reward tracking
    uint256 public constant NODE_QUOTA = 300 * 10 ** 6;
    uint256 public rewardPerNode;
    uint256 public nodeDistributionDust;        // carry-over remainder from integer division
    uint256 public totalActiveNodes;

    // S2+ player reward tracking (pull mode — accRewardPerShare pattern)
    uint256 public s2PlusAccRewardPerShare;     // accumulated ETIM reward per active player (scaled by 1e18)
    uint256 public totalActiveS2PlusPlayers;
    mapping(address => uint256) public s2PlusRewardDebt;     // user's settled accRewardPerShare snapshot
    mapping(address => uint256) public s2PlusPendingReward;  // user's unclaimed ETIM reward

    // S3+ player reward tracking (pull mode — accRewardPerShare pattern)
    uint256 public s3PlusAccRewardPerShare;     // accumulated ETIM reward per active player (scaled by 1e18)
    uint256 public totalActiveS3PlusPlayers;
    mapping(address => uint256) public s3PlusRewardDebt;     // user's settled accRewardPerShare snapshot
    mapping(address => uint256) public s3PlusPendingReward;  // user's unclaimed ETIM reward

    // S6 player reward tracking
    uint256 public totalActiveS6Players;
    address[] public s6PlayerList;              // all current S6 players
    mapping(address => uint256) private _s6PlayerIdx; // 1-indexed, 0 = not in list

    // User info
    struct UserInfo {
        uint256 participationTime;
        uint256 investedEthAmount;      // ETH deposited
        uint256 investedValueInUsd;     // USD-equivalent at deposit time (6 decimals)
        uint256 claimedValueInUsd;      // Total USD value already claimed
        uint256 lastClaimTime;
        uint256 directReferralCount;
        uint256 teamTokenBalance;       // Team total ETIM (excluding self)
        uint8   level;

        uint256 syncedNodeCount;        // Node count at last sync
        uint256 nodeRewardDebt;         // Accumulated reward debt for node accounting
        uint256 pendingNodeRewards;     // Settled but unclaimed node rewards

        bool    s2PlusActive;           // Counted in totalActiveS2PlusPlayers
        bool    s3PlusActive;           // Counted in totalActiveS3PlusPlayers
        bool    s6Active;               // Counted in totalActiveS6Players
    }

    // Price storage
    mapping(uint256 => uint256) public dailyEthEtimPrice;  // day => ETIM per ETH (18 decimals)
    mapping(uint256 => uint256) public dailyUsdEtimPrice;  // day => ETIM per USD (18 decimals)

    uint256 public ethPriceInUsd  = 2000 * 10**6;   // 1 ETH = 2000 USD (6 decimals)
    uint256 public ethPriceInEtim = 2000 * 10**18;  // 1 ETH = 2000 ETIM (18 decimals)
    uint256 public etimPerUsd     = 1 * 10**18;     // 1 USD = 1 ETIM (18 decimals)

    uint256 public lastEthEtimPriceTime = 0;
    uint256 public lastEthUsdPriceTime  = 0;

    // Daily deposit limit
    uint256 public dailyDepositCap    = 0;
    uint256 public dailyDepositRate   = 200; // 20% = 200/1000
    uint256 public dailyDepositLimit  = 0;   // if non-zero, used directly as daily cap
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
    modifier onlyEtimTokenOrOwner() {
        if (msg.sender != address(etimToken) && msg.sender != owner()) revert OnlyEtimToken();
        _;
    }

    event Participated(address indexed user, uint256 ethAmount);
    event ETIMClaimed(address indexed user, uint256 etimAmount, uint256 usdValue);
    event TokenSold(address indexed user, uint256 etimAmount, uint256 ethReceived);
    event ReferralAdded(address indexed referrer, address indexed invitee, uint256 timestamp);
    event LevelUpgraded(address indexed user, uint8 newLevel);
    event DailyPriceUpdated(uint256 day, uint256 ethEtimPrice, uint256 ethUsdPrice);
    event S2PlusRewardClaimed(address indexed user, uint256 amount);
    event S3PlusRewardClaimed(address indexed user, uint256 amount);
    event S6RewardClaimed(address indexed user, uint256 amount);
    event LpBurnManualTriggered(address indexed caller, uint256 lpAmount, uint256 swapBurnAmount);

    constructor(
        address _etimToken,
        address _weth,
        address _etimNode,
        address _etimPoolHelper,
        address _etimTaxHook,
        address _pancakeRouter,
        address _wbnb
    ) Ownable(msg.sender) {
        if (_etimToken == address(0) || _weth == address(0) || _etimNode == address(0) ||
            _etimPoolHelper == address(0) || _etimTaxHook == address(0) ||
            _pancakeRouter == address(0) || _wbnb == address(0)) revert ZeroAddress();

        etimToken      = IERC20(_etimToken);
        weth           = IERC20(_weth);
        etimNode       = IERC721(_etimNode);
        etimPoolHelper = IETIMPoolHelper(_etimPoolHelper);
        etimTaxHook    = _etimTaxHook;
        pancakeRouter  = IPancakeRouter(_pancakeRouter);
        wbnb           = _wbnb;

        _initializeLevelConditions();
    }

    // Initialize membership level conditions
    function _initializeLevelConditions() private {
        levelConditions[0] = LevelCondition(0,  0,               0,                 0); // S0 uses s0AccelerationRate instead
        levelConditions[1] = LevelCondition(5,  30000  * 10**18, 300000  * 10**18,  7);
        levelConditions[2] = LevelCondition(10, 50000  * 10**18, 1000000 * 10**18, 10);
        levelConditions[3] = LevelCondition(15, 100000 * 10**18, 2000000 * 10**18, 12);
        levelConditions[4] = LevelCondition(20, 150000 * 10**18, 3000000 * 10**18, 15);
        levelConditions[5] = LevelCondition(25, 200000 * 10**18, 4000000 * 10**18, 18);
        levelConditions[6] = LevelCondition(30, 300000 * 10**18, 5000000 * 10**18, 21);
    }

    // User deposits WETH (BSC bridged ETH) to participate
    function deposit(uint256 ethAmount) external nonReentrant {
        weth.safeTransferFrom(msg.sender, address(this), ethAmount);
        _processParticipation(msg.sender, ethAmount);
    }

    // Participation logic
    function _processParticipation(address addr, uint256 ethAmount) private {
        if (users[addr].participationTime != 0) revert AlreadyParticipated();
        // Allow participation if user has any referral relationship
        if (referrerOf[addr] == address(0) && users[addr].directReferralCount == 0) revert NoReferralBinding();

        // Check and reset daily ETH deposit limit
        uint256 currentDay = block.timestamp / 1 days;
        if (dailyDepositDay != currentDay) {
            dailyDepositDay = currentDay;
            dailyDepositTotal = 0;
        }
        uint256 effectiveLimit;
        if (dailyDepositLimit != 0) {
            effectiveLimit = dailyDepositLimit;
        } else {
            uint256 effectiveCap = (dailyDepositCap == 0)
                ? etimPoolHelper.getEthReserves()
                : dailyDepositCap;
            effectiveLimit = effectiveCap * dailyDepositRate / FEE_DENOMINATOR;
        }
        if (dailyDepositTotal + ethAmount >= effectiveLimit) revert DailyDepositLimitExceeded();

        // Update prices
        _updateEthUsdPrice();
        _updateEthEtimPrice();

        // Validate deposit amount in USD terms
        uint256 requiredMinEth = (participationAmountMin * 10 ** 18) / ethPriceInUsd;
        uint256 requiredMaxEth = (participationAmountMax * 10 ** 18) / ethPriceInUsd;
        uint256 nodeQuotaEth   = _calcNodeQuotaBonusInUsd(addr) * 10 ** 18 / ethPriceInUsd;

        requiredMaxEth = requiredMaxEth > nodeQuotaEth ? requiredMaxEth : nodeQuotaEth;
        if (ethAmount < requiredMinEth || ethAmount > requiredMaxEth) revert InvalidDepositAmount();

        // USD-equivalent participation amount
        uint256 participationValueInUsd = ethAmount * ethPriceInUsd / 10 ** 18;

        _allocateDepositFunds(ethAmount);

        // Record user info
        users[addr].participationTime    = block.timestamp;
        users[addr].investedEthAmount    = ethAmount;
        users[addr].investedValueInUsd   = participationValueInUsd;
        users[addr].claimedValueInUsd    = 0;
        users[addr].lastClaimTime        = block.timestamp;

        participants.push(addr);
        totalUsers++;
        totalDeposited    += ethAmount;
        dailyDepositTotal += ethAmount;

        _checkAndUpdateLevel(addr);

        emit Participated(addr, ethAmount);
    }

    // Allocate WETH: node/reward immediate; LP(69%) + burn(25%) rate-limited via pending
    function _allocateDepositFunds(uint256 ethAmount) private {
        uint256 nodeEth     = (ethAmount * NODE_SHARE) / FEE_DENOMINATOR;
        uint256 lpEth       = (ethAmount * LP_SHARE)   / FEE_DENOMINATOR;
        uint256 swapBurnEth = (ethAmount * BURN_SHARE)  / FEE_DENOMINATOR;
        uint256 rewardEth   = ethAmount - nodeEth - lpEth - swapBurnEth;

        uint256 s2Eth         = rewardEth * REWARD_S2         / FEE_DENOMINATOR;
        uint256 s3Eth         = rewardEth * REWARD_S3         / FEE_DENOMINATOR;
        uint256 foundationEth = rewardEth * REWARD_FOUNDATION / FEE_DENOMINATOR;
        uint256 potEth        = rewardEth * REWARD_POT        / FEE_DENOMINATOR;
        uint256 officialEth   = rewardEth - s2Eth - s3Eth - foundationEth - potEth;

        // Overflow: no active nodes/S2+/S3+ → surplus into LP pending (rate-limited together)
        if (totalActiveNodes == 0)         { lpEth += nodeEth; nodeEth = 0; }
        if (totalActiveS2PlusPlayers == 0) { lpEth += s2Eth;   s2Eth   = 0; }
        if (totalActiveS3PlusPlayers == 0) { lpEth += s3Eth;   s3Eth   = 0; }

        // Immediate distributions (approve WETH to PoolHelper for swap operations)
        if (nodeEth > 0) {
            weth.forceApprove(address(etimPoolHelper), nodeEth);
            _distributeNodeRewards(etimPoolHelper.swapEthToEtim(nodeEth));
        }
        if (s2Eth > 0) {
            weth.forceApprove(address(etimPoolHelper), s2Eth);
            uint256 s2Etim = etimPoolHelper.swapEthToEtim(s2Eth);
            _distributeS2PlusRewards(s2Etim);
        }
        if (s3Eth > 0) {
            weth.forceApprove(address(etimPoolHelper), s3Eth);
            uint256 s3Etim = etimPoolHelper.swapEthToEtim(s3Eth);
            _distributeS3PlusRewards(s3Etim);
        }
        if (foundationEth > 0) foundationRewardEth += foundationEth;
        if (potEth > 0)        potRewardEth        += potEth;
        if (officialEth > 0)   officialRewardEth   += officialEth;

        // LP + burn: player deposits always inject the ratio portion immediately (no cooldown)
        uint256 lpInject       = lpEth       * lpBurnAutoRatio / FEE_DENOMINATOR;
        uint256 swapBurnInject = swapBurnEth * lpBurnAutoRatio / FEE_DENOMINATOR;

        pendingLpEth       += lpEth       - lpInject;
        pendingSwapBurnEth += swapBurnEth - swapBurnInject;

        if (lpInject > 0) {
            weth.forceApprove(address(etimPoolHelper), lpInject);
            etimPoolHelper.swapAndAddLiquidity(lpInject);
        }
        if (swapBurnInject > 0) {
            weth.forceApprove(address(etimPoolHelper), swapBurnInject);
            etimPoolHelper.swapAndBurn(swapBurnInject);
        }
    }


    // Manual sync level
    function syncLevel() external {
        _checkAndUpdateLevel(msg.sender);
    }

    // Manual sync team token balance (recalculates full branch tree)
    function syncTeamBalance() external {
        uint256 selfBalance = etimToken.balanceOf(msg.sender);
        (uint256 totalTeam, uint256 totalBranch) = _recalcBranch(msg.sender, 0);
        users[msg.sender].teamTokenBalance = totalTeam;
        branchTokenBalance[msg.sender] = selfBalance + totalTeam;
        _checkAndUpdateLevel(msg.sender);
    }

    /// @notice Recursively recalculate team and branch balances
    function _recalcBranch(address user, uint256 depth) private view returns (uint256 teamTotal, uint256 branchTotal) {
        address[] memory refs = referralsOfList[user];
        uint256 selfBal = etimToken.balanceOf(user);
        branchTotal = selfBal;

        for (uint256 i = 0; i < refs.length && depth < maxTeamDepth; i++) {
            (, uint256 childBranch) = _recalcBranch(refs[i], depth + 1);
            teamTotal += childBranch;
            branchTotal += childBranch;
        }
    }

    // Calculate claimable mining rewards (view)
    function getClaimableAmount() external view returns (uint256) {
        (uint256 etimAmount, ) = _calculatePendingRewards(msg.sender);

        uint256 growthPoolRemain = GROWTH_POOL_SUPPLY - growthPoolReleased;
        etimAmount = growthPoolRemain > etimAmount ? etimAmount : growthPoolRemain;
        
        return etimAmount;
    }

    // Get specified user claimable mining rewards (view)
    function getClaimableAmountOf(address user) external view returns (uint256) {
        (uint256 etimAmount, ) = _calculatePendingRewards(user);

        uint256 growthPoolRemain = GROWTH_POOL_SUPPLY - growthPoolReleased;
        etimAmount = growthPoolRemain > etimAmount ? etimAmount : growthPoolRemain;
        
        return etimAmount;
    }

    // Claim mining rewards (external entry point)
    function claim() external nonReentrant {
        _claimRewards(msg.sender);
    }

    // Internal claim logic (shared by claim() and receive())
    function _claimRewards(address addr) private {
        UserInfo storage user = users[addr];
        if (user.participationTime == 0) revert NotParticipated();
        if (user.claimedValueInUsd >= user.investedValueInUsd) revert NoRemainingValue();

        _checkAndUpdateLevel(addr);
        
        (uint256 pendingEtim, uint256 claimableUsd) = _calculatePendingRewards(addr);
        if (pendingEtim == 0) revert NoRewardsToClaim();

        // Update user state
        user.claimedValueInUsd += claimableUsd;
        user.lastClaimTime = block.timestamp;

        // Check and send rewards
        uint256 growthPoolRemain = GROWTH_POOL_SUPPLY - growthPoolReleased;
        pendingEtim = pendingEtim > growthPoolRemain ? growthPoolRemain : pendingEtim;
        _releaseFromGrowthPool(addr, pendingEtim);

        emit ETIMClaimed(addr, pendingEtim, claimableUsd);
    }

    // Convert USD value to ETIM using the price recorded on a given day
    function _convertUsdToEtim(uint256 timestamp, uint256 valueInUsd) private view returns (uint256) {
        uint256 day = timestamp / 1 days;
        uint256 price = dailyUsdEtimPrice[day];
        if (price == 0) price = etimPerUsd;
        if (price == 0) return 0;
        return valueInUsd * price / 10**6;
    }

    // Calculate pending rewards aggregated by day (with S0 / S1-S6 acceleration)
    function _calculatePendingRewards(address userAddr) private view returns (uint256 etimAmount, uint256 usdClaimed) {
        UserInfo storage user = users[userAddr];

        if (user.participationTime == 0) return (0, 0);
        if (isGrowthPoolDepleted()) return (0, 0);

        uint256 remainingValueInUsd = user.investedValueInUsd - user.claimedValueInUsd;
        if (remainingValueInUsd == 0) return (0, 0);

        uint256 startDay = user.lastClaimTime / 1 days * 1 days;
        uint256 endDay   = block.timestamp    / 1 days * 1 days;

        // Cap loop iterations to prevent DoS when user hasn't claimed for a long time
        uint256 maxDays = 365;
        if ((endDay - startDay) / 1 days > maxDays) {
            startDay = endDay - (maxDays * 1 days);
        }

        uint256 rewardInEtim     = 0;
        uint256 initialRemaining = remainingValueInUsd;

        for (uint256 t = startDay; t < endDay; t += 1 days) {
            // Base daily output in USD
            uint256 dailyUsd = (user.investedValueInUsd * dailyMiningRate) / 1000;

            // Acceleration: calculate bonus ETIM from downstream, convert to USD equivalent
            uint256 bonusEtim = _calculateAccelerationBonus(userAddr, user.level, t);
            if (bonusEtim > 0) {
                // Convert bonus ETIM to USD equivalent to add to dailyUsd for cap tracking
                uint256 bonusUsd = _convertEtimToUsd(t, bonusEtim);
                dailyUsd += bonusUsd;
            }

            if (dailyUsd > remainingValueInUsd) dailyUsd = remainingValueInUsd;

            rewardInEtim        += _convertUsdToEtim(t, dailyUsd);
            remainingValueInUsd -= dailyUsd;

            if (remainingValueInUsd == 0) break;
        }

        usdClaimed = initialRemaining - remainingValueInUsd;
        return (rewardInEtim, usdClaimed);
    }

    /// @notice Calculate acceleration bonus ETIM for a user on a given day
    /// S0: direct referrals' daily ETIM output * s0AccelerationRate / 1000
    /// S1-S6: small zone downstream daily ETIM output * accelerationRate / 100
    function _calculateAccelerationBonus(address userAddr, uint8 level, uint256 day) private view returns (uint256 bonusEtim) {
        if (level == 0) {
            // S0: bonus from direct referrals' daily output
            if (s0AccelerationRate == 0) return 0;
            uint256 totalDirectDailyEtim = _getDirectReferralsDailyEtim(userAddr, day);
            bonusEtim = (totalDirectDailyEtim * s0AccelerationRate) / 1000;
        } else {
            // S1-S6: bonus from small zone downstream daily output
            uint256 accelerationRate = levelConditions[level].accelerationRate;
            if (accelerationRate == 0) return 0;
            uint256 smallZoneDailyEtim = _getSmallZoneDailyEtim(userAddr, day);
            bonusEtim = (smallZoneDailyEtim * accelerationRate) / 100;
        }
    }

    /// @notice Sum of direct referrals' daily ETIM output (for S0 acceleration)
    function _getDirectReferralsDailyEtim(address userAddr, uint256 day) private view returns (uint256 total) {
        address[] memory directRefs = referralsOfList[userAddr];
        for (uint256 i = 0; i < directRefs.length; i++) {
            UserInfo storage ref = users[directRefs[i]];
            if (ref.participationTime == 0) continue;
            if (ref.claimedValueInUsd >= ref.investedValueInUsd) continue;
            uint256 refDailyUsd = (ref.investedValueInUsd * dailyMiningRate) / 1000;
            total += _convertUsdToEtim(day, refDailyUsd);
        }
    }

    /// @notice Sum of "small zone" downstream daily ETIM output (for S1-S6 acceleration)
    /// Small zone = total downstream output - biggest branch output
    function _getSmallZoneDailyEtim(address userAddr, uint256 day) private view returns (uint256) {
        address[] memory directRefs = referralsOfList[userAddr];
        uint256 totalDailyEtim = 0;
        uint256 maxBranchDailyEtim = 0;

        for (uint256 i = 0; i < directRefs.length; i++) {
            uint256 branchDaily = _getBranchDailyEtim(directRefs[i], day, 0);
            totalDailyEtim += branchDaily;
            if (branchDaily > maxBranchDailyEtim) {
                maxBranchDailyEtim = branchDaily;
            }
        }

        return totalDailyEtim >= maxBranchDailyEtim ? totalDailyEtim - maxBranchDailyEtim : 0;
    }

    /// @notice Recursively sum daily ETIM output of a user and all their downstream
    function _getBranchDailyEtim(address userAddr, uint256 day, uint256 depth) private view returns (uint256 total) {
        if (depth >= maxTeamDepth) return 0;

        UserInfo storage user = users[userAddr];
        if (user.participationTime > 0 && user.claimedValueInUsd < user.investedValueInUsd) {
            uint256 dailyUsd = (user.investedValueInUsd * dailyMiningRate) / 1000;
            total += _convertUsdToEtim(day, dailyUsd);
        }

        address[] memory refs = referralsOfList[userAddr];
        for (uint256 i = 0; i < refs.length; i++) {
            total += _getBranchDailyEtim(refs[i], day, depth + 1);
        }
    }

    /// @notice Convert ETIM amount back to USD equivalent (6 decimals) using day price
    function _convertEtimToUsd(uint256 timestamp, uint256 etimAmount) private view returns (uint256) {
        uint256 day = timestamp / 1 days;
        uint256 price = dailyUsdEtimPrice[day]; // ETIM per 1 USD (18 decimals)
        if (price == 0) price = etimPerUsd;
        if (price == 0) return 0;
        return (etimAmount * 10**6) / price;
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
    ) external onlyEtimTokenOrOwner {
        _processReferralBinding(from, to, value);
        _updateTeamTokenBalance(from, to, value);
        _checkAndUpdateLevel(from);
        _checkAndUpdateLevel(to);
        _checkAndUpdateLevel(referrerOf[from]);
        _checkAndUpdateLevel(referrerOf[to]);
    }

    // ETIM token balance changed callback (swap / burn / contract transfer)
    function onTokenBalanceChanged(
        address from,
        address to,
        uint256 value
    ) external onlyEtimTokenOrOwner {
        _updateTeamTokenBalance(from, to, value);
        _checkAndUpdateLevel(from);
        _checkAndUpdateLevel(to);
        _checkAndUpdateLevel(referrerOf[from]);
        _checkAndUpdateLevel(referrerOf[to]);
    }

    // Determine and record referral relationship from bilateral transfers
    // Supports both EOA and contract wallets (e.g. multisig, AA wallets)
    function _processReferralBinding(address from, address to, uint256 value) private {
        if (
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

            // If both parties already have participation qualification, treat as normal transfer
            bool fromQualified = referrerOf[from] != address(0) || users[from].directReferralCount > 0;
            bool toQualified   = referrerOf[to]   != address(0) || users[to].directReferralCount   > 0;
            if (fromQualified && toQualified) {
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

                // Invitee already has a referrer or has invited others — do not overwrite
                if (referrerOf[invitee] != address(0) || users[invitee].directReferralCount > 0) {
                    // Clear and wait next transfer then establish referral
                    delete transferRecords[referrer][invitee];
                    return;
                }

                referralsOf[referrer][invitee] = block.timestamp;
                referralsOfList[referrer].push(invitee);
                referrerOf[invitee] = referrer;

                // Approximate invitee's pre-transfer balance for team accounting
                uint256 inviteeCurrentBalance = etimToken.balanceOf(invitee);
                uint256 inviteePreBalance     = (invitee == from)
                    ? inviteeCurrentBalance + value
                    : (inviteeCurrentBalance >= value ? inviteeCurrentBalance - value : 0);

                users[referrer].directReferralCount++;

                // Initialize invitee's branchTokenBalance if not yet set
                if (branchTokenBalance[invitee] == 0 && inviteePreBalance > 0) {
                    branchTokenBalance[invitee] = inviteePreBalance;
                }
                // Propagate the invitee's full branch (self + any existing downstream) up the referral chain
                uint256 inviteeBranch = branchTokenBalance[invitee];
                if (inviteeBranch > 0) {
                    // Directly update referrer and ancestors (skip invitee's own branchTokenBalance since already set)
                    address cur = invitee;
                    for (uint256 d = 0; d < maxTeamDepth; d++) {
                        address ref = referrerOf[cur];
                        if (ref == address(0)) break;
                        users[ref].teamTokenBalance += inviteeBranch;
                        branchTokenBalance[ref] += inviteeBranch;
                        cur = ref;
                    }
                }

                emit ReferralAdded(referrer, invitee, block.timestamp);

                // Clean up transfer records
                if (transferRecords[referrer][invitee] > 0) delete transferRecords[referrer][invitee];
                if (transferRecords[invitee][referrer] > 0) delete transferRecords[invitee][referrer];
            }
        }
    }

    // Update user level based on current stats (uses "small zone" team tokens)
    function _checkAndUpdateLevel(address user) private {
        if (user == address(0)) return;

        UserInfo storage userInfo = users[user];
        if (userInfo.participationTime == 0) return;

        uint256 personalTokens  = etimToken.balanceOf(user);
        uint256 directReferrals = userInfo.directReferralCount;
        uint256 teamTokens      = _getSmallZoneTokens(user);

        uint8 newLevel = 0;
        for (uint8 lvl = 6; lvl >= 1; lvl--) {
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

            _syncUserS2PlusState(user);
            _syncUserS3PlusState(user);
            _syncUserS6State(user);
        }
    }

    /// @notice Calculate "small zone" tokens = totalTeamTokens - largest direct referral branch
    function _getSmallZoneTokens(address user) internal view returns (uint256) {
        uint256 totalTeam = users[user].teamTokenBalance;
        if (totalTeam == 0) return 0;

        // Find the largest branch among direct referrals ("big zone")
        address[] memory directRefs = referralsOfList[user];
        uint256 maxBranch = 0;
        for (uint256 i = 0; i < directRefs.length; i++) {
            uint256 branch = branchTokenBalance[directRefs[i]];
            if (branch > maxBranch) {
                maxBranch = branch;
            }
        }

        return totalTeam >= maxBranch ? totalTeam - maxBranch : 0;
    }

    // Reflect token transfer in team token balances (recursive up to maxTeamDepth)
    // Supports both EOA and contract wallets
    function _updateTeamTokenBalance(address from, address to, uint256 amount) private {
        if (from != address(0) && from != BURN_ADDRESS) {
            uint256 fromNewBalance = etimToken.balanceOf(from);
            uint256 fromOldBalance = fromNewBalance + amount;
            if (fromOldBalance != fromNewBalance) {
                int256 delta = int256(fromNewBalance) - int256(fromOldBalance);
                if (referrerOf[from] != address(0)) {
                    _propagateTeamBalanceChange(from, delta);
                } else {
                    _applyBranchDelta(from, delta);
                }
            }
        }

        if (to != address(0) && to != BURN_ADDRESS) {
            uint256 toNewBalance = etimToken.balanceOf(to);
            uint256 toOldBalance = toNewBalance >= amount ? toNewBalance - amount : 0;
            if (toOldBalance != toNewBalance) {
                int256 delta = int256(toNewBalance) - int256(toOldBalance);
                if (referrerOf[to] != address(0)) {
                    _propagateTeamBalanceChange(to, delta);
                } else {
                    _applyBranchDelta(to, delta);
                }
            }
        }
    }

    // Propagate team balance change up to maxTeamDepth ancestors
    // Also updates branchTokenBalance for big/small zone calculation
    function _propagateTeamBalanceChange(address user, int256 delta) private {
        if (delta == 0) return;

        // Update the user's own branchTokenBalance (self + all downstream)
        _applyBranchDelta(user, delta);

        // Propagate up the referral chain
        address current = user;
        for (uint256 depth = 0; depth < maxTeamDepth; depth++) {
            address referrer = referrerOf[current];
            if (referrer == address(0)) break;

            // Update referrer's teamTokenBalance (total of ALL downstream)
            if (delta > 0) {
                users[referrer].teamTokenBalance += uint256(delta);
            } else {
                uint256 absDelta = uint256(-delta);
                users[referrer].teamTokenBalance = users[referrer].teamTokenBalance >= absDelta
                    ? users[referrer].teamTokenBalance - absDelta
                    : 0;
            }

            // Update referrer's branchTokenBalance (self + all downstream)
            _applyBranchDelta(referrer, delta);

            current = referrer;
        }
    }

    function _applyBranchDelta(address user, int256 delta) private {
        if (delta > 0) {
            branchTokenBalance[user] += uint256(delta);
        } else {
            uint256 absDelta = uint256(-delta);
            branchTokenBalance[user] = branchTokenBalance[user] >= absDelta
                ? branchTokenBalance[user] - absDelta
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
            uint256 total = etimAmount + nodeDistributionDust;
            rewardPerNode        += total / totalActiveNodes;
            nodeDistributionDust  = total % totalActiveNodes;
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
        // Advance debt checkpoint
        userInfo.nodeRewardDebt  = rewardPerNode * newCount;
    }

    // Public sync for user to call manually
    function syncNodes() external {
        _syncUserNodes(msg.sender);
    }

    // Query claimable node rewards (view)
    function getClaimableNodeRewards(address userAddr) external view returns (uint256) {
        UserInfo storage userInfo = users[userAddr];
        uint256 pending = userInfo.pendingNodeRewards;
        uint256 count = userInfo.syncedNodeCount;
        if (count > 0) {
            uint256 accumulated = rewardPerNode * count;
            if (accumulated > userInfo.nodeRewardDebt) {
                pending += accumulated - userInfo.nodeRewardDebt;
            }
        }
        return pending;
    }

    // Claim accumulated node rewards
    function claimNodeRewards() external nonReentrant {
        address user = msg.sender;
        _syncUserNodes(user);

        UserInfo storage userInfo = users[user];
        uint256 amount = userInfo.pendingNodeRewards;
        if (amount == 0) revert NoRewardsToClaim();

        userInfo.pendingNodeRewards = 0;
        etimToken.safeTransfer(user, amount);
    }

    // =========================================================
    //                     S2+ PLAYERS (Pull Mode)
    // =========================================================

    // Accumulate ETIM rewards — increases accRewardPerShare for all active S2+ players
    function _distributeS2PlusRewards(uint256 etimAmount) internal {
        if (totalActiveS2PlusPlayers > 0 && etimAmount > 0) {
            s2PlusAccRewardPerShare += (etimAmount * 1e18) / totalActiveS2PlusPlayers;
        }
    }

    // Settle pending reward for a user based on current accRewardPerShare
    function _settleS2PlusReward(address userAddr) private {
        if (users[userAddr].s2PlusActive) {
            uint256 acc = s2PlusAccRewardPerShare;
            uint256 debt = s2PlusRewardDebt[userAddr];
            if (acc > debt) {
                s2PlusPendingReward[userAddr] += (acc - debt) / 1e18;
            }
        }
        s2PlusRewardDebt[userAddr] = s2PlusAccRewardPerShare;
    }

    // Sync user's S2+ status — settle rewards before any state change
    function _syncUserS2PlusState(address userAddr) internal {
        UserInfo storage userInfo = users[userAddr];
        if (userInfo.participationTime == 0) return;

        bool shouldBeActive = userInfo.level >= 2;
        bool wasActive      = userInfo.s2PlusActive;

        if (wasActive == shouldBeActive) return;

        // Settle before state change
        _settleS2PlusReward(userAddr);

        if (shouldBeActive) {
            totalActiveS2PlusPlayers++;
            userInfo.s2PlusActive = true;
        } else {
            totalActiveS2PlusPlayers--;
            userInfo.s2PlusActive = false;
        }

        // Reset debt to current acc so new state starts fresh
        s2PlusRewardDebt[userAddr] = s2PlusAccRewardPerShare;
    }

    // Query claimable S2+ rewards (view)
    function getClaimableS2PlusRewards(address userAddr) external view returns (uint256) {
        uint256 pending = s2PlusPendingReward[userAddr];
        if (users[userAddr].s2PlusActive) {
            uint256 acc = s2PlusAccRewardPerShare;
            uint256 debt = s2PlusRewardDebt[userAddr];
            if (acc > debt) {
                pending += (acc - debt) / 1e18;
            }
        }
        return pending;
    }

    // User claims their own S2+ rewards (O(1) gas)
    function claimS2PlusRewards() external nonReentrant {
        _checkAndUpdateLevel(msg.sender);
        _settleS2PlusReward(msg.sender);

        uint256 amount = s2PlusPendingReward[msg.sender];
        if (amount == 0) revert NoRewardsToClaim();

        s2PlusPendingReward[msg.sender] = 0;
        etimToken.safeTransfer(msg.sender, amount);
        emit S2PlusRewardClaimed(msg.sender, amount);
    }

    // =========================================================
    //                     S3+ PLAYERS (Pull Mode)
    // =========================================================

    // Accumulate ETIM rewards — increases accRewardPerShare for all active S3+ players
    function _distributeS3PlusRewards(uint256 etimAmount) internal {
        if (totalActiveS3PlusPlayers > 0 && etimAmount > 0) {
            s3PlusAccRewardPerShare += (etimAmount * 1e18) / totalActiveS3PlusPlayers;
        }
    }

    // Settle pending reward for a user based on current accRewardPerShare
    function _settleS3PlusReward(address userAddr) private {
        if (users[userAddr].s3PlusActive) {
            uint256 acc = s3PlusAccRewardPerShare;
            uint256 debt = s3PlusRewardDebt[userAddr];
            if (acc > debt) {
                s3PlusPendingReward[userAddr] += (acc - debt) / 1e18;
            }
        }
        s3PlusRewardDebt[userAddr] = s3PlusAccRewardPerShare;
    }

    // Sync user's S3+ status — settle rewards before any state change
    function _syncUserS3PlusState(address userAddr) internal {
        UserInfo storage userInfo = users[userAddr];
        if (userInfo.participationTime == 0) return;

        bool shouldBeActive = userInfo.level >= 3;
        bool wasActive      = userInfo.s3PlusActive;

        if (wasActive == shouldBeActive) return;

        // Settle before state change
        _settleS3PlusReward(userAddr);

        if (shouldBeActive) {
            totalActiveS3PlusPlayers++;
            userInfo.s3PlusActive = true;
        } else {
            totalActiveS3PlusPlayers--;
            userInfo.s3PlusActive = false;
        }

        // Reset debt to current acc so new state starts fresh
        s3PlusRewardDebt[userAddr] = s3PlusAccRewardPerShare;
    }

    // Query claimable S3+ rewards (view)
    function getClaimableS3PlusRewards(address userAddr) external view returns (uint256) {
        uint256 pending = s3PlusPendingReward[userAddr];
        if (users[userAddr].s3PlusActive) {
            uint256 acc = s3PlusAccRewardPerShare;
            uint256 debt = s3PlusRewardDebt[userAddr];
            if (acc > debt) {
                pending += (acc - debt) / 1e18;
            }
        }
        return pending;
    }

    // User claims their own S3+ rewards (O(1) gas)
    function claimS3PlusRewards() external nonReentrant {
        _checkAndUpdateLevel(msg.sender);
        _settleS3PlusReward(msg.sender);

        uint256 amount = s3PlusPendingReward[msg.sender];
        if (amount == 0) revert NoRewardsToClaim();

        s3PlusPendingReward[msg.sender] = 0;
        etimToken.safeTransfer(msg.sender, amount);
        emit S3PlusRewardClaimed(msg.sender, amount);
    }

    // =========================================================
    //                     S6 PLAYERS
    // =========================================================

    // Sync user's S6 status and maintain player list
    function _syncUserS6State(address userAddr) internal {
        UserInfo storage userInfo = users[userAddr];
        if (userInfo.participationTime == 0) return;

        bool shouldBeActive = userInfo.level == 6;
        bool wasActive      = userInfo.s6Active;

        if (wasActive == shouldBeActive) return;

        if (shouldBeActive) {
            s6PlayerList.push(userAddr);
            _s6PlayerIdx[userAddr] = s6PlayerList.length; // 1-indexed
            totalActiveS6Players++;
            userInfo.s6Active = true;
        } else {
            _removeFromS6List(userAddr);
            totalActiveS6Players--;
            userInfo.s6Active = false;
        }
    }

    // Removal from S6 player list
    function _removeFromS6List(address userAddr) private {
        uint256 idx = _s6PlayerIdx[userAddr];
        if (idx == 0) return;
        uint256 lastIdx = s6PlayerList.length;
        if (idx != lastIdx) {
            address last = s6PlayerList[lastIdx - 1];
            s6PlayerList[idx - 1] = last;
            _s6PlayerIdx[last] = idx;
        }
        s6PlayerList.pop();
        delete _s6PlayerIdx[userAddr];
    }

    // Query claimable S6 rewards
    function getClaimableS6Rewards(address userAddr) external view returns (uint256) {
        if (!users[userAddr].s6Active || totalActiveS6Players == 0) return 0;
        return IETIMTaxHook(etimTaxHook).sellTaxToS6() / totalActiveS6Players;
    }

    // Any S6 player triggers a full push distribution to all S6 players
    function claimS6Rewards() external nonReentrant {
        _checkAndUpdateLevel(msg.sender);
        if (!users[msg.sender].s6Active) revert NotParticipated();

        // Copy to memory
        address[] memory players = s6PlayerList;
        uint256 count = players.length;

        // Calculate floor-divisible amount
        uint256 available = IETIMTaxHook(etimTaxHook).sellTaxToS6();
        uint256 share = available / count;
        if (share == 0) revert NoRewardsToClaim();
        uint256 flushAmount = share * count;

        IETIMTaxHook(etimTaxHook).flushS6ToMain(flushAmount);

        for (uint256 i = 0; i < count; i++) {
            etimToken.safeTransfer(players[i], share);
            emit S6RewardClaimed(players[i], share);
        }
    }

    // =========================================================
    //                     GROWTH POOL
    // =========================================================

    // Release ETIM from growth pool to recipient
    function _releaseFromGrowthPool(address to, uint256 amount) internal {
        if (growthPoolReleased + amount > GROWTH_POOL_SUPPLY) revert GrowthPoolExceeded();
        growthPoolReleased += amount;
        etimToken.safeTransfer(to, amount);
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
    //                   PRICE & DAILY STATS
    // =========================================================

    // Update daily prices (called per day)
    function updateDailyPrice() external {
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
    //                   LP+BURN RATE-LIMITED ALLOCATION
    // =========================================================

    // Manually injects a ratio of pending LP and burn separately
    function triggerLpBurnAllocation() external nonReentrant {
        if (pendingLpEth == 0 && pendingSwapBurnEth == 0) revert NothingPending();
        if (block.timestamp < lpBurnLastTrigger + lpBurnCooldown) revert CooldownNotElapsed();

        uint256 lpAmount       = pendingLpEth       * lpBurnManualRatio / FEE_DENOMINATOR;
        uint256 swapBurnAmount = pendingSwapBurnEth * lpBurnManualRatio / FEE_DENOMINATOR;
        if (lpAmount == 0 && swapBurnAmount == 0) revert InvalidParams();

        pendingLpEth       -= lpAmount;
        pendingSwapBurnEth -= swapBurnAmount;
        lpBurnLastTrigger = block.timestamp;

        emit LpBurnManualTriggered(msg.sender, lpAmount, swapBurnAmount);

        if (lpAmount > 0) {
            weth.forceApprove(address(etimPoolHelper), lpAmount);
            etimPoolHelper.swapAndAddLiquidity(lpAmount);
        }
        if (swapBurnAmount > 0) {
            weth.forceApprove(address(etimPoolHelper), swapBurnAmount);
            etimPoolHelper.swapAndBurn(swapBurnAmount);
        }
    }

    // Manually injects exact amounts of LP and burn from pending
    function triggerLpBurnAllocationExact() external nonReentrant {
        uint256 lpAmount       = lpManualAmount;
        uint256 swapBurnAmount = swapBurnManualAmount;

        if (lpAmount == 0 && swapBurnAmount == 0) revert InvalidParams();
        if (pendingLpEth == 0 && pendingSwapBurnEth == 0) revert NothingPending();
        if (block.timestamp < lpBurnLastTrigger + lpBurnCooldown) revert CooldownNotElapsed();

        // Clamp to available pending amounts
        if (lpAmount > pendingLpEth)       lpAmount = pendingLpEth;
        if (swapBurnAmount > pendingSwapBurnEth) swapBurnAmount = pendingSwapBurnEth;
        if (lpAmount == 0 && swapBurnAmount == 0) revert InvalidParams();

        pendingLpEth       -= lpAmount;
        pendingSwapBurnEth -= swapBurnAmount;
        lpBurnLastTrigger = block.timestamp;

        emit LpBurnManualTriggered(msg.sender, lpAmount, swapBurnAmount);

        if (lpAmount > 0) {
            weth.forceApprove(address(etimPoolHelper), lpAmount);
            etimPoolHelper.swapAndAddLiquidity(lpAmount);
        }
        if (swapBurnAmount > 0) {
            weth.forceApprove(address(etimPoolHelper), swapBurnAmount);
            etimPoolHelper.swapAndBurn(swapBurnAmount);
        }
    }

    function setLpBurnCooldown(uint256 cooldown) external onlyOwner {
        lpBurnCooldown = cooldown;
    }

    function setLpBurnAutoRatio(uint256 ratio) external onlyOwner {
        if (ratio > FEE_DENOMINATOR) revert InvalidParams();
        lpBurnAutoRatio = ratio;
    }

    function setLpBurnManualRatio(uint256 ratio) external onlyOwner {
        if (ratio > FEE_DENOMINATOR) revert InvalidParams();
        lpBurnManualRatio = ratio;
    }

    function setLpBurnManualAmount(uint256 lpAmount, uint256 swapBurnAmount) external onlyOwner {
        lpManualAmount       = lpAmount;
        swapBurnManualAmount = swapBurnAmount;
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

    function setDailyMiningRate(uint256 rate) external onlyOwner {
        dailyMiningRate = rate;
    }

    function setMaxTeamDepth(uint256 depth) external onlyOwner {
        if (depth == 0) revert InvalidParams();
        maxTeamDepth = depth;
    }

    function setS0AccelerationRate(uint256 rate) external onlyOwner {
        s0AccelerationRate = rate;
    }

    function setDailyDepositRate(uint256 rate) external onlyOwner {
        dailyDepositRate = rate;
    }

    function setDailyDepositLimit(uint256 limit) external onlyOwner {
        dailyDepositLimit = limit;
    }

    function setLevelCondition(
        uint8   level,
        uint256 minDirectReferrals,
        uint256 minPersonalTokens,
        uint256 minTeamTokens,
        uint256 accelerationRate
    ) external onlyOwner {
        if (level > 6) revert InvalidParams();
        levelConditions[level] = LevelCondition(minDirectReferrals, minPersonalTokens, minTeamTokens, accelerationRate);
    }

    // withdraw foundation (WETH)
    function withdrawFoundation(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = foundationRewardEth;
        if (amount == 0) revert NothingToWithdraw();
        foundationRewardEth = 0;
        weth.safeTransfer(to, amount);
    }

    // withdraw pot (WETH)
    function withdrawPot(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = potRewardEth;
        if (amount == 0) revert NothingToWithdraw();
        potRewardEth = 0;
        weth.safeTransfer(to, amount);
    }

    // withdraw official (WETH)
    function withdrawOfficial(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = officialRewardEth;
        if (amount == 0) revert NothingToWithdraw();
        officialRewardEth = 0;
        weth.safeTransfer(to, amount);
    }

    // S2+/S3+ rewards are now claimed via claimS2PlusRewards() / claimS3PlusRewards() (pull mode)
    // Old withdrawS2PlusPendingEth / withdrawS3PlusPendingEth removed

    // =========================================================
    //                       VIEWS
    // =========================================================

    function getUserLevel(address user) external view returns (uint8) {
        return users[user].level;
    }

    // =========================================================
    //                       RECEIVE
    // =========================================================

    // Transfer 0 BNB → claim mining rewards; Transfer >0 BNB → auto-swap to WETH and deposit
    receive() external payable nonReentrant {
        if (msg.value == 0) {
            // 0 BNB: trigger claim
            _claimRewards(msg.sender);
            return;
        }

        // >0 BNB: swap BNB → WETH via PancakeSwap V2 Router, then deposit
        address[] memory path = new address[](2);
        path[0] = wbnb;
        path[1] = address(weth);

        uint256 wethBefore = weth.balanceOf(address(this));
        pancakeRouter.swapExactETHForTokens{value: msg.value}(
            0,              // accept any amount (slippage handled by deposit validation)
            path,
            address(this),
            block.timestamp
        );
        uint256 wethReceived = weth.balanceOf(address(this)) - wethBefore;

        _processParticipation(msg.sender, wethReceived);
    }

    // =========================================================
    //                       HELPERS
    // =========================================================

}