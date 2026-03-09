# ETIM 完整规格与合约使用手册

> 版本：2026-03-10（含所有已修复 bug 后的最终状态）
> 覆盖合约：ETIMToken · ETIMNode · ETIMPoolHelper · ETIMTaxHook · ETIMMain

---

## 一、系统总览

### 1.1 合约架构

```
ETIMToken.sol       ERC20 代币；transfer 后回调 ETIMMain.onTokenTransfer
ETIMNode.sol        ERC721 节点 NFT（500 个上限，主网已部署）
ETIMPoolHelper.sol  Uniswap V4 流动性管理（swap / addLiquidity / burn）
ETIMTaxHook.sol     Uniswap V4 Hook；买卖税扣除与分配
ETIMMain.sol        核心业务：入场、挖矿、等级、节点奖励、资金分配
```

### 1.2 调用关系

```
用户 ──ETH──► ETIMMain.deposit()
                  │
                  ├─ ETIMPoolHelper.swapAndAddLiquidity  (69% ETH)
                  ├─ ETIMPoolHelper.swapAndBurn          (25% ETH)
                  ├─ ETIMPoolHelper.swapEthToEtim        (1%  ETH → ETIM → 节点池)
                  └─ s2/foundation/pot/official 累积     (5%  ETH)

用户 ──ETIM──► Uniswap V4 Pool
                  │
                  └─ ETIMTaxHook._beforeSwap             (买/卖税截取)

ETIMToken._update ──► ETIMMain.onTokenTransfer           (每次 EOA 间转账)
ETIMTaxHook       ──► ETIMMain.distributeNodePerformanceOnEtimSell  (预留接口，当前未调用)
```

### 1.3 代币总量与分配

| 模块 | 数量 (ETIM) | 占比 | 说明 |
|------|------------|------|------|
| 增长池 Growth Pool | 1,925,700,000 | 91.7% | 挖矿释放，存入 ETIMMain 合约 |
| 协议市场基础设施 | 105,000,000 | 5% | POL / 做市仓 |
| 生态建设基金 | 21,000,000 | 1% | 应用生态发展 |
| 社区建设 | 21,000,000 | 1% | 地面工作室 / 会议 |
| 空投 | 21,000,000 | 1% | 空投活动 |
| 以太坊基金会 | 6,300,000 | 0.3% | 合作 |

> **实现说明**：ETIMToken 构造函数将全部 2.1B 铸造给部署者（`msg.sender`），由部署者在部署后手动分发到各目标地址，链上不做强制验证。

---

## 二、部署流程（Owner 操作）

按以下顺序依次部署并配置：

### Step 1 — 部署代币合约

```
ETIMToken(name="ETIM", symbol="ETIM")
```

- 部署者持有全部 2.1B ETIM。
- 立即将各分配份额转账到对应地址（Market Infra、生态基金、社区、空投、ETH 基金会），共 174.3M ETIM。
- 剩余 1,925.7M ETIM 稍后转入 ETIMMain。

### Step 2 — 部署节点 NFT（主网已有，跳过）

```
ETIMNode()  ← 主网已部署，记录地址即可
```

### Step 3 — 部署 Hook 合约

```
ETIMTaxHook(
    poolManager   = <Uniswap V4 PoolManager 地址>,
    owner         = <owner 地址>,
    buyTaxBps     = 300,   // 3%
    sellTaxBps    = 300    // 3%
)
```

> Hook 地址必须通过 Uniswap V4 的 salt 挖矿满足特定位模式，需使用 CREATE2 工具。

### Step 4 — 部署 PoolHelper

```
ETIMPoolHelper(
    poolManager = <Uniswap V4 PoolManager 地址>,
    etim        = <ETIMToken 地址>,
    usdc        = <USDC 合约地址>,
    hook        = <ETIMTaxHook 地址>
)
```

### Step 5 — 部署主合约

```
ETIMMain(
    _etimToken      = <ETIMToken 地址>,
    _etimNode       = <ETIMNode 地址>,
    _etimPoolHelper = <ETIMPoolHelper 地址>,
    _etimTaxHook    = <ETIMTaxHook 地址>
)
```

