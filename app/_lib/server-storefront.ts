import {
  DEFAULT_STOREFRONT_ID,
  STOREFRONT_COOKIE_KEY,
  storefrontById,
} from "./storefronts.ts";
import { decodeWbToken, decryptWbToken, managedStoreKey, safeStoreId, type ManagedStoreRecord } from "./wb-store-management.ts";

type RuntimeEnvironment = {
  AUTH_KV?: KVNamespace;
  AUTH_SESSION_SECRET?: string;
  WB_API_TOKEN?: string;
  WB_API_TOKEN_CL?: string;
};

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie") ?? "";
  for (const pair of cookies.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    const key = pair.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

export async function requestedStorefront(
  request: Request,
  runtime: RuntimeEnvironment = {},
) {
  const requestedId = safeStoreId(cookieValue(request, STOREFRONT_COOKIE_KEY)) || DEFAULT_STOREFRONT_ID;
  const managed = await runtime.AUTH_KV?.get<ManagedStoreRecord>(managedStoreKey(requestedId), "json");
  if (managed?.enabled) {
    return {
      id: managed.id,
      name: managed.name,
      description: managed.description,
      enabled: true,
      connected: !managed.tokenDisabled && (Boolean(managed.apiTokenCipher) || managed.id === DEFAULT_STOREFRONT_ID || managed.id === "cl"),
      badge: managed.badge,
    };
  }
  return storefrontById(requestedId);
}

export async function resolveWbStore(
  request: Request,
  runtime: RuntimeEnvironment = {},
) {
  const store = await requestedStorefront(request, runtime);
  const managed = await runtime.AUTH_KV?.get<ManagedStoreRecord>(managedStoreKey(store.id), "json");
  let token = "";
  if (managed?.apiTokenCipher && managed.apiTokenIv && runtime.AUTH_SESSION_SECRET) {
    token = await decryptWbToken(managed.apiTokenCipher, managed.apiTokenIv, runtime.AUTH_SESSION_SECRET);
  } else if (!managed?.tokenDisabled) {
    token = store.id === "cl" ? runtime.WB_API_TOKEN_CL?.trim() || "" : store.id === DEFAULT_STOREFRONT_ID ? runtime.WB_API_TOKEN?.trim() || "" : "";
  }
  // WB tokens expire. An expired managed token must never be sent to WB even if
  // a stale encrypted value still exists in KV. Environment fallbacks keep their
  // legacy compatibility, but are also disabled when their JWT explicitly says
  // that it has expired.
  if (token) {
    try {
      decodeWbToken(token);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (managed?.apiTokenCipher || code === "TOKEN_EXPIRED") token = "";
    }
  }
  return { ...store, connected: Boolean(token), token };
}

export function scopedStoreKey(storeId: string, key: string) {
  return storeId === DEFAULT_STOREFRONT_ID ? key : `${storeId}:${key}`;
}
