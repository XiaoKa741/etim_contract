# ETIM 合约 Bug 报告

> 对照《ETIM_SPEC.md》逐项检查，共发现 8 个问题。
> 文件路径均为相对路径，行号基于当前代码版本。

---

## Bug 1 ｜ 入场资格检查逻辑反了 【P0 · 系统无法运行】

**文件**：`contracts/ETIMMain.sol` 第 193 行

**规格要求**：
用户入场的前提是"已被他人邀请"，即该用户有上级（referrer）。

**当前代码**：
```solidity
// 第 193 行
if (users[addr].directReferralCount == 0) revert NoReferralBinding();
```

`directReferralCount` 表示该用户**邀请了多少人**（下级数量），而不是该用户是否被邀请。

**问题场景**：
- A 邀请 B（A→B 互转，绑定成功）
- B 的 `directReferralCount = 0`（B 没有邀请任何人）
- B 尝试入场 → **触发 revert，无法入场**
- 结果：除了系统根节点以外，所有被邀请的新用户均无法入场

**应改为**：
```solidity
if (referrerOf[addr] == address(0)) revert NoReferralBinding();
```

---

## Bug 2 ｜ 入场资金分配比例错误，5% 奖励机制完全缺失 【P0 · 资金流向错误】

**文件**：`contracts/ETIMMain.sol` 第 58–61 行，`_allocateDepositFunds` 函数

**规格要求**（入场 ETH 的 4 个去向）：

| 份额 | 比例 | 操作 |
|------|------|------|
| 节点业绩 | 1% | ETH → swap → ETIM → 均分给已激活节点 |
| LP | 69% | 一半 swap ETIM + 一半 ETH → 注入底池 |
| 销毁 | **25%** | ETH → swap → ETIM → 发送至销毁地址 |
| 奖励池 | **5%** | **保留为 ETH，累积在合约，owner 手动分发** |

**当前代码**：
```solidity
uint256 public constant NODE_SHARE  = 10;  // 1%  ✅
uint256 public constant LP_SHARE    = 690; // 69% ✅
uint256 public constant BURN_SHARE  = 300; // 30% ❌ 应为 25%
// 5% 奖励池：完全缺失 ❌
```

**两处问题**：

1. `BURN_SHARE` 是 300（30%），比规格多了 5%；应为 250（25%）。
2. 5% 奖励池（ETH 形式）完全没有实现，包括：
   - 累积变量 `pendingRewardEth`
   - `distributeRewards()` 分发函数
   - 分发逻辑：≥S2 已激活节点持有者 50% / 基金会 30% / 奖池 10% / 官方 10%
   - 收款地址配置（foundation、prizePool、official）

---

## Bug 3 ｜ TaxHook 卖出时调用了错误的合约地址 【P0 · 节点奖励永远失败】

**文件**：`contracts/ETIMTaxHook.sol` 第 211 行

**规格要求**：
卖出时，取出的 5% ETIM 应通知 ETIMMain 合约分发给节点。

**当前代码**：
```solidity
// 第 209 行：把 toNode 份 ETIM 转给 mainContract ✅ 正确
IERC20(etimContract).safeTransfer(mainContract, toNode);

// 第 211 行：但通知调用的是 etimContract（ETIM Token 合约），不是 mainContract ❌
try IETIMMain(etimContract).distributeNodePerformanceOnEtimSell(toNode) {} catch {}
//           ↑ 这是 ERC20 Token 合约，没有这个方法
```

`etimContract` 是 ETIM ERC20 代币合约地址，它没有 `distributeNodePerformanceOnEtimSell` 方法，所以这个调用**永远进入 catch 分支，静默失败**。

ETIM 转入了 mainContract，但 mainContract 里的奖励计数器从未被更新，节点持有者无法领取这部分奖励。

**应改为**：
```solidity
try IETIMMain(mainContract).distributeNodePerformanceOnEtimSell(toNode) {} catch {}
```

---

## Bug 4 ｜ 卖出税比例与分配逻辑完全不符规格 【P1 · 税率和去向错误】

**文件**：`contracts/ETIMTaxHook.sol` `_beforeSwap` / `_afterSwap`

**规格要求**（卖出收 3% ETIM，4 个去向）：

