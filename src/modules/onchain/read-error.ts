export type EthereumReadErrorCode =
  | "CONFIGURATION_ERROR"
  | "INVALID_ARGUMENT"
  | "INVALID_WALLET"
  | "UNSUPPORTED_NETWORK"
  | "INVALID_CHAIN_DATA"
  | "STALE_PRICE"
  | "REORG_DETECTED"
  | "EMPTY_BASELINE"
  | "RPC_READ_FAILED";

export class EthereumReadError extends Error {
  readonly name = "EthereumReadError";

  constructor(readonly code: EthereumReadErrorCode, message: string) {
    super(message);
  }
}

/** RPC exceptions can contain endpoint credentials, request payloads and nested causes. */
export async function withEthereumRead<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof EthereumReadError) throw error;
    throw new EthereumReadError("RPC_READ_FAILED", "Unable to read the required Ethereum data. Check the server RPC configuration.");
  }
}
