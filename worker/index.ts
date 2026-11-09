/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  MANAGED_STORE_PREFIX,
  decodeWbToken,
  decryptWbToken,
  encryptWbToken,
  managedStoreKey,
  safeStoreId,
  type ManagedStoreRecord,
  type WbTokenMetadata,
} from "../app/_lib/wb-store-management";

interface Env {
  ASSETS: Fetcher;
  AUTH_KV?: KVNamespace;
  AUTH_SESSION_SECRET?: string;
  AUTH_TEST_BYPASS?: string;
  DB?: D1Database;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  WB_API_TOKEN?: string;
  WB_API_TOKEN_CL?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type AuthConfig = {
  username: string;
  passwordSalt: string;
  passwordHash: string;
  passwordIterations: number;
  version: number;
  updatedAt: string;
  mustChangePassword?: boolean;
};

type SessionPayload = {
  username: string;
  version: number;
  expiresAt: number;
  sessionId?: string;
};

type LoginRecord = {
  id: string;
  loggedInAt: string;
  username: string;
  ip: string;
  country: string;
  region: string;
  city: string;
  location: string;
  timezone: string;
  edge: string;
  device: string;
  browser: string;
  operatingSystem: string;
};

const AUTH_CONFIG_KEY = "site-auth:config";
const AUTH_LOGIN_PREFIX = "site-auth:login:";
const AUTH_COOKIE = "__Host-wb_session";
const SESSION_SECONDS = 60 * 60 * 12;
const LOGIN_HISTORY_SECONDS = 60 * 60 * 24 * 180;
// Cloudflare Workers supports PBKDF2 up to 100,000 iterations.
const PASSWORD_ITERATIONS = 100_000;
const textEncoder = new TextEncoder();

const BUILTIN_STORES = [
  { id: "primary", name: "王振1号店", badge: "主", description: "主店铺", builtin: true },
  { id: "cl", name: "王振2号店（CL）", badge: "CL", description: "CL 店铺", builtin: true },
] as const;

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function passwordHash(password: string, salt: Uint8Array, iterations = PASSWORD_ITERATIONS) {
  const material = await crypto.subtle.importKey("raw", textEncoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, 256);
  return new Uint8Array(bits);
}

async function passwordMatches(password: string, config: AuthConfig) {
  const actual = await passwordHash(password, fromBase64Url(config.passwordSalt), config.passwordIterations);
  const expected = fromBase64Url(config.passwordHash);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual[index] ^ expected[index];
  return difference === 0;
}

async function signingKey(secret: string) {
  return crypto.subtle.importKey("raw", textEncoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function createSession(payload: SessionPayload, secret: string) {
  const encoded = base64Url(textEncoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(secret), textEncoder.encode(encoded));
  return `${encoded}.${base64Url(new Uint8Array(signature))}`;
}

async function readSession(token: string, secret: string): Promise<SessionPayload | null> {
  const [encoded, signature, remainder] = token.split(".");
  if (!encoded || !signature || remainder) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await signingKey(secret), fromBase64Url(signature), textEncoder.encode(encoded));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))) as SessionPayload;
    if (!payload.username || !Number.isFinite(payload.version) || payload.expiresAt <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("Cookie") || "";
  for (const item of cookie.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return parts.join("=");
  }
  return "";
}

function sessionCookie(token: string) {
  return `${AUTH_COOKIE}=${token}; Max-Age=${SESSION_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

function clearSessionCookie() {
  return `${AUTH_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

function withSecurityHeaders(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return withSecurityHeaders(new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  }));
}

function isPublicAsset(pathname: string) {
  if (pathname.startsWith("/_next/") || pathname.startsWith("/_vinext/")) return true;
  return /\.(?:css|js|mjs|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|map)$/i.test(pathname) && !pathname.startsWith("/api/");
}

function sameOriginPost(request: Request, url: URL) {
  return request.headers.get("Origin") === url.origin;
}

function safeReturnPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/login")) return "/";
  return value;
}

async function readAuthConfig(env: Env) {
  return env.AUTH_KV?.get<AuthConfig>(AUTH_CONFIG_KEY, "json") ?? null;
}

async function authenticatedSession(request: Request, env: Env, config?: AuthConfig | null) {
  if (!env.AUTH_SESSION_SECRET) return null;
  const token = cookieValue(request, AUTH_COOKIE);
  if (!token) return null;
  const payload = await readSession(token, env.AUTH_SESSION_SECRET);
  const current = config === undefined ? await readAuthConfig(env) : config;
  if (!payload || !current || payload.version !== current.version || payload.username !== current.username) return null;
  return payload;
}

async function loginAttemptKey(request: Request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(ip));
  return `site-auth:attempt:${base64Url(new Uint8Array(digest)).slice(0, 24)}`;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function describeClient(userAgent: string) {
  const operatingSystem = /Windows NT/i.test(userAgent) ? "Windows"
    : /iPhone|iPad|iPod/i.test(userAgent) ? "iOS / iPadOS"
      : /Android/i.test(userAgent) ? "Android"
        : /Mac OS X|Macintosh/i.test(userAgent) ? "macOS"
          : /Linux/i.test(userAgent) ? "Linux" : "未知系统";
  const browser = /MicroMessenger/i.test(userAgent) ? "微信浏览器"
    : /Edg\//i.test(userAgent) ? "Microsoft Edge"
      : /OPR\//i.test(userAgent) ? "Opera"
        : /Firefox\//i.test(userAgent) ? "Firefox"
          : /Chrome\//i.test(userAgent) ? "Chrome"
            : /Safari\//i.test(userAgent) ? "Safari" : "未知浏览器";
  const device = /iPad|Tablet/i.test(userAgent) ? "平板电脑"
    : /Mobile|iPhone|Android/i.test(userAgent) ? "手机" : "电脑";
  return { operatingSystem, browser, device };
}

const COUNTRY_NAMES: Record<string, string> = {
  CN: "中国", RU: "俄罗斯", HK: "中国香港", MO: "中国澳门", TW: "中国台湾",
  US: "美国", JP: "日本", KR: "韩国", SG: "新加坡", DE: "德国", FR: "法国", GB: "英国",
};

const CHINA_REGION_NAMES: Record<string, string> = {
  BJ: "北京市", TJ: "天津市", HE: "河北省", SX: "山西省", NM: "内蒙古自治区", LN: "辽宁省",
  JL: "吉林省", HL: "黑龙江省", SH: "上海市", JS: "江苏省", ZJ: "浙江省", AH: "安徽省",
  FJ: "福建省", JX: "江西省", SD: "山东省", HA: "河南省", HB: "湖北省", HN: "湖南省",
  GD: "广东省", GX: "广西壮族自治区", HI: "海南省", CQ: "重庆市", SC: "四川省", GZ: "贵州省",
  YN: "云南省", XZ: "西藏自治区", SN: "陕西省", GS: "甘肃省", QH: "青海省", NX: "宁夏回族自治区",
  XJ: "新疆维吾尔自治区", HK: "香港特别行政区", MO: "澳门特别行政区", TW: "台湾省",
};

const CHINA_REGION_ALIASES: Record<string, string> = {
  Beijing: "北京市", Tianjin: "天津市", Hebei: "河北省", Shanxi: "山西省", InnerMongolia: "内蒙古自治区",
  Liaoning: "辽宁省", Jilin: "吉林省", Heilongjiang: "黑龙江省", Shanghai: "上海市", Jiangsu: "江苏省",
  Zhejiang: "浙江省", Anhui: "安徽省", Fujian: "福建省", Jiangxi: "江西省", Shandong: "山东省",
  Henan: "河南省", Hubei: "湖北省", Hunan: "湖南省", Guangdong: "广东省", Guangxi: "广西壮族自治区",
  Hainan: "海南省", Chongqing: "重庆市", Sichuan: "四川省", Guizhou: "贵州省", Yunnan: "云南省",
  Tibet: "西藏自治区", Shaanxi: "陕西省", Gansu: "甘肃省", Qinghai: "青海省", Ningxia: "宁夏回族自治区",
  Xinjiang: "新疆维吾尔自治区",
};