### Step 6 — 配置合约互联

```
ETIMToken.setMainContract(ETIMMain 地址)
ETIMPoolHelper.setMainContract(ETIMMain 地址)
ETIMTaxHook.setTokenContract(ETIMToken 地址)
ETIMTaxHook.setMainContract(ETIMMain 地址)
ETIMTaxHook.setExempt(ETIMPoolHelper 地址, true)   // PoolHelper 免税
```

### Step 7 — 初始化流动性池

```
// 转 ETIM 给 PoolHelper 并 approve
ETIMToken.transfer(ETIMPoolHelper 地址, 初始 ETIM 量)
ETIMToken.approve(ETIMPoolHelper 地址, 初始 ETIM 量)  // 由 owner 钱包执行

// 初始化池价格（sqrtPriceX96 = 初始 ETIM/ETH 比例对应的 sqrt 价格）
ETIMPoolHelper.initializePool(sqrtPriceX96)

// 注入初始流动性（ETH + ETIM）
ETIMPoolHelper.addLiquidity{value: 初始 ETH}(初始 ETH 量, 初始 ETIM 量)
```

### Step 8 — 向 ETIMMain 注入增长池

```
ETIMToken.transfer(ETIMMain 地址, 1_925_700_000 * 10^18)
```

### Step 9 — 开启卖出（买入待增长池耗尽后自动开放）

```
ETIMTaxHook.setSellEnabled(true)
```

### Step 10 — 首次价格更新（开放入场前必须调用）

```
ETIMMain.updateDailyPrice()
```

---

## 三、入场（用户操作）

### 3.1 前提条件

1. **已被他人邀请**：`referrerOf[用户地址] != address(0)`。绑定方式见第四节。
2. **每个地址只能入场一次**。

### 3.2 入场方式

```solidity
// 方式 A：直接转 ETH
ETIMMain.deposit{value: ethAmount}()

// 方式 B：直接向合约发 ETH（receive 函数处理）
(bool ok,) = address(ETIMMain).call{value: ethAmount}("");
```

### 3.3 金额限制

- 当前：100 USD ～ 150 USD 等值 ETH（按入场时实时价格换算）。
- Owner 可通过 `setParticipationAmountBounds(min, max)` 调整。
- USD 精度 6 位小数（与 USDC 一致）。

### 3.4 每日总量限制

- 每日可接受总 ETH = `effectiveCap * dailyDepositRate / 1000`
- `effectiveCap`：若 `dailyDepositCap == 0`，取实时 LP ETH 储备量；否则取上次快照值。
- 默认 `dailyDepositRate = 200`（即 20%）。
- `dailyDepositCap` 由 owner 每天调用 `updateDailyPrice()` 时更新为当天 ETH 储备快照。

### 3.5 资金自动分配（即时模式，非延迟模式）

| 份额 | 比例 | 操作 |
|------|------|------|
| 节点业绩 | 1% | ETH → swap → ETIM，`_distributeNodeRewards` 均摊给活跃节点 |
| LP | 69% | 一半 ETH swap 成 ETIM + 另一半 ETH → 注入底池 |
| 销毁 | 25% | ETH → swap → ETIM → 发送至 `0x000...dEaD` |
| 奖励池 | 5% | 保留为 ETH，累积在 ETIMMain 合约 |

奖励池 5% 内部再分：

| 接收方 | 比例 |
|--------|------|
| s2RewardEth（S2+ 节点均摊，owner 手动分发） | 50% |
| foundationRewardEth（基金会） | 30% |
| potRewardEth（奖池） | 10% |
| officialRewardEth（官方） | 10% |

---

## 四、邀请绑定（用户操作）

### 4.1 绑定机制

**双向 ETIM 转账** 即建立父子关系（纯链上，无需 owner 干预）：

1. A → B 发送任意数量 ETIM（记录时间戳）
2. B → A 发送任意数量 ETIM（检测到双向记录）
3. **先转账的一方为 referrer（父），另一方为 invitee（子）**
4. 绑定一旦建立，不可修改

