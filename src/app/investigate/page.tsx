import type { Metadata } from "next";
import TransactionCheck from "./transaction-check";

export const metadata: Metadata = {
  title: "ETH 交易核验 · 只读 MVP",
  description: "读取 Ethereum 主网交易，核验外层转账与指定 Uniswap 池内的兑换证据，并说明尚不能确认的内容。",
};

export default function InvestigatePage() {
  return <TransactionCheck />;
}
