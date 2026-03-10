# ETIM 智能合约 QA 报告

> 生成日期：2026-03-09
> 审计范围：`contracts/ETIMMain.sol`、`contracts/ETIMToken.sol`、`contracts/ETIMTaxHook.sol`、`contracts/ETIMPoolHelper.sol`、`contracts/ETIMNode.sol`
> 参考规格：`ETIM_SPEC.md`（已确认版）
> 现有测试文件：**无**（`test/` 目录不存在）

---

## 总体摘要

| 模块 | 状态 | 问题数 |
|------|------|--------|
| A. 代币分配 | ❌ 问题 | 1 |
| B. 入场流程 | ❌ 问题 | 3 |
| C. 奖励池 5% ETH 分配 | ✅ 通过 | 0 |
| D. 挖矿（增长池释放） | ❌ 问题 | 2 |
| E. 会员等级 | ❌ 问题 | 3 |
| F. 邀请绑定 | ❌ 问题 | 2 |
| G. 节点 NFT | ❌ 问题 | 2 |
| H. 买卖规则 | ❌ 问题 | 4 |
| I. 储蓄池延迟模式 | ❌ 问题 | 1 |
| J. 价格更新 | ⚠️ 疑问 | 1 |
| K. 安全性 | ❌ 问题 | 3 |

**合计：发现 22 个问题，3 个待确认事项。**

---

## A. 代币分配

### ❌ A-1：ETIMToken 未验证增长池分配，所有代币铸造给 `msg.sender`

**问题描述**
`ETIMToken.sol` 第 44 行：
```solidity
_mint(msg.sender, TOTAL_SUPPLY);
```
合约将 2,100,000,000 ETIM 全量铸造给部署者，没有按照规格的 6 路分配（增长池 91.7%、Market Infra 5%、生态基金 1% 等）在构造函数中分发到对应地址。规格注释虽以常量形式标注，但全部被注释掉（第 22-27 行），实际上合约依赖部署者在部署后手动转账，**无链上强制保证**。

**影响**
- 部署者可任意挪用本应锁定给增长池的 1,925,700,000 ETIM，增长池的上限仅靠 `ETIMMain` 中 `GROWTH_POOL_SUPPLY` 常量约束，但前提是部署者必须向 `ETIMMain` 转入足量代币。
- 各分配比例（Market Infra、生态基金、社区建设、空投、以太坊基金会）无链上执行，存在 rug pull 风险。

**涉及文件**
`contracts/ETIMToken.sol` 第 40-45 行

---

## B. 入场流程

### ❌ B-1：每日限额检查逻辑错误——应在累加后检查，而非累加前

**问题描述**
`ETIMMain.sol` 第 208 行：
```solidity
if (dailyDepositTotal > effectiveCap * dailyDepositRate / FEE_DENOMINATOR) revert DailyDepositLimitExceeded();
```
检查的是**本次存款之前**的累计值，而非本次存入后的值。这意味着当累计恰好等于上限时不会拒绝，允许多超一笔，且超额大小正好是当前这笔入场金额。

**正确逻辑应为**：
```solidity
if (dailyDepositTotal + ethAmount > effectiveCap * dailyDepositRate / FEE_DENOMINATOR) revert ...;
```

**影响**
每日实际可接受的存款总量略超规格的 20% 上限，具体超出量为最后一笔入场金额（最大约 150U 等值 ETH）。

**涉及文件**
`contracts/ETIMMain.sol` 第 205-208 行

---

### ❌ B-2：延迟模式下 `pendingAllocationInEth` 从未减少

**问题描述**
在 `_processParticipation`（第 224-225 行）中，延迟模式会累加 `pendingAllocationInUsd` 和 `pendingAllocationInEth`：
```solidity
pendingAllocationInUsd += participationValueInUsd;
pendingAllocationInEth += ethAmount;
```
但 `triggerDelayedAllocation`（第 640-676 行）在执行后仅扣减 `pendingAllocationInUsd`（第 675 行），**从未扣减 `pendingAllocationInEth`**：
```solidity
pendingAllocationInUsd -= usdValue;
// pendingAllocationInEth 从未减少
```

