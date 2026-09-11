import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) }, AUTH_TEST_BYPASS: "true" },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function requestWithoutLogin(pathname = "/sales") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("auth-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`https://wbwork.duoduolink.com${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("protects business pages and APIs before login", async () => {
  const page = await requestWithoutLogin("/sales?from=2026-09-01");
  assert.equal(page.status, 302);
  assert.match(page.headers.get("location") ?? "", /^https:\/\/wbwork\.duoduolink\.com\/login\?next=/);
  assert.match(page.headers.get("set-cookie") ?? "", /__Host-wb_session=.*Max-Age=0/);

  const api = await requestWithoutLogin("/api/product-costs");
  assert.equal(api.status, 401);
  assert.deepEqual(await api.json(), { error: "请先登录" });
});

test("keeps the login page public and security-hardened", async () => {
  const response = await requestWithoutLogin("/login");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const html = await response.text();
  assert.match(html, /登录经营后台/);
  assert.match(html, /安全登录/);
});

test("server-renders the WB Insight dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /WB Insight/);
  assert.match(html, /俄罗斯店铺经营分析/);
  assert.match(html, /店铺切换/);
  assert.match(html, /王振1号店/);
  assert.match(html, /王振2号店（CL）/);
  assert.doesNotMatch(html, /当前 WB 店铺/);
  assert.match(html, /2(?:<!--.*?-->)?\s*家已连接/);
  assert.doesNotMatch(html, /下一家 WB 店铺/);
  assert.match(html, /经营总览/);
  assert.match(html, /数据表左右滚动控制/);
  assert.match(html, /拖动以左右查看数据/);
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
  assert.match(html, /href="\/settings"[^>]*>.*系统设置/s);
  assert.match(html, /账号、API 与登录设备/);
  assert.match(html, /添加新店铺/);
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
  assert.match(html, /取回时间/);
  assert.match(html, /WB completedDt · 北京时间/);
  assert.match(html, /按取回时间降序排列/);
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

test("server-renders editable product matching controls", async () => {
  const response = await render("/details");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /匹配 WB 产品/);
  assert.match(html, /白色为可编辑数据/);
  assert.match(html, /按卖家商品编号自动对应/);
  assert.match(html, /产品分类/);
  assert.match(html, /按产品分类筛选/);
  assert.match(html, /全部产品分类/);
  assert.match(html, /表格编辑/);
  assert.match(html, /卡片展示/);
  assert.match(html, /操作/);
  assert.match(html, /删除/);
  assert.doesNotMatch(html, /主推分类/);

  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/details/page.tsx", import.meta.url), "utf8"));
  assert.match(source, /卡片完整视图/);
  assert.match(source, /每张卡片直接展示全部产品资料、费用、售价和利润/);
  for (const label of ["商品资料", "基础费用", "平台与售后费用", "价格与利润", "当前在售价", "当前在售总成本", "目标毛利率", "备注", "更新时间"]) {
    assert.match(source, new RegExp(label));
  }
});

test("server-renders the completed-today sales label", async () => {
  const response = await render("/sales");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /今日已完结订单/);
  assert.match(html, /正常完结/);
  assert.match(html, /完结日期 · 北京时间/);
  assert.match(html, /按订单时间升序排列/);
  assert.match(html, /按签收完结时间降序排列/);
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

test("server-renders system settings with credential and device panels", async () => {
  const response = await render("/settings");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /系统设置/);
  assert.match(html, /账号与密码/);
  assert.match(html, /登录设备/);
  assert.match(html, /店铺与 API/);
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/settings/page.tsx", import.meta.url), "utf8"));
  assert.match(source, /添加新店铺/);
  assert.match(source, /API 仅保存在服务器，并经过加密/);
  assert.match(source, /剩余 30 天以内显示橙色提醒/);
  assert.match(source, /验证并保存/);
});