> 注意：合约间转账（`_isContract` 为 true）不触发绑定；发送给销毁地址不触发绑定。

### 4.2 嵌套循环保护

若出现循环引用（A→B→C→A），`_propagateTeamBalanceChange` 中的环检测会在 5 层内中止，不会无限循环。

### 4.3 团队币量传播

- 每次 EOA 间 ETIM 转账，发送方和接收方的余额变化会向上传播至多 5 层上级，更新 `teamTokenBalance`。
- **限制**：由于 `claim()` 和 `claimNodeRewards()` 含 `nonReentrant` 锁，growth pool 释放的 ETIM 转账无法触发回调，referrer 的 `teamTokenBalance` 不会因下级 claim 而更新。用户须主动调用 `updateReferralLevel()` 或进行一次普通转账来刷新等级。

---

## 五、挖矿（用户操作）

### 5.1 挖矿规则

- 入场后每天产出 = 入场 USD 价值 × `dailyReleaseRate / 1000` × (1 + 加速率 / 100)
- 默认 `dailyReleaseRate = 10`（1%），owner 可调整。
- 产出以 USD 价值计，再按当日 ETIM/USD 价格换算成 ETIM 数量。
- **总上限**：`investedValueInUsd + 300 USD × 持有节点数`。
- **懒结算**：每天累计，用户主动调用 `claim()` 才链上转账。

### 5.2 等级加速

| 等级 | 加速率 | 实际日产出 |
|------|-------|-----------|
| S0 | +3% | 基础 × 1.03 |
| S1 | +7% | 基础 × 1.07 |
| S2 | +10% | 基础 × 1.10 |
| S3 | +12% | 基础 × 1.12 |
| S4 | +15% | 基础 × 1.15 |
| S5 | +18% | 基础 × 1.18 |
| S6 | +20% | 基础 × 1.20 |

> **升级日生效**：等级变化时合约自动将旧加速率下的已计收益存入 `settledEtimFromCheckpoint`，下次 claim 时一并���放；升级后的新加速率只从升级当天起计算。

### 5.3 claim 操作

```solidity
ETIMMain.claim()
```

- 自动更新等级
- 将 checkpoint 余额 + 本次计算结果合并转账
- 按增长池剩余量上限截断
- 增长池耗尽时，USD 记账仍正常推进（不会卡账）；实际转账为 0 时 revert

### 5.4 查看可领金额

```solidity
ETIMMain.getClaimableAmount()  // 返回 ETIM 数量（含 checkpoint）
```

---

## 六、会员等级（自动 + 用户可触发）

### 6.1 升级条件（三项同时满足）

| 等级 | 直推人数 | 个人持仓 ETIM | 团队币量 ETIM |
|------|---------|-------------|-------------|
| S0 | 0 | 0 | 0 |
| S1 | 5 | 50,000 | 500,000 |
| S2 | 10 | 100,000 | 3,000,000 |
| S3 | 15 | 150,000 | 5,000,000 |
| S4 | 20 | 200,000 | 7,000,000 |
| S5 | 25 | 300,000 | 9,000,000 |
| S6 | 30 | 400,000 | 11,000,000 |

### 6.2 等级计算规则

- 每次 EOA 间 ETIM 转账后自动触发 `_checkAndUpdateLevel(from)` 和 `_checkAndUpdateLevel(to)`。
- 用户可手动调用 `ETIMMain.updateReferralLevel()` 刷新。
- 持仓降至门槛以下时等级自动降级。
- 团队币量：向上传播最多 5 层（含循环检测），不做等级嵌套中止。

### 6.3 查询等级

```solidity
ETIMMain.getUserLevel(address user)  // returns uint8
```

---

## 七、节点 NFT（用户操作）

### 7.1 基本信息

- 总量 500 个，已在以太坊主网部署。
- 通过 ERC721 `balanceOf` 读取持有量，无需额外注册。

### 7.2 节点额度加成

- 每持有 1 节点，挖矿总额度额外增加 **300 USD**。
- 总可挖 USD = 入场 USD + 300 × 节点数量。

### 7.3 节点激活条件

- 持有者等级 **≥ S1** 才计为激活节点。

