import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Autonomous On-chain Risk Guardian · Mock Demo",
  description: "A mock demo of a policy-approved guardian that reduces risk exposure into user-approved defensive assets.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
