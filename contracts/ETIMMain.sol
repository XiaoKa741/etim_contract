// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IETIMTaxHook {
    function flushS6ToMain(uint256 amount) external;
    function sellTaxToS6() external view returns (uint256);
}

interface IETIMPoolHelper {
    function getEthReserves() external view returns (uint256);
    function getEtimPerEth() external view returns (uint256);
    function getUsdcPerEth() external view returns (uint256);
    function swapEthToEtim(uint256 ethAmount) external payable returns (uint256);
    function swapEtimToEth(uint256 etimAmount, address to) external returns (uint256);
    function swapAndAddLiquidity(uint256 ethAmount) external payable;
    function swapAndBurn(uint256 ethAmount) external payable;
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
    IERC721         public etimNode;
    IETIMPoolHelper public etimPoolHelper;
    address         public etimTaxHook;

    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // Total ETIM allocated to growth pool
    uint256 public constant GROWTH_POOL_SUPPLY = 87_700_000 * 10 ** 18;

    // Base participation params
    uint256 public participationAmountMin = 100 * 10**6; // 100 USD (6 decimals)
    uint256 public participationAmountMax = 150 * 10**6; // 150 USD (6 decimals)
    uint256 public dailyMiningRate = 1; // 0.1% = 1/1000

    // Deposit fee distribution ratios (denominator = 1000)
    uint256 public constant NODE_SHARE = 10;  // 1%
    uint256 public constant LP_SHARE = 690;   // 69%
    uint256 public constant BURN_SHARE = 250; // 25%
    uint256 public constant REWARD_SHARE = 50; // 5%
    uint256 public constant FEE_DENOMINATOR = 1000;

    // Deposit reward distribution ratios
    uint256 public constant REWARD_S2         = 300; // 30%
    uint256 public constant REWARD_S3         = 200; // 20%
    uint256 public constant REWARD_FOUNDATION = 300; // 30%
    uint256 public constant REWARD_POT        = 100; // 10%
    uint256 public constant REWARD_OFFICIAL   = 100; // 10%

    // Deposit reward stats
    uint256 public foundationRewardEth;
    uint256 public potRewardEth;
    uint256 public officialRewardEth;

    // LP+Burn rate-limited allocation
    uint256 public pendingLpEth       = 0;
    uint256 public pendingSwapBurnEth = 0;
    uint256 public lpBurnCooldown     = 15 minutes;
    uint256 public lpBurnLastTrigger  = 0;
    uint256 public lpBurnAutoRatio    = 1000; // ratio applied to LP and burn portions separately (denominator 1000)

    // Node reward tracking
    uint256 public constant NODE_QUOTA = 300 * 10 ** 6;
    uint256 public rewardPerNode;
    uint256 public nodeDistributionDust;        // carry-over remainder from integer division
    uint256 public totalActiveNodes;

    // S2+ player reward tracking
    uint256 public s2PlusPoolEth;               // ETH accumulated, pending push distribution
    uint256 public totalActiveS2PlusPlayers;
    address[] public s2PlusPlayerList;          // all current S2+ players
    mapping(address => uint256) private _s2PlusPlayerIdx; // 1-indexed, 0 = not in list

    // S3+ player reward tracking
    uint256 public s3PlusPoolEth;               // ETH accumulated, pending push distribution
    uint256 public totalActiveS3PlusPlayers;
    address[] public s3PlusPlayerList;          // all current S3+ players
    mapping(address => uint256) private _s3PlusPlayerIdx; // 1-indexed, 0 = not in list

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

    // S2+ pending ETH withdrawals (push failed, pull to claim)
    mapping(address => uint256) public s2PlusPendingEth;
    // S3+ pending ETH withdrawals (push failed, pull to claim)
    mapping(address => uint256) public s3PlusPendingEth;

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
    event S2PlusEthTransferFailed(address indexed user, uint256 amount);
    event S3PlusEthTransferFailed(address indexed user, uint256 amount);
    event S2PlusPendingEthWithdrawn(address indexed user, uint256 amount);
    event S3PlusPendingEthWithdrawn(address indexed user, uint256 amount);

    constructor(
        address _etimToken,
        address _etimNode,
        address _etimPoolHelper,
        address _etimTaxHook
    ) Ownable(msg.sender) {
        etimToken      = IERC20(_etimToken);
        etimNode       = IERC721(_etimNode);
        etimPoolHelper = IETIMPoolHelper(_etimPoolHelper);
        etimTaxHook    = _etimTaxHook;

        _initializeLevelConditions();
    }

