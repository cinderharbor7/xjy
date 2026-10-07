import solc from "solc";
import { readFileSync, writeFileSync } from "node:fs";
import { keccak256 } from "viem";

const input = { language: "Solidity", sources: { "RiskReportRegistry.sol": { content: readFileSync("contracts/RiskReportRegistry.sol", "utf8").replace(/\r\n/g, "\n") } }, settings: {
  optimizer: { enabled: true, runs: 200 }, evmVersion: "paris",
  outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
} };
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors ?? []).filter(e => e.severity === "error");
if (errors.length) throw new Error(errors.map(e => e.formattedMessage).join("\n"));
const contract = output.contracts["RiskReportRegistry.sol"].RiskReportRegistry;
const artifact = { contractName: "RiskReportRegistry", compiler: solc.version(), evmVersion: "paris", abi: contract.abi,
  bytecode: `0x${contract.evm.bytecode.object}`, deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
  runtimeCodeHash: keccak256(`0x${contract.evm.deployedBytecode.object}`) };
const target = "src/modules/attestation/registry-artifact.json";
const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== serialized) throw new Error("Registry artifact differs from source. Run pnpm contract:compile.");
  console.log("Registry artifact matches pinned compiler/source.");
} else { writeFileSync(target, serialized); console.log(`Compiled ${target} (Paris EVM, no PUSH0 dependency).`); }
