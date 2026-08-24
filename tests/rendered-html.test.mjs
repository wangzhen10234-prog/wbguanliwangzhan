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
  assert.match(html, /href="\/returns"[^>]*>.*退货/s);
  assert.match(html, /综合商品分析/);
  assert.match(html, /产品详情/);
  assert.match(html, /库存监控/);
  assert.match(html, /href="\/advertising"[^>]*>.*推广/s);
  assert.match(html, /平台活动评估/);
  assert.match(html, /08:00 · 14:00 · 19:00 · 23:00/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|Your site is taking shape/);
});

test("server-renders the WB returns and logistics workbench", async () => {
  const response = await render("/returns");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /退货订单与物流均来自 WB 官方 API/);
  assert.match(html, /买家退货申请/);
  assert.match(html, /退货订单与物流明细/);
  assert.match(html, /运输至取货点/);
  assert.match(html, /已到达，可取回/);
  assert.match(html, /查看物流/);
  assert.match(html, /不会补造物流节点/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|Your site is taking shape/);
});

test("server-renders the WB advertising workbench", async () => {
  const response = await render("/advertising");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /推广数据全部来自 WB Promotion API/);
  assert.match(html, /当前推广活动/);
  assert.match(html, /当前出价/);
  assert.match(html, /WB 最低出价/);
  assert.match(html, /WB 官方推荐/);
  assert.match(html, /系统建议价/);
  assert.match(html, /商品推广与出价明细/);
  assert.match(html, /广告后净利润/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|Your site is taking shape/);
});

test("server-renders the completed-today sales label", async () => {
  const response = await render("/sales");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /今日已完结订单/);
  assert.match(html, /正常完结/);
  assert.doesNotMatch(html, /今日活跃订单/);
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