**影响**
`pendingAllocationInEth` 永久累增，无法反映真实待分配 ETH 量，导致合约状态不一致，同时 `pendingAllocationInEth` 对应的 ETH 实际上被"卡"在合约中（合约收到 ETH 却未在 `triggerDelayedAllocation` 中使用 `pendingAllocationInEth`，该函数通过 USD 价格重新计算 ETH 量，因此 ETH 可能因汇率差异而留存于合约无法取出）。

**涉及文件**
`contracts/ETIMMain.sol` 第 224-225 行、第 646-676 行

---

### ❌ B-3：`triggerDelayedAllocation` 发送 ETH 给 PoolHelper 时合约余额可能不足

**问题描述**
`triggerDelayedAllocation` 按当前 USD 价格重新将 `usdValue` 换算成 `ethAmount`（第 646 行）：
```solidity
uint256 ethAmount = (usdValue * 10 ** 18) / ethPriceInUsd;
```
但实际锁在合约中的是入场时的 ETH（`pendingAllocationInEth`）。若 ETH 价格上涨（相对于入场时），换算出的 `ethAmount` 会小于实际锁定的 ETH；若 ETH 价格下跌，换算出的 `ethAmount` 会大于实际锁定的 ETH，导致合约 ETH 余额不足，调用 PoolHelper 时 revert。

同时，函数本身不是 `payable`，没有任何检查确保合约 ETH 余额 ≥ `nodeEth + lpEth + burnEth + rewardEth`。

**影响**
价格波动可能导致 `triggerDelayedAllocation` 调用失败（余额不足），或 ETH 永久滞留合约（价格上涨时多余 ETH 无提取接口）。

**涉及文件**
`contracts/ETIMMain.sol` 第 640-676 行

---

## C. 奖励池 5% ETH 四路分配

### ✅ C-1：分配比例正确（S2 50% / 基金会 30% / 奖池 10% / 官方 10%）

`ETIMMain.sol` 第 66-69 行常量定义与规格一致。

### ✅ C-2：四个提取函数均已实现

`withdrawS2`、`withdrawFoundation`、`withdrawPot`、`withdrawOfficial` 均有完整实现（第 698-735 行），带 `nonReentrant` 和零地址检查。

### ⚠️ C-3：S2 奖励直接由 owner 转给指定地址，非"均摊给 S2+ 激活节点持有者"

规格 2.5 节描述 S2 那 50% 应"均摊给所有达到 S2 及以上等级的激活节点持有者"，但 `withdrawS2` 只是将 `s2RewardEth` 整体发给 owner 指定地址（`to`），由 owner 线下分配。这并未在链上实现均摊逻辑。**此问题归入"待确认事项"**（见文末）。

---

## D. 挖矿（增长池释放）

### ❌ D-1：挖矿加速计算与规格不符——加速的是 `dailyUsd`，但规格要求以 `investedValueInUsd` 为基础

**问题描述**
规格 3.2 节：
> 实际日产出 = 基础日产出 × (1 + 加速%)

`_calculatePendingRewards` 第 342-343 行：
```solidity
uint256 dailyUsd = (user.investedValueInUsd * dailyReleaseRate) / 1000;
dailyUsd += (dailyUsd * accelerationRate) / 100;
```
计算逻辑：`dailyUsd = base + base * rate/100 = base * (1 + rate/100)`，**这是正确的**。

但加速的 `accelerationRate` 取自 `levelConditions[user.level].accelerationRate`（第 337 行），该值在 `_checkAndUpdateLevel` 中是在 `claim()` 被调用时才更新的。**关键问题**：`_calculatePendingRewards` 是一个 `view` 函数，使用的是**当前时刻的等级**，而非历史各天对应的等级。如果用户等级在某天升级，之前的每一天都会被"追溯"使用更高的加速率计算，导致已产出量被高估。

**影响**
用户升级后，其历史未 claim 的天数将以新等级的加速率重新计算，实际可 claim 量超出应有量，对增长池造成超额释放。

**涉及文件**
`contracts/ETIMMain.sol` 第 324-354 行，尤其第 337、342-343 行

---

### ❌ D-2：增长池耗尽后 `_calculatePendingRewards` 直接返回 (0,0)，但 `claimedValueInUsd` 未更新，导致用户失去应得奖励

