export const MANAGED_STORE_PREFIX = "site-config:store:";

export type ManagedStoreRecord = {
  id: string;
  name: string;
  badge: string;
  description: string;
  builtin: boolean;
  enabled: boolean;
  tokenDisabled?: boolean;
  apiTokenCipher?: string;
  apiTokenIv?: string;
  tokenHint?: string;
  tokenExpiresAt?: string;
  tokenIssuedAt?: string;
  tokenType?: string;
  sellerId?: string;
  permissions?: string[];
  createdAt: string;
  updatedAt: string;
};

export type WbTokenMetadata = {
  expiresAt: string | null;
  issuedAt: string | null;
  tokenType: string;
  sellerId: string;
  permissions: string[];
  hint: string;
};

const textEncoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(`wb-store-token:${secret}`));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptWbToken(token: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(secret), textEncoder.encode(token));
  return { cipher: bytesToBase64Url(new Uint8Array(encrypted)), iv: bytesToBase64Url(iv) };
}

export async function decryptWbToken(cipher: string, iv: string, secret: string) {
  try {
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlToBytes(iv) }, await encryptionKey(secret), base64UrlToBytes(cipher));
    return new TextDecoder().decode(decrypted);
  } catch {
    return "";
  }
}

function jsonPayload(token: string) {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) throw new Error("TOKEN_FORMAT_INVALID");
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1]))) as Record<string, unknown>;
  } catch {
    throw new Error("TOKEN_FORMAT_INVALID");
  }
}

const PERMISSIONS: Array<[number, string]> = [
  [1, "商品内容"], [2, "经营分析"], [3, "价格与折扣"], [4, "订单与仓库"], [5, "统计数据"],
  [6, "推广"], [7, "评价与提问"], [9, "买家聊天"], [10, "供应管理"], [11, "买家退货"],
  [12, "文件"], [13, "财务"], [16, "用户管理"], [30, "只读"],
];

export function decodeWbToken(token: string): WbTokenMetadata {
  const normalized = token.trim();
  if (normalized.length < 40 || normalized.length > 8192) throw new Error("TOKEN_FORMAT_INVALID");
  const payload = jsonPayload(normalized);
  const expires = Number(payload.exp || 0);
  if (!Number.isFinite(expires) || expires <= 0) throw new Error("TOKEN_EXPIRY_MISSING");
  const expiresAt = new Date(expires * 1000);
  if (!Number.isFinite(expiresAt.getTime())) throw new Error("TOKEN_EXPIRY_MISSING");
  if (expiresAt.getTime() <= Date.now()) throw new Error("TOKEN_EXPIRED");
  const issued = Number(payload.iat || 0);
  const accessMask = BigInt(Math.max(0, Math.trunc(Number(payload.s || 0))));
  const permissions = PERMISSIONS.filter(([position]) => (accessMask & (1n << BigInt(position - 1))) !== 0n).map(([, label]) => label);
  const accessType = Number(payload.acc || 0);
  const tokenType = accessType === 3 ? "个人令牌" : accessType === 4 ? "服务令牌" : accessType === 2 ? "测试令牌" : accessType === 1 ? "基础令牌" : "WB 令牌";
  return {
    expiresAt: expiresAt.toISOString(),
    issuedAt: issued > 0 ? new Date(issued * 1000).toISOString() : null,
    tokenType,
    sellerId: typeof payload.sid === "string" ? payload.sid : "",
    permissions,
    hint: `${normalized.slice(0, 6)}…${normalized.slice(-6)}`,
  };
}

export function managedStoreKey(id: string) {
  return `${MANAGED_STORE_PREFIX}${id}`;
}

export function safeStoreId(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return normalized && /^[a-z0-9][a-z0-9-]*$/.test(normalized) ? normalized : "";
}