function locationFromRequest(request: Request) {
  const cf = (request as Request & { cf?: Record<string, unknown> }).cf || {};
  const countryCode = stringValue(cf.country) || request.headers.get("CF-IPCountry") || "";
  const regionCode = stringValue(cf.regionCode).replace(/^CN-/, "");
  const rawRegion = stringValue(cf.region);
  const country = COUNTRY_NAMES[countryCode] || countryCode || "地区未知";
  const region = countryCode === "CN"
    ? CHINA_REGION_NAMES[regionCode] || CHINA_REGION_ALIASES[rawRegion.replace(/\s+/g, "")] || rawRegion
    : rawRegion;
  const city = stringValue(cf.city);
  const pieces = [country, region, city].filter((value, index, values) => value && values.indexOf(value) === index);
  return {
    country,
    region,
    city,
    location: pieces.join(" · ") || "地区未知",
    timezone: stringValue(cf.timezone),
    edge: stringValue(cf.colo),
  };
}

async function recordSuccessfulLogin(request: Request, env: Env, sessionId: string, username: string) {
  if (!env.AUTH_KV) return;
  const loggedInAt = new Date().toISOString();
  const client = describeClient(request.headers.get("User-Agent") || "");
  const location = locationFromRequest(request);
  const record: LoginRecord = {
    id: sessionId,
    loggedInAt,
    username,
    ip: request.headers.get("CF-Connecting-IP") || "未获取",
    ...location,
    ...client,
  };
  // Reversed timestamp keeps KV's lexicographic listing in newest-first order.
  const newestFirstTimestamp = String(9_999_999_999_999 - Date.now()).padStart(13, "0");
  await env.AUTH_KV.put(`${AUTH_LOGIN_PREFIX}${newestFirstTimestamp}:${sessionId}`, JSON.stringify(record), { expirationTtl: LOGIN_HISTORY_SECONDS });
}

function publicTokenState(metadata: WbTokenMetadata | null, connected: boolean) {
  if (!connected || !metadata?.expiresAt) return { status: "not_configured", daysRemaining: null };
  const daysRemaining = Math.ceil((new Date(metadata.expiresAt).getTime() - Date.now()) / 86_400_000);
  return { status: daysRemaining <= 0 ? "expired" : daysRemaining <= 30 ? "expiring" : "active", daysRemaining };
}

function metadataFromToken(token: string) {
  if (!token) return null;
  try { return decodeWbToken(token); } catch { return null; }
}

async function managedStoreRecords(env: Env) {
  const listed = await env.AUTH_KV!.list({ prefix: MANAGED_STORE_PREFIX, limit: 100 });
  return (await Promise.all(listed.keys.map((key) => env.AUTH_KV!.get<ManagedStoreRecord>(key.name, "json"))))
    .filter((record): record is ManagedStoreRecord => Boolean(record));
}