### 7.4 节点业绩奖励（Masterchef 模式）

- 全网每笔入场的 1% ETH → swap → ETIM，均摊给所有已激活节点。
- 累积变量：`rewardPerNode`（全局单调递���）。
- 领取前需同步节点状态（`claimNodeRewards` 自动调用 `_syncUserNodes`）。

### 7.5 用户操作

```solidity
// 同步节点数（转移节点后须调用，或直接 claimNodeRewards 自动同步）
ETIMMain.syncNodes()

// 领取节点业绩奖励（ETIM）
ETIMMain.claimNodeRewards()
```

---

## 八、买卖规则

### 8.1 卖出（随时可卖）

- 从 Uniswap V4 卖出 ETIM 时，`ETIMTaxHook._beforeSwap` 自动扣除 **3% 卖出税**。
- 税从输入 ETIM 中截取，分配：

| 接收方 | 比例 | 实际操作 |
|--------|------|---------|
| S6+ 奖励池 | ~17% of tax ≈ 0.5% of swap | 累积在 TaxHook（ETIM）；owner 手动触发分发 |
| 基金会 | ~17% of tax ≈ 0.5% of swap | 累积在 TaxHook（ETIM）；owner 提取 |
| 官方钱包 | ~16% of tax ≈ 0.5% of swap | 累积在 TaxHook（ETIM）；owner 提取 |
| 销毁 | ~50% of tax ≈ 1.5% of swap | 累积在 TaxHook；owner 调用 `burnSellTax()` 销毁 |

> `sellEnabled` 须为 true；初始为 false，由 owner 部署后开启。

### 8.2 买入（增长池耗尽后自动开放）

- **触发条件**：`ETIMMain.isGrowthPoolDepleted() == true` 时自动放行；或 owner 手动调用 `setBuyEnabled(true)`。
- 从 Uniswap V4 买入 ETIM 时，`ETIMTaxHook._beforeSwap` 扣除 **3% 买入税**（从输入 ETH 中截取）。
- 税款以 ETH 形式累积在 TaxHook，owner 调用 `withdrawBuyTax(to)` 提取。

---

## 九、Owner 操作手册

### 9.1 ETIMMain

| 函数 | 参数 | 说明 |
|------|------|------|
| `updateDailyPrice()` | — | **每日调用一次**；更新 ETIM/ETH 价格快照、USD/ETH 价格、每日存款上限（ETH 储备快照）、ETIM/USD 价格；供 claim 结算用 |
| `setParticipationAmountBounds(min, max)` | USD 6位小数 | 调整入场金额上下限，如 `(100e6, 150e6)` |
| `setDailyReleaseRate(rate)` | 整数，分母 1000 | 每日挖矿基础释放率，默认 10（1%）|
| `setDailyDepositRate(rate)` | 整数，分母 1000 | 每日存款上限比例，默认 200（20%）|
| `setDelayEnabled(bool)` | true/false | ���启/关��储蓄池延迟模式 |
| `triggerDelayedAllocation(usdValue)` | USD 6位小数 | 延迟模式下分批执行资金分配（按当前 USD/ETH 价格换算 ETH 量） |
| `withdrawS2(to)` | address payable | 提取 S2+ 奖励池 ETH（由 owner 线下均摊给 S2+ 等级激活节点持有者）|
| `withdrawFoundation(to)` | address payable | 提取基金会奖励池 ETH |
| `withdrawPot(to)` | address payable | 提取奖池 ETH |
| `withdrawOfficial(to)` | address payable | 提取官方奖励池 ETH |

### 9.2 ETIMTaxHook