| 去向 | 比例 |
|------|------|
| S6+ 用户奖励池（累积，owner 手动分发） | 0.5% |
| 销毁至 0x000...dEaD | 1.5% |
| 官方钱包 | 0.5% |
| 基金会 | 0.5% |

**当前代码**（`_beforeSwap` 第 292–295 行）：
```solidity
uint256 toLp   = etimIn * 85 / 100;  // 85% 进池子参与 swap
uint256 toBurn = etimIn * 10 / 100;  // 10% 销毁
uint256 toNode = etimIn - toLp - toBurn; // 5% 给节点
```

**两处问题**：

1. **比例错误**：代码取走用户 ETIM 总量的 **15%**（10%+5%），规格是 **3%**，相差 5 倍。

2. **分配目标错误**：代码没有官方、基金会、S6+ 池三个去向；代码多出了"给节点"这个去向（规格中节点奖励来自入场的 1%，不来自卖出税）。

3. **附加问题（Bug 8）**：`_beforeSwap` 通过 `BeforeSwapDelta` 已告知 PoolManager 扣除 15%，`_afterSwap` 中又对同一个 `etimIn` 再次调用 `poolManager.take` 执行相同逻辑，属于**重复扣款**。

---

## Bug 5 ｜ claim() 中节点用户可能发生整数下溢 【P1 · 持有节点的用户无法 claim】

**文件**：`contracts/ETIMMain.sol` 第 272–273 行

**背景**：
持有节点的用户，其总挖矿额度 = `investedValueInUsd + 300U × 节点数`。
`claimedValueInUsd` 会随着每次 claim 增长，最终可以超过 `investedValueInUsd`。

**当前代码**：
```solidity
// claim() 第 272–273 行
uint256 remainingValueInUsd = user.investedValueInUsd - user.claimedValueInUsd;
//                            ↑ 节点用户挖完 investedValueInUsd 后，这里会下溢回滚
if (remainingValueInUsd == 0) revert NoRemainingValue();
```

**而 `_calculatePendingRewards` 中**（第 311–312 行）正确地使用了含节点加成的总额度：
```solidity
uint256 totalQuotaInUsd = user.investedValueInUsd + _calcNodeQuotaBonusInUsd(userAddr);
uint256 remainingValueInUsd = totalQuotaInUsd - user.claimedValueInUsd; // 正确
```

两处逻辑不一致，导致节点用户在挖完基础额度后，`claim()` 直接 revert，剩余的节点额度部分永远无法领取。

**应改为**：
```solidity
uint256 totalQuotaInUsd = user.investedValueInUsd + _calcNodeQuotaBonusInUsd(msg.sender);
if (user.claimedValueInUsd >= totalQuotaInUsd) revert NoRemainingValue();
```

---

## Bug 6 ｜ 会员等级条件数值与规格不符，且多出 S7 级别 【P1 · 等级门槛错误】

**文件**：`contracts/ETIMMain.sol` 第 173–183 行 `_initializeLevelConditions()`

**规格 vs 代码对比**（个人持仓 / 团队币量，单位：万 ETIM）：

| 等级 | 规格·个人持仓 | 代码·个人持仓 | 规格·团队币量 | 代码·团队币量 |
|------|------------|------------|------------|------------|
| S1 | **5 万** | 10 万（注释掉的测试值） | 50 万 ✅ | 50 万 ✅ |
| S2 | **10 万** | **50 万** ❌ | 300 万 ✅ | 300 万 ✅ |
| S3 | **15 万** | **100 万** ❌ | **500 万** | **700 万** ❌ |
| S4 | **20 万** | **150 万** ❌ | **700 万** | **1600 万** ❌ |
| S5 | **30 万** | **200 万** ❌ | **900 万** | **2500 万** ❌ |
| S6 | **40 万** | **300 万** ❌ | **1100 万** | **5000 万** ❌ |
| **S7** | **文档无此级别** | **40人/350万/8000万** ❌ | — | — |

个人持仓门槛代码比规格高出 **5～8 倍**，团队门槛高出 **2～5 倍**，且多了一个文档中不存在的 S7 等级（加速 22%）。