async function publicStores(env: Env) {
  const managed = await managedStoreRecords(env);
  const records = new Map(managed.map((record) => [record.id, record]));
  const stores: ManagedStoreRecord[] = BUILTIN_STORES.map((base) => records.get(base.id) || {
    ...base,
    enabled: true,
    createdAt: "",
    updatedAt: "",
  });
  for (const record of managed) if (!BUILTIN_STORES.some((store) => store.id === record.id)) stores.push(record);

  const output = [];
  for (const store of stores.filter((record) => record.enabled)) {
    let token = "";
    if (!store.tokenDisabled && store.apiTokenCipher && store.apiTokenIv && env.AUTH_SESSION_SECRET) {
      token = await decryptWbToken(store.apiTokenCipher, store.apiTokenIv, env.AUTH_SESSION_SECRET);
    } else if (!store.tokenDisabled) {
      token = store.id === "primary" ? env.WB_API_TOKEN?.trim() || "" : store.id === "cl" ? env.WB_API_TOKEN_CL?.trim() || "" : "";
    }
    const decoded = metadataFromToken(token);
    const storedMetadata: WbTokenMetadata | null = store.tokenExpiresAt ? {
      expiresAt: store.tokenExpiresAt,
      issuedAt: store.tokenIssuedAt || null,
      tokenType: store.tokenType || "WB 令牌",
      sellerId: store.sellerId || "",
      permissions: store.permissions || [],
      hint: store.tokenHint || "已安全保存",
    } : null;
    const metadata = decoded || storedMetadata;
    const hasUsableTokenShape = Boolean(token) && Boolean(metadata) && !store.tokenDisabled;
    const state = publicTokenState(metadata, hasUsableTokenShape);
    const connected = hasUsableTokenShape && state.status !== "expired";
    output.push({
      id: store.id,
      name: store.name,
      badge: store.badge,
      description: `${store.description} · ${connected ? "API 已连接" : "API 未配置"}`,
      builtin: store.builtin,
      enabled: store.enabled,
      connected,
      tokenHint: connected ? metadata?.hint || "已安全保存" : "未配置",
      tokenExpiresAt: metadata?.expiresAt || null,
      tokenIssuedAt: metadata?.issuedAt || null,
      tokenType: metadata?.tokenType || null,
      sellerId: metadata?.sellerId || "",
      permissions: metadata?.permissions || [],
      status: state.status,
      daysRemaining: state.daysRemaining,
      updatedAt: store.updatedAt || null,
    });
  }
  return output;
}

function storeBadge(name: string) {
  const digits = name.match(/\d+/)?.[0];
  return (digits ? digits.slice(-2) : [...name.replace(/\s+/g, "")].slice(0, 2).join("")) || "店";
}

