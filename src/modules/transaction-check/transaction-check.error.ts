import type { TransactionCheckProblem } from "@/domain/schemas/transaction-check";

export type TransactionCheckErrorCode = Extract<TransactionCheckProblem["code"],
  "INVALID_REQUEST" | "TRANSACTION_NOT_FOUND" | "TRANSACTION_PENDING" | "CONFIGURATION_ERROR"
  | "UNSUPPORTED_NETWORK" | "INVALID_CHAIN_DATA" | "REORG_DETECTED" | "RPC_READ_FAILED">;

const errors: Record<TransactionCheckErrorCode, { status: 400 | 404 | 409 | 503; message: string }> = {
  INVALID_REQUEST: { status: 400, message: "请输入格式正确的 Ethereum 交易哈希。" },
  TRANSACTION_NOT_FOUND: { status: 404, message: "当前 Ethereum 节点未找到这笔交易。" },
  TRANSACTION_PENDING: { status: 409, message: "这笔交易尚未确认，暂时无法生成上链证据报告。" },
  CONFIGURATION_ERROR: { status: 503, message: "服务端尚未配置有效的 Ethereum RPC。" },
  UNSUPPORTED_NETWORK: { status: 503, message: "RPC 不是 Ethereum 主网，已停止核验。" },
  INVALID_CHAIN_DATA: { status: 503, message: "节点返回的交易、区块或日志证据不一致，已停止核验。" },
  REORG_DETECTED: { status: 503, message: "查询期间区块发生变化，无法确认本次证据仍属于主链。" },
  RPC_READ_FAILED: { status: 503, message: "Ethereum 节点读取失败，本次没有生成报告。" },
};

/** Public errors contain only fixed messages, never provider payloads or credentials. */
export class TransactionCheckError extends Error {
  readonly status: 400 | 404 | 409 | 503;
  constructor(readonly code: TransactionCheckErrorCode) {
    super(errors[code].message);
    this.name = "TransactionCheckError";
    this.status = errors[code].status;
  }
}
