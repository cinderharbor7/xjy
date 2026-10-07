import { TransactionCheckReportSchema } from "@/domain/schemas/transaction-check";
import { createTransactionCheckClient } from "@/modules/transaction-check/transaction-check.client";
import { TransactionCheckError } from "@/modules/transaction-check/transaction-check.error";
import { TransactionCheckService } from "@/modules/transaction-check/transaction-check.service";

/** Server composition for a live read. No Guardian state, wallet or executor. */
export function createTransactionCheckService() {
  const rpc = process.env.ETHEREUM_RPC_URL?.trim();
  try {
    if (!rpc || !["http:", "https:"].includes(new URL(rpc).protocol)) throw new Error();
  } catch {
    throw new TransactionCheckError("CONFIGURATION_ERROR");
  }
  return new TransactionCheckService(createTransactionCheckClient(rpc!));
}

export async function checkTransaction(txHash: string) {
  const parsed = TransactionCheckReportSchema.safeParse(await createTransactionCheckService().check(txHash));
  if (!parsed.success) throw new TransactionCheckError("INVALID_CHAIN_DATA");
  return parsed.data;
}