async function validateWbToken(token: string) {
  const metadata = decodeWbToken(token);
  if (metadata.tokenType === "测试令牌") throw new Error("TOKEN_TEST_ONLY");
  let response: Response;
  try {
    response = await fetch("https://common-api.wildberries.ru/ping", {
      headers: { Authorization: token },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new Error("TOKEN_CHECK_UNAVAILABLE");
  }
  if (response.status === 401 || response.status === 403) throw new Error("TOKEN_REJECTED");
  if (response.status === 429) throw new Error("TOKEN_CHECK_RATE_LIMITED");
  if (!response.ok) throw new Error("TOKEN_CHECK_UNAVAILABLE");
  return metadata;
}

async function handleStoreManagement(request: Request, env: Env) {
  if (request.method === "GET") return json({ stores: await publicStores(env) });

  let body: { action?: string; id?: string; name?: string; apiToken?: string };
  try { body = await request.json() as typeof body; } catch { return json({ error: "提交内容无效" }, 400); }
  const action = String(body.action || "save");
  const requestedId = safeStoreId(String(body.id || ""));
  const builtin = BUILTIN_STORES.find((store) => store.id === requestedId);
  const existing = requestedId ? await env.AUTH_KV!.get<ManagedStoreRecord>(managedStoreKey(requestedId), "json") : null;

  if (action === "delete") {
    if (!requestedId) return json({ error: "店铺编号无效" }, 400);
    if (builtin) return json({ error: "1号店和2号店不能删除，可单独移除或更换 API" }, 400);
    await env.AUTH_KV!.delete(managedStoreKey(requestedId));
    return json({ ok: true, stores: await publicStores(env) });
  }

  if (action === "clear-token") {
    if (!requestedId || (!existing && !builtin)) return json({ error: "店铺不存在" }, 404);
    const now = new Date().toISOString();
    const base = existing || { ...builtin!, enabled: true, createdAt: now, updatedAt: now };
    const next: ManagedStoreRecord = {
      ...base,
      tokenDisabled: true,
      apiTokenCipher: undefined,
      apiTokenIv: undefined,
      tokenHint: undefined,
      tokenExpiresAt: undefined,
      tokenIssuedAt: undefined,
      tokenType: undefined,
      sellerId: undefined,
      permissions: [],
      updatedAt: now,
    };
    await env.AUTH_KV!.put(managedStoreKey(requestedId), JSON.stringify(next));
    return json({ ok: true, stores: await publicStores(env) });
  }

  if (action !== "save") return json({ error: "不支持的操作" }, 400);
  const name = String(body.name || "").trim();
  const apiToken = String(body.apiToken || "").trim();
  if (name.length < 2 || name.length > 40) return json({ error: "店铺名称需为 2–40 个字符" }, 400);
  if (!requestedId && !apiToken) return json({ error: "新增店铺时必须填写 WB API" }, 400);
  if (requestedId && !existing && !builtin) return json({ error: "店铺不存在，请重新打开设置页" }, 404);

  const id = requestedId || `store-${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();
  const base = existing || builtin || {
    id,
    badge: storeBadge(name),
    description: "新增店铺",
    builtin: false,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
  const next: ManagedStoreRecord = {
    ...base,
    id,
    name,
    badge: base.badge || storeBadge(name),
    enabled: true,
    // Editing only the name must not silently re-enable an API that the user
    // deliberately removed. Supplying and validating a new API re-enables it.
    tokenDisabled: apiToken ? false : Boolean(base.tokenDisabled),
    updatedAt: now,
  };

  if (apiToken) {
    let metadata: WbTokenMetadata;
    try { metadata = await validateWbToken(apiToken); } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "TOKEN_FORMAT_INVALID" || code === "TOKEN_EXPIRY_MISSING") return json({ error: "这不是有效的 WB API 格式，请重新复制完整令牌" }, 400);
      if (code === "TOKEN_EXPIRED") return json({ error: "这个 WB API 已经过期，请在 WB 后台重新生成" }, 400);
      if (code === "TOKEN_TEST_ONLY") return json({ error: "测试令牌不能读取真实店铺，请使用基础令牌或适合本系统的正式令牌" }, 400);
      if (code === "TOKEN_REJECTED") return json({ error: "WB 官方拒绝了这个 API，请检查令牌是否完整、有效" }, 400);
      if (code === "TOKEN_CHECK_RATE_LIMITED") return json({ error: "WB 官方连接检测过于频繁，请约 30 秒后重试" }, 429);
      return json({ error: "暂时无法向 WB 官方验证 API，请稍后重试，当前内容没有保存" }, 502);
    }
    const encrypted = await encryptWbToken(apiToken, env.AUTH_SESSION_SECRET!);
    next.apiTokenCipher = encrypted.cipher;
    next.apiTokenIv = encrypted.iv;
    next.tokenHint = metadata.hint;
    next.tokenExpiresAt = metadata.expiresAt || undefined;
    next.tokenIssuedAt = metadata.issuedAt || undefined;
    next.tokenType = metadata.tokenType;
    next.sellerId = metadata.sellerId;
    next.permissions = metadata.permissions;
  } else if (!existing && builtin) {
    next.tokenDisabled = false;
  }

  await env.AUTH_KV!.put(managedStoreKey(id), JSON.stringify(next));
  return json({ ok: true, storeId: id, stores: await publicStores(env) });
}

async function handleAuthApi(request: Request, env: Env, url: URL) {
  if (!env.AUTH_KV || !env.AUTH_SESSION_SECRET) return json({ error: "登录服务尚未配置" }, 503);
  const allowsGet = url.pathname === "/api/auth/session" || url.pathname === "/api/auth/login-history" || url.pathname === "/api/settings/stores";
  if (request.method !== "POST" && !(request.method === "GET" && allowsGet)) return json({ error: "请求方法不支持" }, 405);
  if (request.method === "POST" && !sameOriginPost(request, url)) return json({ error: "请求来源无效，请刷新页面后重试" }, 403);

  const config = await readAuthConfig(env);
  if (!config) return json({ error: "登录账号尚未初始化" }, 503);

  if (url.pathname === "/api/auth/login") {
    const rateKey = await loginAttemptKey(request);
    const attempts = await env.AUTH_KV.get<{ count: number; blockedUntil?: number }>(rateKey, "json");
    if ((attempts?.blockedUntil || 0) > Date.now()) return json({ error: "尝试次数过多，请 15 分钟后再试" }, 429);
    let body: { username?: string; password?: string };
    try { body = await request.json() as typeof body; } catch { return json({ error: "请输入用户名和密码" }, 400); }
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const valid = username === config.username && await passwordMatches(password, config);
    if (!valid) {
      const count = (attempts?.count || 0) + 1;
      await env.AUTH_KV.put(rateKey, JSON.stringify({ count, blockedUntil: count >= 8 ? Date.now() + 15 * 60_000 : 0 }), { expirationTtl: 15 * 60 });
      return json({ error: count >= 8 ? "尝试次数过多，请 15 分钟后再试" : "用户名或密码不正确" }, count >= 8 ? 429 : 401);
    }
    await env.AUTH_KV.delete(rateKey);
    const sessionId = crypto.randomUUID();
    const token = await createSession({ username: config.username, version: config.version, expiresAt: Date.now() + SESSION_SECONDS * 1000, sessionId }, env.AUTH_SESSION_SECRET);
    await recordSuccessfulLogin(request, env, sessionId, config.username);
    return json({ ok: true, username: config.username, mustChangePassword: Boolean(config.mustChangePassword) }, 200, { "Set-Cookie": sessionCookie(token) });
  }

  if (url.pathname === "/api/auth/logout") {
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
  }

  const session = await authenticatedSession(request, env, config);
  if (!session) return json({ error: "登录已失效，请重新登录" }, 401, { "Set-Cookie": clearSessionCookie() });

  if (url.pathname === "/api/auth/session") {
    return json({ authenticated: true, username: config.username, updatedAt: config.updatedAt, mustChangePassword: Boolean(config.mustChangePassword) });
  }

  if (url.pathname === "/api/auth/login-history") {
    const listed = await env.AUTH_KV.list({ prefix: AUTH_LOGIN_PREFIX, limit: 50 });
    const records = (await Promise.all(listed.keys.map((key) => env.AUTH_KV!.get<LoginRecord>(key.name, "json"))))
      .filter((record): record is LoginRecord => Boolean(record))
      .sort((left, right) => right.loggedInAt.localeCompare(left.loggedInAt))
      .map((record) => ({ ...record, current: Boolean(session.sessionId && record.id === session.sessionId) }));
    return json({ records, retentionDays: 180, locationAccuracy: "IP 网络位置，仅供参考" });
  }

  if (url.pathname === "/api/settings/stores") return handleStoreManagement(request, env);

  if (url.pathname === "/api/auth/change-credentials") {
    let body: { currentPassword?: string; newUsername?: string; newPassword?: string };
    try { body = await request.json() as typeof body; } catch { return json({ error: "提交内容无效" }, 400); }
    const currentPassword = String(body.currentPassword || "");
    if (!await passwordMatches(currentPassword, config)) return json({ error: "当前密码不正确" }, 401);
    const username = String(body.newUsername || config.username).trim();
    const newPassword = String(body.newPassword || "");
    if (username.length < 3 || username.length > 40 || !/^[\p{L}\p{N}_.-]+$/u.test(username)) {
      return json({ error: "用户名需为 3–40 位，可使用中英文、数字、点、横线和下划线" }, 400);
    }
    if (newPassword && (newPassword.length < 10 || newPassword.length > 128)) return json({ error: "新密码需为 10–128 位" }, 400);
    const next: AuthConfig = { ...config, username, version: config.version + 1, updatedAt: new Date().toISOString(), mustChangePassword: false };
    if (newPassword) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      next.passwordSalt = base64Url(salt);
      next.passwordHash = base64Url(await passwordHash(newPassword, salt));
      next.passwordIterations = PASSWORD_ITERATIONS;
    }
    await env.AUTH_KV.put(AUTH_CONFIG_KEY, JSON.stringify(next));
    const token = await createSession({ username: next.username, version: next.version, expiresAt: Date.now() + SESSION_SECONDS * 1000, sessionId: session.sessionId || crypto.randomUUID() }, env.AUTH_SESSION_SECRET);
    return json({ ok: true, username: next.username, updatedAt: next.updatedAt }, 200, { "Set-Cookie": sessionCookie(token) });
  }

  return json({ error: "接口不存在" }, 404);
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async scheduled(_event: unknown, env: Env, ctx: ExecutionContext) {
    // Internal scheduled requests use the same loaders as the protected screen.
    // This does not expose an unauthenticated HTTP endpoint or session token.
    ctx.waitUntil((async () => {
      const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
      const from = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
      const manifestResponse = await handler.fetch(new Request("https://wbwork.duoduolink.com/api/all-stores"), env, ctx);
      if (!manifestResponse.ok) throw new Error("ALL_STORES_SCHEDULE_REGISTRY_FAILED");
      const manifest = await manifestResponse.json() as { stores: Array<{ id: string }> };
      for (const store of manifest.stores) {
        try {
          const params = new URLSearchParams({ storeId: store.id, from, to: today });
          const response = await handler.fetch(new Request(`https://wbwork.duoduolink.com/api/all-stores?${params}`), env, ctx);
          if (!response.ok) console.warn("ALL_STORES_SCHEDULE_STORE_FAILED", store.id, response.status);
          else {
            const result = await response.json() as { ordersState?: string; returnsState?: string; suppliesState?: string; catalogState?: string };
            if ([result.ordersState, result.returnsState, result.suppliesState, result.catalogState].some((state) => state !== "fresh")) console.warn("ALL_STORES_SCHEDULE_PARTIAL", store.id);
          }
        } catch { console.warn("ALL_STORES_SCHEDULE_STORE_FAILED", store.id); }
      }
    })());
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (env.AUTH_TEST_BYPASS === "true") return withSecurityHeaders(await handler.fetch(request, env, ctx));

    if (url.pathname.startsWith("/api/auth/") || url.pathname === "/api/settings/stores") return handleAuthApi(request, env, url);

    if (isPublicAsset(url.pathname)) {
      if (url.pathname === "/_vinext/image") {
        const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
        return withSecurityHeaders(await handleImageOptimization(request, {
          fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
            return result.response();
          },
        }, allowedWidths));
      }
      return withSecurityHeaders(await handler.fetch(request, env, ctx));
    }

    const config = await readAuthConfig(env);
    const session = await authenticatedSession(request, env, config);
    if (url.pathname === "/login") {
      if (session) return Response.redirect(new URL(safeReturnPath(url.searchParams.get("next")), url.origin), 302);
      return withSecurityHeaders(await handler.fetch(request, env, ctx));
    }

    if (!session) {
      if (url.pathname.startsWith("/api/")) return json({ error: "请先登录" }, 401, { "Set-Cookie": clearSessionCookie() });
      const login = new URL("/login", url.origin);
      login.searchParams.set("next", safeReturnPath(`${url.pathname}${url.search}`));
      return new Response(null, { status: 302, headers: { Location: login.toString(), "Set-Cookie": clearSessionCookie(), "Cache-Control": "no-store" } });
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return withSecurityHeaders(await handler.fetch(request, env, ctx));
  },
};

export default worker;
