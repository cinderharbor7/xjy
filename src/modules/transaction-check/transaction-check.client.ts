import { createPublicClient, http, type Abi, type Address, type Hash } from "viem";
import { mainnet } from "viem/chains";
import { TransactionCheckError } from "./transaction-check.error";

/** Unknown results force runtime validation before data is used as evidence. */
export interface TransactionCheckClient {
  getChainId(): Promise<unknown>;
  getTransaction(parameters: { hash: Hash }): Promise<unknown>;
  getTransactionReceipt(parameters: { hash: Hash }): Promise<unknown>;
  getBlock(parameters: { blockHash: Hash } | { blockNumber: bigint }): Promise<unknown>;
  readContract(parameters: {
    address: Address;
    abi: Abi;
    functionName: string;
    blockHash: Hash;
    requireCanonical: true;
  }): Promise<unknown>;
}

export function createTransactionCheckClient(rpcUrl: string): TransactionCheckClient {
  let url: URL;
  try {
    url = new URL(rpcUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
  } catch {
    throw new TransactionCheckError("CONFIGURATION_ERROR");
  }
  const client = createPublicClient({
    chain: mainnet,
    cacheTime: 0,
    transport: http(url.href, { retryCount: 0, timeout: 10_000 }),
  });
  return {
    getChainId: () => client.getChainId(),
    getTransaction: (parameters) => client.getTransaction(parameters),
    getTransactionReceipt: (parameters) => client.getTransactionReceipt(parameters),
    getBlock: (parameters) => client.getBlock(parameters),
    readContract: (parameters) => client.readContract(parameters),
  };
}
