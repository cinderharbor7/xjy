import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Aave Position Reader · Live Read Only",
  description: "Read Ethereum mainnet Aave V3 Core positions with block evidence.",
};

export default function PositionLayout({ children }: { children: ReactNode }) {
  return children;
}
