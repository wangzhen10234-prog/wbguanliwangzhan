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
  assert.match(html, /店铺切换/);
  assert.match(html, /王振1号店/);
  assert.doesNotMatch(html, /当前 WB 店铺/);
  assert.match(html, /下一家 WB 店铺/);
  assert.match(html, /提供 API 后即可启用/);
  assert.match(html, /经营总览/);
  assert.match(html, /销售趋势/);
  assert.match(html, /评价与提问/);
  assert.match(html, /销售状况/);
  assert.match(html, /href="\/returns"[^>]*>.*退货/s);
  assert.match(html, /综合商品分析/);
  assert.match(html, /产品详情/);
  assert.match(html, /价格管理/);
  assert.match(html, /库存监控/);
  assert.match(html, /href="\/advertising"[^>]*>.*推广/s);
  assert.match(html, /平台活动评估/);
  assert.match(html, /08:00 · 14:00 · 19:00 · 23:00/);
  assert.match(html, /class="sidebar-scroll-area"/);
  assert.doesNotMatch(html, /class="brand"/);
  const sidebar = html.match(/<aside[^>]*class="sidebar"[^>]*>(.*?)<\/aside>/s)?.[1] ?? "";
  assert.ok(sidebar.indexOf("store-switcher") < sidebar.indexOf("sidebar-scroll-area"), "store switcher should be the first sidebar module");
  const navigation = html.match(/<nav[^>]*aria-label="主导航"[^>]*>(.*?)<\/nav>/s)?.[1] ?? "";
  const expectedOrder = ["经营总览", "商品优化诊断", "评价与提问", "销售状况", "综合商品分析", "产品详情", "价格管理", "库存监控", "退货", "回款与余额", "平台活动评估", "推广"];
  let previousIndex = -1;
  for (const label of expectedOrder) {
    const currentIndex = navigation.indexOf(label);
    assert.ok(currentIndex > previousIndex, `${label} should appear in the requested sidebar order`);
    previousIndex = currentIndex;
  }
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|Your site is taking shape/);
});

test("server-renders the product optimization audit in the second sidebar position", async () => {
  const response = await render("/audit");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /商品优化诊断/);
  assert.match(html, /所有经营数字来自 WB API/);
  assert.match(html, /商品诊断与优化清单/);
  assert.match(html, /图片审美不伪造机器结论/);
  assert.match(html, /查看完整诊断/);
});

test("server-renders the WB reviews and questions workbench", async () => {
  const response = await render("/reviews");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /评价与提问/);
  assert.match(html, /评价、星级与买家提问均来自 WB 官方 API/);
  assert.match(html, /WB 店铺官方评分/);
  assert.match(html, /商品评价诊断/);
  assert.match(html, /五星分布/);
  assert.match(html, /主要问题/);
  assert.match(html, /“问题分类”和“修改建议”由系统/);
  assert.match(html, /不冒充 WB 官方结论/);
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
  assert.match(html, /退货时间/);
  assert.match(html, /查看详情/);
  assert.doesNotMatch(html, />目的取货点<\/th>/);
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

test("server-renders the WB price and profit management workbench", async () => {
  const response = await render("/prices");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /价格管理/);
  assert.match(html, /WB 后台价格已连接商品成本表/);
  assert.match(html, /后台原价/);
  assert.match(html, /折扣比例/);
  assert.match(html, /最终折扣价/);
  assert.match(html, /当前价格预计盈亏/);
  assert.match(html, /利润率/);
  assert.match(html, /不会再次按后台折扣比例重复扣费/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|Your site is taking shape/);
});

test("server-renders the completed-today sales label", async () => {
  const response = await render("/sales");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /今日已完结订单/);
  assert.match(html, /正常完结/);
  assert.match(html, /完结日期 · 北京时间/);
  assert.match(html, /预估成本支出/);
  assert.match(html, /综合净利润预估/);
  assert.match(html, /账单到账后自动替换且不重复计算/);
  assert.match(html, /平台净扣费＋商品成本/);
  assert.match(html, /当前新订单/);
  assert.match(html, /supplier-new-count/);
  assert.match(html, /全部签收结果/);
  assert.match(html, /全部 WB 状态/);
  assert.match(html, /WB 已分拣/);
  assert.match(html, /到达取货点 \/ 待签收/);
  assert.match(html, /非正常签收（含无效）/);
  assert.match(html, /只看无效订单/);
  assert.match(html, /无效.*?笔已排除/s);
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