    // Initialize membership level conditions
    function _initializeLevelConditions() private {
        levelConditions[0] = LevelCondition(0,  0,               0,                 3);
        levelConditions[1] = LevelCondition(5,  30000  * 10**18, 300000  * 10**18,  7);
        levelConditions[2] = LevelCondition(10, 50000  * 10**18, 1000000 * 10**18, 10);
        levelConditions[3] = LevelCondition(15, 100000 * 10**18, 2000000 * 10**18, 12);
        levelConditions[4] = LevelCondition(20, 150000 * 10**18, 3000000 * 10**18, 15);
        levelConditions[5] = LevelCondition(25, 200000 * 10**18, 4000000 * 10**18, 18);
        levelConditions[6] = LevelCondition(30, 300000 * 10**18, 5000000 * 10**18, 21);
    }

    // User deposits ETH to participate
    function deposit() external payable nonReentrant {
        _processParticipation(msg.sender, msg.value);
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

    // Allocate ETH: node/reward immediate; LP(69%) + burn(25%) rate-limited via pending
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

        // Immediate distributions
        if (nodeEth > 0)       _distributeNodeRewards(etimPoolHelper.swapEthToEtim{value: nodeEth}(nodeEth));
        if (s2Eth > 0)         _distributeS2PlusRewards(s2Eth);
        if (s3Eth > 0)         _distributeS3PlusRewards(s3Eth);
        if (foundationEth > 0) foundationRewardEth += foundationEth;
        if (potEth > 0)        potRewardEth        += potEth;
        if (officialEth > 0)   officialRewardEth   += officialEth;

        // LP + burn: player deposits always inject the ratio portion immediately (no cooldown)
        uint256 lpInject       = lpEth       * lpBurnAutoRatio / FEE_DENOMINATOR;
        uint256 swapBurnInject = swapBurnEth * lpBurnAutoRatio / FEE_DENOMINATOR;

        pendingLpEth       += lpEth       - lpInject;
        pendingSwapBurnEth += swapBurnEth - swapBurnInject;
        
        if (lpInject > 0)       etimPoolHelper.swapAndAddLiquidity{value: lpInject}(lpInject);
        if (swapBurnInject > 0) etimPoolHelper.swapAndBurn{value: swapBurnInject}(swapBurnInject);
    }


    // Manual sync level
    function syncLevel() external {
        _checkAndUpdateLevel(msg.sender);
    }