**问题描述**
`_calculatePendingRewards` 第 328 行：
```solidity
if (isGrowthPoolDepleted()) return (0, 0);
```
若增长池恰好在某天耗尽，用户当天 claim 时直接得 0，但 `claimedValueInUsd` 不会更新（因为 `pendingEtim == 0` 时 revert `NoRewardsToClaim`，第 298 行），导致用户在增长池恢复（如有）或协议规则变更前永久无法领取已累积的奖励记账。

更严重的是：规格说"增长池耗尽后才开放购买接口"（规格 7.1），增长池耗尽是正常生命周期事件，此处的处理会使用户丢失已经按天累计但尚未 claim 的 USD 价值。

**影响**
增长池耗尽时，用户所有未 claim 的挖矿奖励全部清零，不符合规格中"懒结算"设计的初衷（已计账的部分应允许结算）。

**涉及文件**
`contracts/ETIMMain.sol` 第 327-329 行

---

## E. 会员等级

### ❌ E-1：S1 等级条件被测试数据覆盖，生产环境未恢复

**问题描述**
`_initializeLevelConditions` 第 181 行：
```solidity
levelConditions[1] = LevelCondition(1, 0, 0, 7);   // for test
// levelConditions[1] = LevelCondition(5, 50000 * 10**18, 500000 * 10**18, 7);
```
S1 条件被修改为仅需 1 个直推、0 持仓、0 团队币量（注释说明是测试用）。生产部署时该行未恢复，**所有用户只要有 1 个直推即可达到 S1**，严重偏离规格（规格要求 5 人直推 / 5 万持仓 / 50 万团队币量）。

**影响**
S1 条件过低会导致：大量用户获得节点激活资格（只需 S1）；S1 加速率（7%）过早获得；整个等级体系失去经济意义。

**涉及文件**
`contracts/ETIMMain.sol` 第 180-181 行

---

### ❌ E-2：团队币量"嵌套穿透中止"逻辑**完全未实现**

**问题描述**
规格 4.2 节和 5.2 节明确要求：
> 团队币量只统计到有嵌套（某成员自己达到同等或更高等级）时中止，不无限向下穿透。
> 示例：A→B→C，若 B 已是 S1，则 A 计算团队时不再把 C 的持仓算进去。

当前实现：`_propagateTeamBalanceChange`（第 499-512 行）只向上传播**一层**（传给直接上级 `referrerOf[user]`），没有递归向更高层传播，且**完全没有任何嵌套中止判断**。`teamTokenBalance` 是每次代币转移时增量更新的，没有按等级做穿透中止。

结论：**团队币量是无限向上传播的**（每个 ERC20 转移都会通知直接上级，但不会通知更高层级），这与规格的"只传到直接上级"不同，且规格要求的中止逻辑在任何地方均未实现。

**影响**
当前实现中，团队 token balance 只统计直接下级（因为只传一层），而非整个团队树（这与规格的"递归统计但遇到同级停止"不同）。实际上可能导致高等级用户的 `teamTokenBalance` 偏低（少计了间接下级），使升级更难——但核心的"嵌套中止"业务逻辑完全缺失。

**涉及文件**
`contracts/ETIMMain.sol` 第 479-512 行

---

### ❌ E-3：个人持仓条件使用实时余额，但增长池释放后余额会随市场波动下降导致降级

**问题描述**
`_checkAndUpdateLevel` 第 456 行：
```solidity
uint256 personalTokens = etimToken.balanceOf(user);
```
等级检查依赖实时余额，用户若卖出 ETIM 导致余额低于门槛则自动降级。这是常见设计，但规格未明确说明是否允许降级。此处作为**待确认事项**列出（见文末）。

---

## F. 邀请绑定

### ❌ F-1：`_processReferralBinding` 中 `inviteePreBalance` 计算存在逻辑错误

**问题描述**
第 432-435 行，绑定建立时用当前余额反推入账前余额：
```solidity
uint256 inviteePreBalance = (invitee == from)
    ? inviteeCurrentBalance + value
    : (inviteeCurrentBalance >= value ? inviteeCurrentBalance - value : 0);
```
这里试图计算被邀请方在**本次转账发生之前**的余额，并将其加入 referrer 的 `teamTokenBalance`。但是：