**应改为**（依照 ETIM_SPEC.md）：
```solidity
levelConditions[1] = LevelCondition(5,   50_000 * 1e18,    500_000 * 1e18,  7);
levelConditions[2] = LevelCondition(10, 100_000 * 1e18,  3_000_000 * 1e18, 10);
levelConditions[3] = LevelCondition(15, 150_000 * 1e18,  5_000_000 * 1e18, 12);
levelConditions[4] = LevelCondition(20, 200_000 * 1e18,  7_000_000 * 1e18, 15);
levelConditions[5] = LevelCondition(25, 300_000 * 1e18,  9_000_000 * 1e18, 18);
levelConditions[6] = LevelCondition(30, 400_000 * 1e18, 11_000_000 * 1e18, 20);
// 删除 levelConditions[7]
```

---

## Bug 7 ｜ 日存款上限为 0 时阻断所有存款 【P1 · 初始状态无法入场】

**文件**：`contracts/ETIMMain.sol` 第 201 行

**规格要求**：
- `dailyDepositCap == 0` 时，以实时 LP ETH 储备 × `dailyDepositRate`（默认 20%）作为当日上限。

**当前代码**：
```solidity
// dailyDepositCap 初始值为 0（第 110 行）
uint256 public dailyDepositCap = 0;

// 第 201 行检查
if (dailyDepositTotal > dailyDepositCap * dailyDepositRate / FEE_DENOMINATOR) revert DailyDepositLimitExceeded();
// 当 cap = 0 时：右侧 = 0 * 200 / 1000 = 0
// 第一笔存款后 dailyDepositTotal > 0，立刻 revert
```

合约部署后，`updateDailyPrice()` 被 owner 调用之前，`dailyDepositCap` 始终为 0，**所有入场交易都会失败**。

**应改为**：
```solidity
uint256 effectiveCap = (dailyDepositCap == 0)
    ? etimPoolHelper.getEthReserves()
    : dailyDepositCap;
if (dailyDepositTotal > effectiveCap * dailyDepositRate / FEE_DENOMINATOR)
    revert DailyDepositLimitExceeded();
```

---

## Bug 8 ｜ TaxHook 卖出逻辑在 beforeSwap 和 afterSwap 中重复执行 【P2 · 双重扣款】

**文件**：`contracts/ETIMTaxHook.sol` `_beforeSwap`（第 286–306 行）和 `_afterSwap`（第 194–212 行）

**问题描述**：

`_beforeSwap` 返回了 `BeforeSwapDelta`，告知 Uniswap V4 的 PoolManager：Hook 要从用户的 ETIM 输入中取走 `toBurn + toNode`（15%）。这已经在 V4 的结算层面完成了扣款。

随后 `_afterSwap` 再次计算同样的 `toBurn` 和 `toNode`，并再次调用 `poolManager.take(key.currency1, address(this), toBurn + toNode)`，试图从池中取出相同数量的 ETIM。

两个 Hook 对同一笔卖出的 15% 各执行了一次，**实际扣款 30%**（其中一次很可能因余额不足而静默失败或引发异常）。

此 Bug 在修复 Bug 4（重写卖出税逻辑）时一并解决。

---

## 汇总

| # | 优先级 | 文件 | 影响 |
|---|--------|------|------|
| Bug 1 | 🔴 P0 | ETIMMain.sol:193 | 所有新用户无法入场，系统无法运行 |
| Bug 2 | 🔴 P0 | ETIMMain.sol:58-61 | 销毁多 5%，5% 奖励机制完全缺失 |
| Bug 3 | 🔴 P0 | ETIMTaxHook.sol:211 | 卖出节点奖励永远失败 |
| Bug 4 | 🟠 P1 | ETIMTaxHook.sol | 卖出税 15% 而非 3%，分配去向全错 |
| Bug 5 | 🟠 P1 | ETIMMain.sol:273 | 持有节点的用户无法完整领取挖矿奖励 |
| Bug 6 | 🟠 P1 | ETIMMain.sol:173-183 | 等级门槛远高于设计，S7 多余 |
| Bug 7 | 🟠 P1 | ETIMMain.sol:201 | 初始状态所有入场交易失败 |
| Bug 8 | 🟡 P2 | ETIMTaxHook.sol | 卖出税重复扣款（随 Bug 4 一并修复） |

**P0（3 个）**：任意一个未修复，系统核心流程不可用。
**P1（4 个）**：直接影响用户资金或等级逻辑。
**P2（1 个）**：随 P1 修复时一并处理。
