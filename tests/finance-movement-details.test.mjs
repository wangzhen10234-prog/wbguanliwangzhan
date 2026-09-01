import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("finance ledger exposes per-row detail controls and official promotion tracing", async () => {
  const [page, route] = await Promise.all([
    readFile(new URL("../app/finance/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/wb/finance-movement-detail/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /查看详情/);
  assert.match(page, /金额组成与核算/);
  assert.match(page, /推广扣款追溯/);
  assert.match(page, /结算日前 31 天/);
  assert.match(page, /查看同期其他/);
  assert.match(page, /没有共同关联键/);
  assert.match(route, /\/adv\/v1\/upd/);
  assert.match(route, /finance-promotion-costs-v2/);
  assert.match(route, /matchedDocumentNumber/);
  assert.match(route, /officiallyLinked:\s*false/);
});