1. 此函数在 `onTokenTransfer` 中调用，而 `onTokenTransfer` 是在 `_update`（ERC20 transfer 执行后）触发的（`ETIMToken.sol` 第 64-68 行），即此时转账已完成。
2. 当绑定触发的是"reverseTime"方向（B 向 A 转账时建立关系），`invitee` 可能是 `to`（接收方），此时 `inviteeCurrentBalance = balanceOf(invitee)` 是**已经加上本次转账后的值**，减去 `value` 得到的是转账前的余额——这对于 invitee 是 `to` 的场景是正确的。
3. 但当 invitee 是 `from`（发送方）时，`inviteeCurrentBalance + value` 实际上是正确的（转账后余额 + 本次扣除量 = 转账前余额）。

**真正的问题**：`_processReferralBinding` 使用 `inviteePreBalance` 初始化 `users[referrer].teamTokenBalance`，但此后的 `_updateTeamTokenBalance`（同一 `onTokenTransfer` 调用中，第 392 行）也会再次更新 `teamTokenBalance`，导致**双重计数**。

具体路径：
- `onTokenTransfer(from, to, value)` 调用顺序（第 391-394 行）：
  1. `_processReferralBinding(from, to, value)` → 建立绑定，设置 `teamTokenBalance += inviteePreBalance`
  2. `_updateTeamTokenBalance(from, to, value)` → 统计本次转账的余额变动，又累加一次

**影响**
绑定建立时 referrer 的 `teamTokenBalance` 被计算两次（一次是 inviteePreBalance，一次是本次转账的余额变化），导致团队币量初始值偏高，用户可能提前达到升级条件。

**涉及文件**
`contracts/ETIMMain.sol` 第 384-395 行、第 432-444 行、第 480-496 行

---

### ❌ F-2：`_updateTeamTokenBalance` 只传播一层，团队币量无法体现多级结构

**问题描述**
`_propagateTeamBalanceChange`（第 499-512 行）只向直接上级传播一次余额变化，没有继续向上级的上级递归传播。

规格要求"团队币量 = 从用户往下递归统计（遇到同级停止）"，意味着 A 的团队应包括 B、C、D……（多层），每个人的余额变化都应向其所有上级（直至根节点或遇到同级）传播。

当前实现：C 的余额变化只通知 B（直接上级），A 的 `teamTokenBalance` 对 C 的变化无感知。

**影响**
所有非直接下级的团队成员余额变化无法汇聚到上级，实际 `teamTokenBalance` 严重偏低，会员等级难以达到高层（S3-S6），整个推荐体系激励机制失效。

**涉及文件**
`contracts/ETIMMain.sol` 第 499-512 行

---

## G. 节点 NFT

### ❌ G-1：节点奖励债务（`nodeRewardDebt`）使用 `rewardPerNode * oldCount` 计算存在溢出风险，且新节点加入时债务设置逻辑错误

**问题描述**
`_syncUserNodes` 第 540-545 行：
```solidity
uint256 accumulated = rewardPerNode * oldCount;
uint256 pending     = accumulated > userInfo.nodeRewardDebt
    ? accumulated - userInfo.nodeRewardDebt
    : 0;
userInfo.pendingNodeRewards += pending;
userInfo.nodeRewardDebt      = accumulated;
```
此处 `userInfo.nodeRewardDebt` 的含义是"用户上次结算时对应的累计奖励基准"，标准的 Masterchef 模式应为 `rewardPerNode * count`。当 `oldCount != newCount` 时（第 554-555 行）：
```solidity
userInfo.syncedNodeCount = newCount;
userInfo.nodeRewardDebt  = rewardPerNode * newCount;
```
**问题**：第 540-545 行已将 `nodeRewardDebt` 更新为 `rewardPerNode * oldCount`，紧接着第 555 行又覆盖为 `rewardPerNode * newCount`。若 `oldCount == 0`（第一次 sync），则第 539 行 `if (oldCount > 0)` 跳过，第 555 行将 `nodeRewardDebt` 设为 `rewardPerNode * newCount`，这是正确的（新用户不应获取历史奖励）。