| 函数 | 参数 | 说明 |
|------|------|------|
| `setSellEnabled(true)` | — | 开启卖出（部署后立即调用）|
| `setBuyEnabled(true)` | — | 手动开启买入（增长池耗尽前不应设置）|
| `setTaxRates(buyBps, sellBps)` | bps，最大 1000 | 调整买卖税率，默认各 300（3%）|
| `setExempt(addr, bool)` | — | 设置免税白名单（ETIMPoolHelper 须加入）|
| `setMainContract(addr)` | — | 设置主业务合约地址 |
| `setTokenContract(addr)` | — | 设置 ETIM 代币地址（只能设置一次）|
| `withdrawSellTaxS6(to)` | address | 提取 S6+ 卖出税 ETIM，手动均摊给 S6+ 用户 |
| `withdrawSellTaxOfficial(to)` | address | 提取官方份额卖出税 ETIM |
| `withdrawSellTaxFundation(to)` | address | 提取基金会份额卖出税 ETIM |
| `burnSellTax()` | — | 将销毁份额卖出税 ETIM 发送至销毁地址 |
| `withdrawBuyTax(to)` | address payable | 提取买入税 ETH |
| `pause() / unpause()` | — | 暂停/恢复 hook（停止交易）|
| `transferOwnership(newOwner)` | — | 发起两步所有权转移 |

### 9.3 ETIMPoolHelper

| 函数 | 参数 | 说明 |
|------|------|------|
| `initializePool(sqrtPriceX96)` | — | 初始化 ETIM/ETH 池价格并 approve（仅部署后调用一次）|
| `addLiquidity(ethAmount, etimAmount)` | payable | 手动注入流动性（初始流动性或后续补充）|
| `setMainContract(addr)` | — | 设置 ETIMMain 地址 |
| `transferOwnership(newOwner)` | — | 两步所有权转移 |

### 9.4 ETIMNode

| 函数 | 参数 | 说明 |
|------|------|------|
| `batchMint(to, amount)` | — | 批量铸造节点 NFT 给指定地址（生产上线前用于分发节点）|
| `updateURI(uri)` | string | 更新节点元数据 URI |

---

## 十、用户操作汇总

| 操作 | 函数 | 说明 |
|------|------|------|
| 入场 | `ETIMMain.deposit{value}()` 或直接转 ETH | 首次且须有 referrer |
| 建立邀请关系 | ETIM 双向转账（普通 ERC20 transfer）| A→B 再 B→A，先发者为父 |
| 手动刷新等级 | `ETIMMain.updateReferralLevel()` | claim 后个人持仓增加时���调用 |
| 领取挖矿奖励 | `ETIMMain.claim()` | 至少过一整天才有收益 |
| 查看可领金额 | `ETIMMain.getClaimableAmount()` | view，含 checkpoint |
| 同步节点数 | `ETIMMain.syncNodes()` | 节点持有量变化后调用 |
| 领取节点奖励 | `ETIMMain.claimNodeRewards()` | 自动同步节点 |
| 卖出 ETIM | Uniswap V4 swap（ETIM → ETH）| 自动扣 3% 卖出税 |
| 买入 ETIM | Uniswap V4 swap（ETH → ETIM）| 增长池耗尽后可用，自动扣 3% 买入税 |

---

## 十一、每日运营流程（Owner）

```
每天 UTC 00:00 前后：
1. ETIMMain.updateDailyPrice()
   → 更新价格快照 + 每日存款上限
   → 必须在当日第一笔入场前完成，否则使用昨日快照

按需（有 S6+ 卖出税积累时）：
2. ETIMTaxHook.burnSellTax()                  // 销毁销毁份额
3. ETIMTaxHook.withdrawSellTaxS6(addr)         // 提取 S6 奖励，手动均摊
4. ETIMTaxHook.withdrawSellTaxOfficial(addr)   // 提取官方份额
5. ETIMTaxHook.withdrawSellTaxFundation(addr)  // 提取基金会份额
6. ETIMTaxHook.withdrawBuyTax(addr)            // 提取买入税 ETH（增长池耗尽后）

按需（入场奖励池有余额时）：
7. ETIMMain.withdrawS2(addr)                   // 提取 S2 奖励 ETH，手动均摊
8. ETIMMain.withdrawFoundation(addr)
9. ETIMMain.withdrawPot(addr)
10. ETIMMain.withdrawOfficial(addr)

储蓄池延迟模式（启用时）：
11. ETIMMain.setDelayEnabled(true)
12. ETIMMain.triggerDelayedAllocation(usdValue) // 每次分批执行，usdValue 不超过 pendingAllocationInUsd
13. ETIMMain.setDelayEnabled(false)             // 关闭后恢复即时模式
```