    // Manual sync team token balance
    function syncTeamBalance() external {
        address[] memory referrals = referralsOfList[msg.sender];
        uint256 total = 0;
        for (uint256 i = 0; i < referrals.length; i++) {
            total += etimToken.balanceOf(referrals[i]);
        }
        users[msg.sender].teamTokenBalance = total;
        _checkAndUpdateLevel(msg.sender);
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

    // Claim mining rewards
    function claim() external nonReentrant {
        UserInfo storage user = users[msg.sender];
        if (user.participationTime == 0) revert NotParticipated();
        if (user.claimedValueInUsd >= user.investedValueInUsd) revert NoRemainingValue();

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

        uint256 remainingValueInUsd = user.investedValueInUsd - user.claimedValueInUsd;
        if (remainingValueInUsd == 0) return (0, 0);

        uint256 startDay = user.lastClaimTime / 1 days * 1 days;
        uint256 endDay   = block.timestamp    / 1 days * 1 days;

        uint256 accelerationRate = levelConditions[user.level].accelerationRate;
        uint256 rewardInEtim     = 0;
        uint256 initialRemaining = remainingValueInUsd;

        for (uint256 t = startDay; t < endDay; t += 1 days) {
            uint256 dailyUsd = (user.investedValueInUsd * dailyMiningRate) / 1000;
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
    //                     S2+ PLAYERS
    // =========================================================

    // Accumulate ETH into pool
    function _distributeS2PlusRewards(uint256 ethAmount) internal {
        if (totalActiveS2PlusPlayers > 0) {
            s2PlusPoolEth += ethAmount;
        }
    }

    // Sync user's S2+ status and maintain player list
    function _syncUserS2PlusState(address userAddr) internal {
        UserInfo storage userInfo = users[userAddr];
        if (userInfo.participationTime == 0) return;

        bool shouldBeActive = userInfo.level >= 2;
        bool wasActive      = userInfo.s2PlusActive;

        if (wasActive == shouldBeActive) return;

        if (shouldBeActive) {
            s2PlusPlayerList.push(userAddr);
            _s2PlusPlayerIdx[userAddr] = s2PlusPlayerList.length; // 1-indexed
            totalActiveS2PlusPlayers++;
            userInfo.s2PlusActive = true;
        } else {
            _removeFromS2PlusList(userAddr);
            totalActiveS2PlusPlayers--;
            userInfo.s2PlusActive = false;
        }
    }

    // Removal from player list
    function _removeFromS2PlusList(address userAddr) private {
        uint256 idx = _s2PlusPlayerIdx[userAddr];
        if (idx == 0) return;
        uint256 lastIdx = s2PlusPlayerList.length;
        if (idx != lastIdx) {
            address last = s2PlusPlayerList[lastIdx - 1];
            s2PlusPlayerList[idx - 1] = last;
            _s2PlusPlayerIdx[last] = idx;
        }
        s2PlusPlayerList.pop();
        delete _s2PlusPlayerIdx[userAddr];
    }

    // Query claimable S2+ rewards (view)
    function getClaimableS2PlusRewards(address userAddr) external view returns (uint256) {
        if (!users[userAddr].s2PlusActive || totalActiveS2PlusPlayers == 0) return 0;
        return s2PlusPoolEth / totalActiveS2PlusPlayers;
    }

    // Any S2+ player triggers a full push distribution to all S2+ players
    function claimS2PlusRewards() external nonReentrant {
        _checkAndUpdateLevel(msg.sender);
        if (!users[msg.sender].s2PlusActive) revert NotParticipated();
        uint256 total = s2PlusPoolEth;
        if (total == 0) revert NoRewardsToClaim();

        address[] memory players = s2PlusPlayerList;
        uint256 count = players.length;

        uint256 share = total / count;
        s2PlusPoolEth = total - share * count; // dust accumulates

        if (share == 0) revert NoRewardsToClaim();

        for (uint256 i = 0; i < count; i++) {
            address player = players[i];
            (bool ok,) = player.call{value: share}("");
            if (ok) {
                emit S2PlusRewardClaimed(player, share);
            } else {
                s2PlusPendingEth[player] += share;
                emit S2PlusEthTransferFailed(player, share);
            }
        }
    }

    // =========================================================
    //                     S3+ PLAYERS
    // =========================================================

    // Accumulate ETH into pool
    function _distributeS3PlusRewards(uint256 ethAmount) internal {
        if (totalActiveS3PlusPlayers > 0) {
            s3PlusPoolEth += ethAmount;
        }
    }

    // Sync user's S3+ status and maintain player list
    function _syncUserS3PlusState(address userAddr) internal {
        UserInfo storage userInfo = users[userAddr];
        if (userInfo.participationTime == 0) return;

        bool shouldBeActive = userInfo.level >= 3;
        bool wasActive      = userInfo.s3PlusActive;

        if (wasActive == shouldBeActive) return;

        if (shouldBeActive) {
            s3PlusPlayerList.push(userAddr);
            _s3PlusPlayerIdx[userAddr] = s3PlusPlayerList.length; // 1-indexed
            totalActiveS3PlusPlayers++;
            userInfo.s3PlusActive = true;
        } else {
            _removeFromS3PlusList(userAddr);
            totalActiveS3PlusPlayers--;
            userInfo.s3PlusActive = false;
        }
    }

    // Removal from player list
    function _removeFromS3PlusList(address userAddr) private {
        uint256 idx = _s3PlusPlayerIdx[userAddr];
        if (idx == 0) return;
        uint256 lastIdx = s3PlusPlayerList.length;
        if (idx != lastIdx) {
            address last = s3PlusPlayerList[lastIdx - 1];
            s3PlusPlayerList[idx - 1] = last;
            _s3PlusPlayerIdx[last] = idx;
        }
        s3PlusPlayerList.pop();
        delete _s3PlusPlayerIdx[userAddr];
    }

    // Query claimable S3+ rewards (view)
    function getClaimableS3PlusRewards(address userAddr) external view returns (uint256) {
        if (!users[userAddr].s3PlusActive || totalActiveS3PlusPlayers == 0) return 0;
        return s3PlusPoolEth / totalActiveS3PlusPlayers;
    }

    // Any S3+ player triggers a full push distribution to all S3+ players
    function claimS3PlusRewards() external nonReentrant {
        _checkAndUpdateLevel(msg.sender);
        if (!users[msg.sender].s3PlusActive) revert NotParticipated();
        uint256 total = s3PlusPoolEth;
        if (total == 0) revert NoRewardsToClaim();

        address[] memory players = s3PlusPlayerList;
        uint256 count = players.length;

        uint256 share = total / count;
        s3PlusPoolEth = total - share * count; // dust accumulates

        if (share == 0) revert NoRewardsToClaim();

        for (uint256 i = 0; i < count; i++) {
            address player = players[i];
            (bool ok,) = player.call{value: share}("");
            if (ok) {
                emit S3PlusRewardClaimed(player, share);
            } else {
                s3PlusPendingEth[player] += share;
                emit S3PlusEthTransferFailed(player, share);
            }
        }
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
    //                   LP+BURN RATE-LIMITED ALLOCATION
    // =========================================================

    // Owner manually injects a ratio of pending LP and burn separately
    function triggerLpBurnAllocation(uint256 ratio) external onlyOwner nonReentrant {
        if (ratio == 0 || ratio > FEE_DENOMINATOR) revert InvalidParams();
        if (pendingLpEth == 0 && pendingSwapBurnEth == 0) revert NothingPending();
        if (block.timestamp < lpBurnLastTrigger + lpBurnCooldown) revert CooldownNotElapsed();

        uint256 lpAmount       = pendingLpEth       * ratio / FEE_DENOMINATOR;
        uint256 swapBurnAmount = pendingSwapBurnEth * ratio / FEE_DENOMINATOR;
        if (lpAmount == 0 && swapBurnAmount == 0) revert InvalidParams();

        pendingLpEth       -= lpAmount;
        pendingSwapBurnEth -= swapBurnAmount;
        lpBurnLastTrigger = block.timestamp;

        if (lpAmount > 0)       etimPoolHelper.swapAndAddLiquidity{value: lpAmount}(lpAmount);
        if (swapBurnAmount > 0) etimPoolHelper.swapAndBurn{value: swapBurnAmount}(swapBurnAmount);
    }

    // Owner injects exact amounts of LP and burn from pending (at least one non-zero, clamped to available)
    function triggerLpBurnAllocationExact(uint256 lpAmount, uint256 swapBurnAmount) external onlyOwner nonReentrant {
        if (lpAmount == 0 && swapBurnAmount == 0) revert InvalidParams();
        if (pendingLpEth == 0 && pendingSwapBurnEth == 0) revert NothingPending();
        if (block.timestamp < lpBurnLastTrigger + lpBurnCooldown) revert CooldownNotElapsed();

        // Clamp to available pending amounts
        if (lpAmount > pendingLpEth)       lpAmount = pendingLpEth;
        if (swapBurnAmount > pendingSwapBurnEth) swapBurnAmount = pendingSwapBurnEth;

        pendingLpEth       -= lpAmount;
        pendingSwapBurnEth -= swapBurnAmount;
        lpBurnLastTrigger = block.timestamp;

        if (lpAmount > 0)       etimPoolHelper.swapAndAddLiquidity{value: lpAmount}(lpAmount);
        if (swapBurnAmount > 0) etimPoolHelper.swapAndBurn{value: swapBurnAmount}(swapBurnAmount);
    }

    function setLpBurnCooldown(uint256 cooldown) external onlyOwner {
        lpBurnCooldown = cooldown;
    }

    function setLpBurnAutoRatio(uint256 ratio) external onlyOwner {
        if (ratio > FEE_DENOMINATOR) revert InvalidParams();
        lpBurnAutoRatio = ratio;
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

    // withdraw foundation
    function withdrawFoundation(address payable to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = foundationRewardEth;
        if (amount == 0) revert NothingToWithdraw();
        foundationRewardEth = 0;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // withdraw pot
    function withdrawPot(address payable to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = potRewardEth;
        if (amount == 0) revert NothingToWithdraw();
        potRewardEth = 0;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // withdraw official
    function withdrawOfficial(address payable to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = officialRewardEth;
        if (amount == 0) revert NothingToWithdraw();
        officialRewardEth = 0;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // Withdraw S2+ pending ETH (fallback for failed push transfers)
    function withdrawS2PlusPendingEth() external nonReentrant {
        uint256 amount = s2PlusPendingEth[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        s2PlusPendingEth[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit S2PlusPendingEthWithdrawn(msg.sender, amount);
    }

    // Withdraw S3+ pending ETH (fallback for failed push transfers)
    function withdrawS3PlusPendingEth() external nonReentrant {
        uint256 amount = s3PlusPendingEth[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        s3PlusPendingEth[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit S3PlusPendingEthWithdrawn(msg.sender, amount);
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