但若用户有 `oldCount > 0` 且 `newCount != oldCount`，执行流程为：
1. 第 540-545：结算旧 count 的奖励，`nodeRewardDebt = rewardPerNode * oldCount`
2. 第 555：`nodeRewardDebt = rewardPerNode * newCount`（**正确覆盖**）

这实际上是正确的。**但存在另一个问题**：当 `oldCount > 0 && oldCount == newCount` 时（第 548 行 `return`），函数在结算后提前返回，不更新 `nodeRewardDebt` 到最新值——**实际上第 544-545 行已经更新了 `nodeRewardDebt = accumulated`**，这是正确的，`accumulated = rewardPerNode * oldCount` 也就是最新基准。

重新审视后，实际问题是：`rewardPerNode` 是全局单调递增的无界整数，随着时间推移会变得非常大，`rewardPerNode * newCount` 可能溢出（Solidity 0.8+ 会 revert）。这在节点数量为 500、长期运营后 `rewardPerNode` 可能达到极大值时是潜在风险。

**影响**
长期运营后可能导致 `_syncUserNodes` 因乘法溢出而 revert，节点奖励永久无法领取。

**涉及文件**
`contracts/ETIMMain.sol` 第 531-556 行

---

### ❌ G-2：`claimNodeRewards` 从增长池外转移代币，节点奖励来源与规格不一致

**问题描述**
`claimNodeRewards` 第 573 行：
```solidity
etimToken.safeTransfer(user, amount);
```
规格 6.3 节说节点业绩奖励来自"每笔入场的 1% ETH swap 成 ETIM"，即 `_distributeNodeRewards` 分发的是 ETIM。合约中 `_distributeNodeRewards` 只更新 `rewardPerNode`（第 526 行），不实际转移 ETIM；真正转移发生在 `claimNodeRewards` 中，直接从合约 ETIM 余额发出。

但 `growthPoolReleased` 没有在 `claimNodeRewards` 中增加（只有 `_releaseFromGrowthPool` 会更新），意味着**节点奖励的 ETIM 来自合约整体余额，不受增长池上限约束，且不计入 `growthPoolReleased`**。

**影响**
节点奖励绕过了增长池的供应限制，实际上是从部署者存入合约的 ETIM 中任意转出，存在超发风险。规格中节点奖励是入场资金的一部分（1% ETH→ETIM），不应额外消耗增长池，这点从设计上是合理的，但合约 ETIM 余额需要足够支持所有节点奖励的发放，**缺少余额充足性保障**。

**涉及文件**
`contracts/ETIMMain.sol` 第 563-574 行、第 524-528 行

---

## H. 买卖规则

### ❌ H-1：`_afterSwap` 税收逻辑被完全注释掉，买税实际无法生效（买税在 `_beforeSwap` 收取，但对用户输出无影响）

**问题描述**
`ETIMTaxHook.sol` 第 164-216 行，`_afterSwap` 中所有有效逻辑均被注释掉：
```solidity
return (this.afterSwap.selector, 0);
/*  ... 所有税收逻辑 ... */
```
买税虽然在 `_beforeSwap` 中通过 `poolManager.take` 截取（第 260 行），但这是对**输入端**（ETH）扣税，而不是对用户**输出的 ETIM** 扣税。规格 7.1 节"3% 买入税"应从用户收到的 ETIM 中扣除，但注释掉的 `_afterSwap` 才负责从输出端扣减，当前代码实际是对 ETH 输入扣税。

这两种扣税方式效果不同：对输入 ETH 扣税意味着用户的 ETH 变少（3% ETH 被留在 hook），然后剩余 ETH 去 swap；对输出 ETIM 扣税意味着用户拿到的 ETIM 变少。当前实现会导致用 97% ETH 去 swap，hook 留 3% ETH，**而 `withdrawBuyTax` 是以 ETH 形式提取的**（第 369-376 行），这与规格"买入税归官方钱包（ETH 计）"是一致的。所以买税的实现是正确的，但应标记 `_afterSwap` 注释是否为最终状态。

**实际问题**：`_afterSwap` 注释掉后 `afterSwapReturnDelta: true` 的 hook 权限被申请但从不使用（返回 0），这不会造成错误，但是虚申请了 hook 权限。

**影响**
功能上买税可以正常工作（在 beforeSwap 阶段截取 ETH），但代码状态混乱（注释掉的巨量逻辑），维护性差。

