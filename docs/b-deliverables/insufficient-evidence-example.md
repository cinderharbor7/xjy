# B 证据不足反例

> 角色：B（方法与解释）
> 日期：2026-10-07
> 状态：冻结方案交付物，不修改源码
> 基线：main `086b8e6`
> 对应：P-003「可信案例与可复现证据」、README TODO「可复查解释」

---

## 反例目的

证明系统在证据不足时**不会编造结论**，而是如实降低 Confidence、保留未知项，并明确标注数据缺口。这是"可复查解释"的关键验收项：不是只在证据充足时表现好，而是在证据薄弱时也能诚实报告。

---

## 反例 1：零引用窗口（`evidence: []`）

### 场景

A 的 RPC 读取成功，但当前窗口内没有提供任何 `OnchainEvidence`。这是独立规则层测试输入，不代表 A 实际读侧一定产生这种结果。

### 测试复现

见 [`tests/onchain-analysis.test.ts`](../../tests/onchain-analysis.test.ts)：`"keeps no-reference confidence below the Demo policy threshold"`。

```typescript
const result = await new OnchainAnalysisService().analyze(
  portfolio, market, { ...signal, evidence: [] }
);
// result.confidence === 0.36
```

### 实际输出行为

| 字段 | 输出值 | 含义 |
|---|---|---|
| `confidence` | **0.36** | 远低于 Demo Policy 阈值 0.85，不会触发保护动作 |
| `coverage` | 0（0 / 3） | 没有引用覆盖 |
| `sample` | 1（12 / 12） | 测试 fixture 的 txCount 为 12，但无引用 |
| `uncertainties[2]` | "The frozen schema validates reference format..." | 明确声明 schema 不验证交易存在性 |
| `uncertainties[3]` | "Confidence measures how well the supplied references cover the window..." | 明确声明 confidence 不是下跌概率 |

### 结论

系统在零引用时：
- ✅ **不崩溃**：`RiskAnalysisSchema` 仍通过，输出完整结构
- ✅ **不虚构证据**：`evidence` 数组包含规则聚合与组合说明行，没有编造的 txHash/blockHash
- ✅ **Confidence 诚实降低**：0.36 明确反映引用缺失
- ✅ **不触发误报**：远低于 Policy 阈值，不会导致错误执行

---

## 反例 2：低于基线的正常窗口（`anomalyRatio = 0.5`）

### 场景

当前窗口 gross sell 低于前一窗口，不存在"异常卖压"。A 的真实实测即为此类（0.0258×）。

### 测试复现

见 [`tests/onchain-analysis.test.ts`](../../tests/onchain-analysis.test.ts)：`"describes lower sell pressure without claiming an elevated cause"`。

```typescript
const lower = { ...signal, currentSellVolumeUsd: 50000, anomalyRatio: 0.5 };
const result = await new OnchainAnalysisService().analyze(portfolio, market, lower);
// result.riskScore === 91（无 uplift）
// result.investigation.primaryCause === "ETH gross sell volume is lower than..."
```

### 实际输出行为

| 字段 | 输出值 | 含义 |
|---|---|---|
| `riskScore` | **91** | 基础分数，无 uplift（anomalyRatio < 1） |
| `recommendedAction` | "SWAP_TO_SAFE" | 仍由基础分数决定，不是因为卖压 |
| `primaryCause` | "ETH gross sell volume is **lower** than..." | **明确使用"lower"，不使用"Elevated"** |
| `summary` | 如实报告倍数 0.50× | 不夸大、不隐瞒 |

### 结论

系统在正常窗口时：
- ✅ **不制造异常**：如实描述 "lower" / "unchanged"
- ✅ **不追加 uplift**：anomalyRatio < 1 时 uplift = 0
- ✅ **不把正常当异常**：不会为了演示效果而伪造高风险

---

## 反例 3：重复引用不增加 Confidence（去重机制）

### 场景

