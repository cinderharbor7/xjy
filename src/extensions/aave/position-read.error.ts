export type PositionReadErrorCode =
  | "CONFIGURATION_ERROR"
  | "UNSUPPORTED_NETWORK"
  | "INVALID_CHAIN_DATA"
  | "RPC_READ_FAILED"
  | "NO_DEBT";

export class PositionReadError extends Error {
  readonly name = "PositionReadError";

  constructor(readonly code: PositionReadErrorCode, message: string) {
    super(message);
  }
}