**涉及文件**
`contracts/ETIMTaxHook.sol` 第 164-216 行

---

### ❌ H-2：卖出税分配比例与规格不符

**问题描述**
规格 7.2 节：
| 接收方 | 比例 |
|--------|------|
| S6+ 用户奖励池 | 0.5%（占总卖出额 3% 的 16.7%） |
| 销毁 | 1.5%（占 50%） |
| 官方钱包 | 0.5%（占 16.7%） |
| 基金会 | 0.5%（占 16.7%） |

代码 `_beforeSwap` 第 267-270 行（占税额的比例）：
```solidity
uint256 toS6        = taxAmount * 17 / 100;   // 17%
uint256 toFundation = taxAmount * 17 / 100;   // 17%
uint256 toOfficial  = taxAmount * 16 / 100;   // 16%
uint256 toBurn      = taxAmount - toS6 - toFundation - toOfficial; // 50%
```

规格要求 S6、基金会、官方各 16.7%（≈1/6），销毁 50%。代码实现 S6=17%、基金会=17%、官方=16%，**三者合计 50%，销毁 50%**——数值上接近，但规格明确三者应各 16.7%，当前代码 S6 和基金会多分 0.33%，官方少分 0.67%。此外规格说三者各 0.5%（即各占税额的 16.667%），代码用整数近似（17/17/16），存在约 0.33% 的分配误差。

**影响**
每笔卖出税的分配精度有轻微误差，长期累积可能导致各方收益偏差。

**涉及文件**
`contracts/ETIMTaxHook.sol` 第 267-275 行

---

### ❌ H-3：买入仅在 `buyEnabled=true` 时开放，但没有与"增长池耗尽"自动联动

**问题描述**
规格 7.1 节：
> 触发条件：仅当增长池（Growth Pool）全部挖完后，才开放购买接口。

代码中 `buyEnabled` 是由 owner 手动调用 `setBuyEnabled(true)` 开启的（`ETIMTaxHook.sol` 第 309-311 行），没有自动检查 `isGrowthPoolDepleted()` 的逻辑。这意味着：
- 增长池耗尽前，owner 可手动开启购买（不符合规格）。
- 增长池耗尽后，若 owner 未及时调用，购买仍被阻止（影响用户体验）。

**影响**
业务规则依赖 owner 手动操作而非链上自动执行，存在人为失误风险。

**涉及文件**
`contracts/ETIMTaxHook.sol` 第 236-241 行、第 309-311 行

---

### ❌ H-4：卖出税中 S6 奖励直接累积在 Hook 合约，没有链上均分给 S6 用户的机制

**问题描述**
`sellTaxToS6` 累积在 `ETIMTaxHook.sol`，`withdrawSellTaxS6(address to)` 只是将全部余额发给 owner 指定的某个地址（第 334-339 行），并没有遍历所有 S6 用户进行均摊。

规格 7.2 节：
> owner 调用接口，将池中所有 ETIM 平均分配给当时所有 ≥S6 等级的用户。

当前代码只是"转给某个地址"，链上均摊逻辑不存在。

**影响**
S6 奖励分发不透明，完全依赖 owner 中心化操作，用户无法验证是否按规格均摊，且 `ETIMTaxHook` 与 `ETIMMain`（维护等级信息）是独立合约，`withdrawSellTaxS6` 甚至无法查询谁是 S6 用户。

**涉及文件**
`contracts/ETIMTaxHook.sol` 第 334-339 行

---

## I. 储蓄池延迟模式

### ❌ I-1：延迟模式下合约没有持有 ETH 的逻辑保障，ETH 直接留在合约余额中

**问题描述**
延迟模式下，用户入场的 ETH 累积在 `pendingAllocationInEth` 变量，但 ETH 实际上留存在合约 `balance` 中。`triggerDelayedAllocation` 调用 PoolHelper 函数时需要携带 ETH（`{value: lpEth}`、`{value: burnEth}` 等），但合约没有专门的"提取此 ETH 并发送"逻辑，而是直接依赖合约余额。

