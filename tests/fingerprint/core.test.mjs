import test from "node:test";
import assert from "node:assert/strict";
import {
  marketStats,
  candleStats,
  sampleMarket,
  visualParameters,
} from "../../web/fingerprint/data.js";
import { createEdition } from "../../web/fingerprint/nft.js";

test("missing or malformed data remains missing, not zero", () => {
  const empty = marketStats({});
  assert.equal(empty.price, null);
  assert.equal(empty.amplitude, null);
  assert.equal(
    marketStats({
      lastPrice: "broken",
      openPrice: "0",
      highPrice: "1",
      lowPrice: "0",
    }).amplitude,
    null,
  );
  assert.equal(marketStats({ lastPrice: "0" }).price, 0);
});
test("daily amplitude and logarithmic volatility have explicit units", () => {
  assert.equal(
    marketStats({ openPrice: "100", highPrice: "110", lowPrice: "90" })
      .amplitude,
    20,
  );
  const flat = candleStats([{ close: 100 }, { close: 100 }, { close: 100 }]);
  assert.equal(flat.volatility, 0);
  assert.equal(flat.drawdown, 0);
  assert.equal(
    candleStats([{ close: 100 }, { close: 80 }, { close: 90 }]).drawdown,
    20,
  );
  assert.equal(candleStats([]).volatility, null);
});
test("visual parameters stay bounded when data is absent or extreme", () => {
  const c = sampleMarket().coins[0];
  for (const value of [0, 100000, null]) {
    const p = visualParameters(
      { ...c, amplitude: value, volume: value },
      { value },
    );
    assert.ok(p.roughness >= 0 && p.roughness <= 1);
    assert.ok(p.mood >= 0 && p.mood <= 1);
    assert.ok(p.activity >= 0 && p.activity <= 1);
  }
});
test("NFT roundtrip preserves Unicode, source state, image and fits contract limit", () => {
  const m = sampleMarket(),
    edition = createEdition(m.coins[0], m.sentiment),
    metadata = JSON.parse(
      Buffer.from(edition.uri.split(",")[1], "base64").toString("utf8"),
    );
  assert.equal(metadata.properties.sourceMode, "demo");
  assert.equal(metadata.properties.sentiment.scope, "market-wide");
  assert.equal(
    Buffer.from(metadata.image.split(",")[1], "base64").toString("utf8"),
    edition.svg,
  );
  assert.ok(
    edition.uri.length <= 18000,
    `URI too large: ${edition.uri.length}`,
  );
  const again = createEdition(m.coins[0], m.sentiment);
  assert.equal(again.svg, edition.svg);
});