---

## 十二、关键参数速查

| 参数 | 默认值 | 可调 | 说明 |
|------|--------|------|------|
| 总供应量 | 2,100,000,000 ETIM | 否 | |
| 增长池 | 1,925,700,000 ETIM | 否 | |
| 节点总量 | 500 个 | 否 | |
| 入场范围 | 100U ～ 150U | Owner | `setParticipationAmountBounds` |
| 每日挖矿率 | 1%（rate=10） | Owner | `setDailyReleaseRate` |
| 日存款上限比例 | 20%（rate=200） | Owner | `setDailyDepositRate` |
| 节点额度加成 | 300 USD / 个 | 否 | |
| 买入税 | 3%（300 bps） | Owner | `setTaxRates` |
| 卖出税 | 3%（300 bps） | Owner | `setTaxRates` |
| 节点业绩份 | 入场 1% ETH→ETIM | 否 | |
| 奖励池份额 | 入场 5% ETH | 否 | |
| 销毁份额 | 入场 25% ETH→ETIM | 否 | |
| LP 份额 | 入场 69% ETH | 否 | |
| 传播层数上限 | 5 层 | 否 | 邀请链团队币量传播 |
| 价格更新节流 | 5 秒 | 否 | 入场时自动更新价格的最小间隔 |

---

## 十三、已知限制与注意事项

### 13.1 团队币量传播上限 5 层

邀请链超过 5 层时，第 6 层及更深的余额变化不会传播到根节点。
后果：深链结构中，高层用户 `teamTokenBalance` 可能偏低，升级需要更多直接下线推动。

### 13.2 claim 不触发团队币量更新

`claim()` 内的 growth pool 释放因 `nonReentrant` 锁阻断了 `onTokenTransfer` 回调，referrer 的 `teamTokenBalance` 不会因下级 claim 而更新。建议下级 claim 后通知上级手动调用 `updateReferralLevel()`。

### 13.3 triggerDelayedAllocation 价格风险

延迟分配按调用时当前 ETH 价格重新换算，若 ETH 价格相对入场时波动较大，实际消耗 ETH 量与 `pendingAllocationInEth` 可能不一致。建议在价格相对稳定时调用，避免 ETH 价格大幅下跌时超支合约 ETH 余额。

### 13.4 每日存款上限快照模式

`dailyDepositCap` 在每天 `updateDailyPrice()` 调用时更新一次快照。若当天未调用，使用前一天的快照值。建议在每日同一时间点调用，保持数据一致。

### 13.5 长期未 claim 的 gas 成本

`_calculatePendingRewards` 按天迭代（每次一个存储读），若用户超过 100 天未 claim，gas 消耗会显著增加。建议定期（每周或每月）提醒用户 claim。

### 13.6 生产上线前须删除的测试代码

- `ETIMMain.getTestEtimToken(uint256)` — 无权限提取增长池 ETIM，**高危后门，必须删除**
- `ETIMNode.mint(uint256)` — 任何人免费铸造节点 NFT，**必须删除或加 onlyOwner**

---

## 十四、合约关键常量与 Selector 备忘

| 合约 | 常量 / 函数 | 值 |
|------|------------|-----|
| ETIMMain | GROWTH_POOL_SUPPLY | `1_925_700_000 * 1e18` |
| ETIMMain | NODE_QUOTA | `300 * 1e6`（USD 6位小数）|
| ETIMMain | FEE_DENOMINATOR | `1000` |
| ETIMMain | NODE_SHARE / LP_SHARE / BURN_SHARE / REWARD_SHARE | 10 / 690 / 250 / 50 |
| ETIMMain | MAX_PROPAGATION_DEPTH | `5` |
| ETIMTaxHook | BPS_DENOMINATOR | `10_000` |
| ETIMTaxHook | MAX_TAX_BPS | `1_000`（10%）|
| ETIMNode | MAX_SUPPLY | `500` |
| ETIMToken | TOTAL_SUPPLY | `2_100_000_000 * 1e18` |
