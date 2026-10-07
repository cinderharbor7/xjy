import type { OnchainSignalState } from "@/domain/types";

export interface OnchainSignalAdapter {
  getSignal(): Promise<OnchainSignalState>;
}
