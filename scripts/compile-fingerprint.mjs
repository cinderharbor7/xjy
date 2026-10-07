import solc from "solc";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
export function compile() {
  const input = {
    language: "Solidity",
    sources: {
      "CurrencyFingerprint.sol": {
        content: readFileSync(
          resolve(root, "contracts/CurrencyFingerprint.sol"),
          "utf8",
        ),
      },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
        },
      },
    },
  };
  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import(path) {
        try {
          return {
            contents: readFileSync(resolve(root, "node_modules", path), "utf8"),
          };
        } catch {
          return { error: `Missing import: ${path}` };
        }
      },
    }),
  );
  const errors = (output.errors || []).filter((e) => e.severity === "error");
  if (errors.length)
    throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  const c = output.contracts["CurrencyFingerprint.sol"].CurrencyFingerprint;
  return {
    name: "CurrencyFingerprint",
    compiler: solc.version(),
    evmVersion: "paris",
    abi: c.abi,
    bytecode: "0x" + c.evm.bytecode.object,
    deployedBytecode: "0x" + c.evm.deployedBytecode.object,
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const artifact = compile();
  mkdirSync(resolve(root, "web/public"), { recursive: true });
  writeFileSync(
    resolve(root, "web/public/fingerprint-contract.json"),
    JSON.stringify(artifact),
  );
  console.log(
    `Contract compiled: ${artifact.compiler}; Paris EVM; ${artifact.bytecode.length / 2 - 1} bytes`,
  );
}