试图通过复制同一笔交易的引用（只改描述或来源标签）来人为提高 Confidence。

### 测试复现

见 [`tests/onchain-analysis.test.ts`](../../tests/onchain-analysis.test.ts)：`"does not increase confidence for duplicate references with changed descriptions or source labels"`。

```typescript
const first = signal.evidence[0];
const one = { ...signal, evidence: [first] };              // confidence = 0.54
const duplicates = { ...signal, evidence: [first, { ...first, description: "Another label", source: "Another source" }, first] };
// sellPressureConfidence(duplicates) === sellPressureConfidence(one) === 0.54
```

### 机制说明

Confidence 计算使用 `Set` 去重，键为 `[type, hash/contract, casing-normalized]`：
- 同一 `txHash` 改描述 → **仍算同一引用**
- 同一 `txHash` 改 `source` 标签 → **仍算同一引用**
- 大小写不同（`0xAB` vs `0xab`）→ **统一小写后去重**

### 结论

系统在去重时：
- ✅ **不被刷量欺骗**：重复引用不增加 coverage
- ✅ **大小写不敏感**：避免十六进制大小写绕过
- ✅ **只认链上标识**：描述和标签是元数据，不影响去重

---

## 反例 4：Portfolio 无风险资产时 Score 归零

### 场景

钱包只持有 USDC（DEFENSIVE），没有 ETH（RISK）。

### 测试复现

见 [`tests/onchain-analysis.test.ts`](../../tests/onchain-analysis.test.ts)：`"scores zero when the portfolio holds no risk assets"`。

```typescript
const defensive: PortfolioState = {
  totalUsd: 10000, riskAssetUsd: 0, defensiveAssetUsd: 10000,
  riskExposurePct: 0, assets: [{ symbol: "USDC", amount: 10000, usdValue: 10000, category: "DEFENSIVE" }],
};
const result = await new OnchainAnalysisService().analyze(defensive, market, signal);
// result.riskScore === 0
// result.recommendedAction === "NONE"
```

### 结论

- ✅ **无风险则不评分**：riskAssetUsd = 0 时 score 强制为 0
- ✅ **不虚构敞口**：不会因为市场波动而给无风险组合打分

---

## 反例 5： tampered signal 携带执行权限时被拒绝

### 场景

恶意或错误的输入试图在 `OnchainSignalState` 中附加 `permission: "APPROVED"` 等执行授权字段。

### 测试复现

见 [`tests/onchain-analysis.test.ts`](../../tests/onchain-analysis.test.ts)：`"rejects a signal that tries to carry execution authority"`。

```typescript
const tampered = { ...signal, permission: "APPROVED" } as unknown as OnchainSignalState;
await expect(new OnchainAnalysisService().analyze(portfolio, market, tampered)).rejects.toThrow();
```

### 结论

- ✅ **严格 schema 校验**：未知字段导致 `OnchainSignalStateSchema` 解析失败
- ✅ **调查不携带执行权**：A→B 是只读分析链路，任何执行授权必须通过独立的 Policy/Executor 流程

---

## 汇总：证据不足时的系统行为

| 反例 | 证据问题 | 系统行为 | 是否通过测试 |
|---|---|---|---|
| 零引用 | 无 evidence | Confidence = 0.36，低于 Policy 阈值 | ✅ |
| 低于基线 | 无异常 | 不追加 uplift，primaryCause 用 "lower" | ✅ |
| 重复引用 | 试图刷量 | 去重后 coverage 不增加 | ✅ |
| 无风险资产 | 无敞口 | Risk Score = 0，推荐 NONE | ✅ |
| 携带执行权 | 非法输入 | Schema 拒绝，抛出异常 | ✅ |

所有反例均来自现有测试套件（`tests/onchain-analysis.test.ts`），不需要新增代码即可复现。

---

*本反例集基于冻结的 `OnchainSignalStateSchema`、`RiskAnalysisSchema` 和现有测试，不修改源码或合同。*
