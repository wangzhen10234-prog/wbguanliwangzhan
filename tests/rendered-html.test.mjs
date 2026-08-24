import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the WB Insight dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /WB Insight/);
  assert.match(html, /俄罗斯店铺经营分析/);
  assert.match(html, /经营总览/);
  assert.match(html, /销售趋势/);
  assert.match(html, /销售状况/);
  assert.match(html, /综合商品分析/);
  assert.match(html, /产品详情/);
  assert.match(html, /库存监控/);
  assert.match(html, /平台活动评估/);
  assert.match(html, /08:00 · 14:00 · 19:00 · 23:00/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|Your site is taking shape/);
});

test("server-renders the promotion evaluation workbench", async () => {
  const response = await render("/promotions");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /平台活动评估/);
  assert.match(html, /促销活动日历/);
  assert.match(html, /当前正在参与活动的商品/);
  assert.match(html, /当前正在参与/);
  assert.match(html, /已报名待开始/);
  assert.match(html, /商品活动盈亏明细/);
  assert.match(html, /预计盈亏金额/);
  assert.match(html, /预计利润率/);
  assert.match(html, /点击查看可盈利商品明细/);
  assert.match(html, /点击查看预计亏损商品/);
  assert.match(html, /排名\/流量加成/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|Your site is taking shape/);
});