问题在于合约同时也存有 `s2RewardEth`、`foundationRewardEth`、`potRewardEth`、`officialRewardEth`（这些也是累积在合约 balance 中），当 `triggerDelayedAllocation` 执行时，`ethAmount` 的计算（通过 USD 换算）可能与合约实际可用余额不匹配，存在混用风险。

此外，已在 B-2 中指出 `pendingAllocationInEth` 从未减少，整体延迟模式的 ETH 会计存在严重缺陷。

**涉及文件**
`contracts/ETIMMain.sol` 第 222-228 行、第 640-676 行

---

## J. 价格更新

### ⚠️ J-1：`updateDailyPrice` 存储 `dailyCapUpdatedDay` 用于更新每日 deposit cap，但实际 `dailyDepositCap` 被设为 ETH 储备量（非规格描述的"按日更新限额"逻辑）

**问题描述**
`updateDailyPrice` 第 617-621 行：
```solidity
if (currentDay != dailyCapUpdatedDay) {
    dailyDepositCap    = ethReserves;
    dailyCapUpdatedDay = currentDay;
}
```
每日更新时，`dailyDepositCap` 被设置为当前 ETH 储备量（一个绝对值），然后在 `_processParticipation` 中用：
```solidity
uint256 effectiveCap = (dailyDepositCap == 0)
    ? etimPoolHelper.getEthReserves()
    : dailyDepositCap;
if (dailyDepositTotal > effectiveCap * dailyDepositRate / FEE_DENOMINATOR) revert ...;
```
也就是当 `dailyDepositCap != 0` 时，使用的是**上一次 `updateDailyPrice` 快照时的储备量**，而不是实时储备量，与规格"LP ETH 储备 × 20%"的实时性描述有偏差。

规格 2.3 节说"特殊规则：当 `dailyDepositCap == 0` 时，以实时 LP ETH 储备 × 20% 作为当日限额"，这说明 `dailyDepositCap == 0` 是"实时模式"，非 0 是"快照模式"。但 `updateDailyPrice` 每次调用都会将其更新为最新储备量（变成非 0），之后就走快照模式。**此行为与规格逻辑可能不一致，列为待确认事项**。

**涉及文件**
`contracts/ETIMMain.sol` 第 602-628 行

---

## K. 安全性检查

### ❌ K-1：`onTokenTransfer` 缺少重入防护，且可能被任何人触发

**问题描述**
`onTokenTransfer`（第 384-395 行）没有 `nonReentrant` 修饰器：
```solidity
function onTokenTransfer(address from, address to, uint256 value) external nonReentrant {
```
等等——代码第 388 行实际有 `nonReentrant`。但检查调用来源：
```solidity
if (msg.sender != address(etimToken)) return;
```
仅用 `return` 而非 `revert`，这意味着任何地址调用 `onTokenTransfer` 都不会回滚，只是静默跳过。这不是安全漏洞（因为没有副作用），但会白白消耗 gas，且不够规范。

**更严重的问题**：`onTokenTransfer` 调用了 `_checkAndUpdateLevel(from)` 和 `_checkAndUpdateLevel(to)`，后者读取 `etimToken.balanceOf`。在转账执行后调用（ERC20 `_update` 完成后），余额已经更新，所以逻辑是正确的。但该函数也调用 `_processReferralBinding` 和 `_updateTeamTokenBalance`，这些函数会修改多个用户的状态，若被重入（例如通过 `safeTransfer` 回调 ERC721 等）可能有风险——虽然有 `nonReentrant`，但需确认 `nonReentrant` 锁与 `deposit` 等函数共享同一个重入锁实例（是的，所有函数在同一合约，共享锁）。

**影响**
低风险，但代码可读性差，建议 `return` 改为 `revert`，或增加条件说明。

**涉及文件**
`contracts/ETIMMain.sol` 第 384-395 行

---

### ❌ K-2：`getTestEtimToken` 测试函数暴露在生产合约中，任何人可提取任意 ETIM

**问题描述**
`ETIMMain.sol` 第 766-768 行：
```solidity
function getTestEtimToken(uint256 etimAmount) external nonReentrant {
    etimToken.safeTransfer(msg.sender, etimAmount);
}
```
此函数没有任何权限控制，**任何地址**均可调用，直接从合约 ETIM 余额转走代币，包括增长池分配给 `ETIMMain` 的 1,925,700,000 ETIM。