function fakeKv(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    async get(key, type) {
      const value = values.get(key);
      if (value === undefined) return null;
      return type === "json" ? JSON.parse(value) : value;
    },
    async put(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
    async list({ prefix = "", limit = 100 } = {}) {
      return { keys: [...values.keys()].filter((key) => key.startsWith(prefix)).slice(0, limit).map((name) => ({ name })), list_complete: true };
    },
  };
}

async function authConfig(username, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, material, 256);
  return {
    username,
    passwordSalt: Buffer.from(salt).toString("base64url"),
    passwordHash: Buffer.from(bits).toString("base64url"),
    passwordIterations: 100_000,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
}

test("records successful login device, IP and approximate region behind authentication", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("login-history-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const username = "history-user";
  const password = "A-secure-test-password-2026";
  const kv = fakeKv({ "site-auth:config": JSON.stringify(await authConfig(username, password)) });
  const env = {
    AUTH_KV: kv,
    AUTH_SESSION_SECRET: "test-session-secret-that-is-long-enough",
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
  const protectedHistory = await worker.fetch(new Request("https://wbwork.duoduolink.com/api/auth/login-history"), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(protectedHistory.status, 401);
  assert.deepEqual(await protectedHistory.json(), { error: "登录已失效，请重新登录" });
  const login = new Request("https://wbwork.duoduolink.com/api/auth/login", {
    method: "POST",
    headers: {
      Origin: "https://wbwork.duoduolink.com",
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36",
      "CF-Connecting-IP": "203.0.113.8",
      "CF-IPCountry": "CN",
    },
    body: JSON.stringify({ username, password }),
  });
  Object.defineProperty(login, "cf", { value: { country: "CN", region: "Zhejiang", regionCode: "ZJ", city: "Hangzhou", timezone: "Asia/Shanghai", colo: "HKG" } });
  const loginResponse = await worker.fetch(login, env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(loginResponse.status, 200);
  const cookie = (loginResponse.headers.get("set-cookie") || "").split(";")[0];
  assert.match(cookie, /^__Host-wb_session=/);

  const historyResponse = await worker.fetch(new Request("https://wbwork.duoduolink.com/api/auth/login-history", { headers: { Cookie: cookie } }), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json();
  assert.equal(history.records.length, 1);
  assert.equal(history.records[0].ip, "203.0.113.8");
  assert.equal(history.records[0].device, "电脑");
  assert.equal(history.records[0].browser, "Chrome");
  assert.equal(history.records[0].operatingSystem, "macOS");
  assert.match(history.records[0].location, /中国.*浙江省.*Hangzhou/);
  assert.equal(history.records[0].current, true);
});

function testJwt({ expiresInSeconds = 120 * 24 * 60 * 60 } = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const permissionMask = [1, 3, 4, 6, 7, 11, 13].reduce((mask, position) => mask + 2 ** (position - 1), 0);
  return `${encode({ alg: "ES256", typ: "JWT" })}.${encode({ acc: 3, exp: now + expiresInSeconds, iat: now, s: permissionMask, sid: "managed-store-seller" })}.test-signature-that-is-not-returned-to-the-browser`;
}

test("manages store APIs behind login without returning or storing plaintext tokens", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("store-management-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const username = "store-admin";
  const password = "Another-secure-test-password-2026";
  const kv = fakeKv({ "site-auth:config": JSON.stringify(await authConfig(username, password)) });
  const env = {
    AUTH_KV: kv,
    AUTH_SESSION_SECRET: "store-management-session-secret-for-tests",
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
  const context = { waitUntil() {}, passThroughOnException() {} };

  const anonymous = await worker.fetch(new Request("https://wbwork.duoduolink.com/api/settings/stores"), env, context);
  assert.equal(anonymous.status, 401);

  const loginResponse = await worker.fetch(new Request("https://wbwork.duoduolink.com/api/auth/login", {
    method: "POST",
    headers: { Origin: "https://wbwork.duoduolink.com", "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  }), env, context);
  assert.equal(loginResponse.status, 200);
  const cookie = (loginResponse.headers.get("set-cookie") || "").split(";")[0];
  const rawToken = testJwt();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "https://common-api.wildberries.ru/ping");
    return new Response(JSON.stringify({ Status: "OK" }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  let createResponse;
  try {
    createResponse = await worker.fetch(new Request("https://wbwork.duoduolink.com/api/settings/stores", {
      method: "POST",
      headers: { Origin: "https://wbwork.duoduolink.com", Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save", id: "", name: "王振3号店", apiToken: rawToken }),
    }), env, context);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(createResponse.status, 200);
  const created = await createResponse.json();
  const createdStore = created.stores.find((store) => store.id === created.storeId);
  assert.equal(createdStore.name, "王振3号店");
  assert.equal(createdStore.connected, true);
  assert.equal(createdStore.status, "active");
  assert.ok(createdStore.permissions.includes("价格与折扣"));
  assert.doesNotMatch(JSON.stringify(created), new RegExp(rawToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const stored = await kv.get(`site-config:store:${created.storeId}`, "json");
  assert.ok(stored.apiTokenCipher);
  assert.ok(stored.apiTokenIv);
  assert.equal(stored.apiToken, undefined);
  assert.doesNotMatch(JSON.stringify(stored), new RegExp(rawToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const clearResponse = await worker.fetch(new Request("https://wbwork.duoduolink.com/api/settings/stores", {
    method: "POST",
    headers: { Origin: "https://wbwork.duoduolink.com", Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "clear-token", id: created.storeId }),
  }), env, context);
  assert.equal(clearResponse.status, 200);
  assert.equal((await clearResponse.json()).stores.find((store) => store.id === created.storeId).connected, false);

  const renameResponse = await worker.fetch(new Request("https://wbwork.duoduolink.com/api/settings/stores", {
    method: "POST",
    headers: { Origin: "https://wbwork.duoduolink.com", Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "save", id: created.storeId, name: "王振3号店（已停用）", apiToken: "" }),
  }), env, context);
  assert.equal(renameResponse.status, 200);
  assert.equal((await renameResponse.json()).stores.find((store) => store.id === created.storeId).connected, false);

  const deleteResponse = await worker.fetch(new Request("https://wbwork.duoduolink.com/api/settings/stores", {
    method: "POST",
    headers: { Origin: "https://wbwork.duoduolink.com", Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete", id: created.storeId }),
  }), env, context);
  assert.equal(deleteResponse.status, 200);
  assert.equal((await deleteResponse.json()).stores.some((store) => store.id === created.storeId), false);
});

test("renders clickable inventory summary filters linked to the stock detail table", async () => {
  const response = await render("/stock");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /aria-label="库存商品快捷筛选"/);
  assert.match(html, /<button[^>]*aria-controls="stock-detail-table"[^>]*>.*可售库存总量/s);
  assert.match(html, /<button[^>]*aria-controls="stock-detail-table"[^>]*>.*有库存商品/s);
  assert.match(html, /<button[^>]*aria-controls="stock-detail-table"[^>]*>.*即将缺货/s);
  assert.match(html, /<button[^>]*aria-controls="stock-detail-table"[^>]*>.*库存偏低/s);
  assert.match(html, /<button[^>]*aria-controls="stock-detail-table"[^>]*>.*周转较慢/s);
  assert.match(html, /id="stock-detail-table"/);
});

test("keeps product cards compact with four, three, two and one-column responsive layouts", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.product-card-grid\s*\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /@media \(max-width:1800px\)\{\.product-card-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}\}/);
  assert.match(css, /@media \(max-width:1250px\)\{\.product-card-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\}/);
  assert.match(css, /@media \(max-width:760px\).*\.product-card-grid\{grid-template-columns:1fr/s);
});
