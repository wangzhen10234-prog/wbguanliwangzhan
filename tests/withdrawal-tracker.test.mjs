import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const routePath = new URL("../app/api/wb/withdrawal-tracker/route.ts", import.meta.url);
const pagePath = new URL("../app/finance/page.tsx", import.meta.url);

test("withdrawal tracker uses the official balance endpoint with a one-minute refresh window", async () => {
  const route = await readFile(routePath, "utf8");
  assert.match(route, /finance-api\.wildberries\.ru\/api\/v1\/account\/balance/);
  assert.match(route, /const BALANCE_TTL_MS = 60_000/);
  assert.match(route, /intervalSeconds: 60/);
});

test("withdrawal tracker is isolated per store and never claims an unavailable official status", async () => {
  const route = await readFile(routePath, "utf8");
  assert.match(route, /scopedStoreKey\(storeId, "withdrawal-tracker-v1"\)/);
  assert.match(route, /statusApiAvailable: false/);
  assert.match(route, /不返回提现申请单、付款处理中、银行打款或到账状态/);
  assert.match(route, /action === "arrived" \? "arrived" : "cancelled"/);
});

test("finance page exposes tracking, manual verification and the official limitation", async () => {
  const page = await readFile(pagePath, "utf8");
  assert.match(page, /提现进度监测/);
  assert.match(page, /每 60 秒核对/);
  assert.match(page, /打开 WB 付款历史/);
  assert.match(page, /我已确认到账/);
  assert.match(page, /系统不会用余额变化冒充已到账/);
  assert.match(page, /\/api\/wb\/withdrawal-tracker/);
});