**影响**
**极高风险（严重漏洞）**。这是一个无权限的代币提取后门，会导致增长池完全被清空，整个挖矿机制崩溃，且任何用户的节点奖励也无法兑付。此函数必须在上线前删除。

**涉及文件**
`contracts/ETIMMain.sol` 第 766-768 行

---

### ❌ K-3：`ETIMNode.sol` 的 `mint` 函数无需付费且无权限控制，任何人可免费铸造节点 NFT

**问题描述**
`ETIMNode.sol` 第 18-27 行：
```solidity
function mint(uint256 amount) external {
    require(msg.sender != address(0), "Address invalid");
    uint256 currentSupply = totalSupply();
    require(currentSupply + amount <= MAX_SUPPLY, "Exceeds max supply");
    for(uint256 i = 0; i < amount; i++) {
        _safeMint(msg.sender, currentSupply + i + 1);
    }
}
```
任何地址均可免费铸造节点 NFT（最多 500 个），无需付款、无需 owner 授权。规格说明节点"已在以太坊主网部署"，且总量 500 个通过销售分发，此 `mint` 函数与规格中节点 NFT 为购买获得的假设相悖。

**影响**
**高风险**。任何人可立即铸造 500 个节点，免费获得节点额度加成（每节点 300U），并在 S1 条件达成后激活，将入场的 1% ETH 业绩奖励全部独占。所有节点奖励将被少数人（或机器人）垄断，破坏激励机制。

**涉及文件**
`contracts/ETIMNode.sol` 第 18-27 行

---

## 待确认事项

以下是规格不明确或实现与规格可能存在出入但需业务确认的问题：

### 待确认 1：S2+ 奖励是否需要链上均摊？

规格 2.5 节：S2 那 50% ETH 应"均摊给所有达到 S2 及以上等级的激活节点持有者"。当前实现 `withdrawS2(address payable to)` 将整笔 ETH 发给 owner 指定地址，由 owner 线下分配。

**问题**：是否接受链下均摊方式，还是要求链上自动均摊？若需要链上均摊，需要遍历所有参与者并过滤 S2+，在 Gas 成本和可扩展性上需评估方案。

---

### 待确认 2：用户持仓下降时是否允许降级？

`_checkAndUpdateLevel` 使用实时余额，用户卖出 ETIM 后可能降级。规格 4.2 节未明确说明是否支持降级。若不允许降级（"一旦达到即永久保持"），则代码需要修改为只升不降。

---

### 待确认 3：每日限额快照模式 vs 实时模式

规格 2.3 节描述当 `dailyDepositCap == 0` 时使用实时储备，`updateDailyPrice` 每天更新后 `dailyDepositCap` 变为非 0（快照）。每天在 `updateDailyPrice` 调用之前，`dailyDepositCap` 仍是昨日快照值。

**问题**：是否接受"每日快照模式"（即限额为 owner 每天调用 `updateDailyPrice` 时的瞬时储备量），还是要求全程使用实时储备量？若后者，代码逻辑需简化（始终使用 `getEthReserves() * dailyDepositRate / FEE_DENOMINATOR`）。

---

## 附：合约架构一致性说明

| 架构组件 | 状态 |
|---------|------|
| ETIMToken → ETIMMain 回调（`onTokenTransfer`） | ✅ 已实现 |
| ETIMMain → ETIMPoolHelper（swap/liquidity）| ✅ 已实现 |
| ETIMTaxHook → ETIMMain（`distributeNodePerformanceOnEtimSell`）| ✅ 接口已实现，但未在 hook 中调用（`_beforeSwap` 中 sell 分支无此调用） |
| ETIMNode（只读 `balanceOf`） | ✅ 已实现 |

**附加发现**：`ETIMTaxHook._beforeSwap` 的 sell 分支（第 263-275 行）只做税额分配，没有调用 `IETIMMain(mainContract).distributeNodePerformanceOnEtimSell`。而 `ETIMMain` 第 379-381 行定义了该外部函数，规格中没有明确说卖出时是否触发节点业绩分红，但此函数的存在意味着原本计划在某处调用。列为潜在遗漏，建议确认。

---

*报告生成：QA Agent，基于代码静态分析，无运行时测试。*
