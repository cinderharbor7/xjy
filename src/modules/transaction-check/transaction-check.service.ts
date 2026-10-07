import {
  classifyTransaction, TransactionCheckReportSchema, type TransactionCheckReport,
} from "@/domain/schemas/transaction-check";
import type { TransactionCheckClient } from "./transaction-check.client";
import { TransactionCheckError } from "./transaction-check.error";
import { readTransactionObservation } from "./transaction-check.reader";

export class TransactionCheckService {
  constructor(private readonly client: TransactionCheckClient) {}

  async check(txHash: string): Promise<TransactionCheckReport> {
    const observation = await readTransactionObservation(this.client, txHash);
    const { transaction, supportedSwaps } = observation;
    const classification = classifyTransaction(transaction.status, supportedSwaps);
    const explanations = {
      SUPPORTED_POOL_SELL: { headline: "本池日志确认存在 WETH 换 USDC 的兑换", summary: "交易包含 WETH 流入、USDC 流出本池的 Swap 事件。这支持本池内卖出方向，不证明发送方在整笔交易净卖出，更不能据此解释 ETH 下跌。" },
      SUPPORTED_POOL_BUY: { headline: "本池日志确认存在 USDC 换 WETH 的兑换", summary: "交易包含 USDC 流入、WETH 流出本池的 Swap 事件。这支持本池内买入方向，不等于发送方在整笔交易净买入。" },
      SUPPORTED_POOL_MIXED: { headline: "本池内同时出现买入与卖出方向", summary: "这笔交易包含两个方向的 Swap 事件。报告逐项保留数量，不将它们合并成发送方的净买卖结论。" },
      NO_SUPPORTED_SWAP: { headline: "已核验交易，当前范围没有可确认的兑换证据", summary: "外层 ETH 金额描述的是这笔交易附带的原生 ETH；它不等于卖出。回执中未发现足以分类的本池非零 Swap 事件，也不能据此断言其他地方没有卖出。" },
      REVERTED: { headline: "交易已上链，但执行失败", summary: "回执状态为 reverted。外层金额是尝试发送的金额，执行被回滚，不能当作成功转账或成功兑换。" },
    }[classification];
    const facts = [
      `区块 ${transaction.blockNumber}，时间 ${transaction.timestamp}；回执状态 ${transaction.status === "SUCCESS" ? "成功" : "失败并回滚"}。`,
      `外层发送地址 ${transaction.from}；接收地址 ${transaction.to ?? "合约创建（没有接收地址）"}。`,
      `外层交易${transaction.status === "REVERTED" ? "尝试附带" : "附带"}原生 ETH：${transaction.nativeValueEth} ETH；输入数据${transaction.input === "0x" ? "为空" : "不为空"}。`,
      `回执共有 ${transaction.logCount} 条日志；其中 ${supportedSwaps.length} 条符合已核验单池的非零兑换方向。`,
      ...supportedSwaps.map((swap) => `日志 ${swap.logIndex}：${swap.direction === "SELL_ETH" ? "WETH → USDC" : "USDC → WETH"}，${swap.wethAmount} WETH / ${swap.usdcAmount} USDC。`),
    ];
    const report = TransactionCheckReportSchema.safeParse({
      mode: "LIVE_READ_ONLY", network: "ethereum-mainnet", checkedAt: new Date().toISOString(),
      observation, classification, ...explanations, confirmedFacts: facts,
      uncertainties: [
        "事实读取来自单个配置 RPC，浏览器链接供独立核查；未做多节点或密码学验证。",
        "兑换核验只覆盖 Ethereum 主网 Uniswap V3 WETH/USDC 0.05% 单池，不覆盖其他池、DEX 或链。",
        "未读取内部调用 trace、后续资金路径或交易所成交；不能确定整笔交易的净买卖方向。",
        "发送地址是链上地址，未核验所属机构或个人，也无法确认转账动机。",
        "链上交易与行情先后发生不证明因果；本报告不判断是否导致 ETH 下跌，也不提供买卖建议。",
        "USDC 数量按代币 decimals 计算，未读取历史美元报价；不能当作等额美元价值。",
      ],
      nextSteps: [
        "打开交易和区块出处，核对原始交易、回执状态及日志。",
        "如果消息声称某机构卖出，请另行核验地址标签、完整资金路径与实际成交证据。",
      ],
    });
    if (!report.success) throw new TransactionCheckError("INVALID_CHAIN_DATA");
    return report.data;
  }
}
