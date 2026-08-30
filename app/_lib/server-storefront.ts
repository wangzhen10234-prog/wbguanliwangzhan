import {
  DEFAULT_STOREFRONT_ID,
  STOREFRONT_COOKIE_KEY,
  storefrontById,
} from "./storefronts.ts";

type RuntimeEnvironment = {
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

export function requestedStorefront(request: Request) {
  return storefrontById(cookieValue(request, STOREFRONT_COOKIE_KEY));
}

export function resolveWbStore(
  request: Request,
  runtime: RuntimeEnvironment = process.env,
) {
  const store = requestedStorefront(request);
  const token = store.id === "cl" ? runtime.WB_API_TOKEN_CL : runtime.WB_API_TOKEN;
  return { ...store, token: token?.trim() ?? "" };
}

export function scopedStoreKey(storeId: string, key: string) {
  return storeId === DEFAULT_STOREFRONT_ID ? key : `${storeId}:${key}`;
}
