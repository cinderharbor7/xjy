import test from "node:test";
import assert from "node:assert/strict";
import ganache from "ganache";
import {
  BrowserProvider,
  ContractFactory,
  keccak256,
  toUtf8Bytes,
} from "ethers";
import { compile } from "../../scripts/compile-fingerprint.mjs";
import { sampleMarket } from "../../web/fingerprint/data.js";
import { createEdition } from "../../web/fingerprint/nft.js";

test("ERC-721: deploy, full metadata mint, digest, duplicates, transfer and invalid input", async () => {
  const rpc = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 968, hardfork: "merge" },
    wallet: { totalAccounts: 2 },
    miner: { blockGasLimit: 30000000 },
  });
  const provider = new BrowserProvider(rpc);
  provider.pollingInterval = 20;
  try {
    assert.equal((await provider.getNetwork()).chainId, 968n);
    const signer = await provider.getSigner(),
      other = await provider.getSigner(1),
      a = compile();
    const contract = await new ContractFactory(
      a.abi,
      a.bytecode,
      signer,
    ).deploy();
    await contract.waitForDeployment();
    assert.equal(
      (await provider.getCode(await contract.getAddress())).toLowerCase(),
      a.deployedBytecode.toLowerCase(),
    );
    assert.equal(await contract.supportsInterface("0x80ac58cd"), true);
    const m = sampleMarket(),
      edition = createEdition(m.coins[0], m.sentiment);
    const receipt = await (await contract.mint(edition.uri)).wait();
    assert.equal(receipt.status, 1);
    assert.equal(await contract.ownerOf(1), await signer.getAddress());
    assert.equal(await contract.tokenURI(1), edition.uri);
    assert.equal(
      await contract.metadataHash(1),
      keccak256(toUtf8Bytes(edition.uri)),
    );
    await assert.rejects(contract.mint(edition.uri));
    await assert.rejects(
      contract.mint("https://mutable.example/metadata.json"),
    );
    await assert.rejects(
      contract.mint("data:application/json;base64," + "a".repeat(18000)),
    );
    await (
      await contract.transferFrom(
        await signer.getAddress(),
        await other.getAddress(),
        1,
      )
    ).wait();
    assert.equal(await contract.ownerOf(1), await other.getAddress());
    assert.equal(await contract.tokenURI(1), edition.uri);
    console.log(
      JSON.stringify({
        network: "local EVM 968, NOT public BOT",
        uriBytes: edition.uri.length,
        mintGas: receipt.gasUsed.toString(),
        tokenId: "1",
        transferred: true,
      }),
    );
  } finally {
    await provider.destroy();
    await rpc.disconnect();
  }
});
