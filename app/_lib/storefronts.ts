export type Storefront = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  connected: boolean;
  badge: string;
};

export const DEFAULT_STOREFRONT_ID = "primary";
export const STOREFRONT_STORAGE_KEY = "wb-insight-active-store";

// Public store metadata only. API credentials always remain in server-side
// environment variables and must never be added to this client-visible list.
export const STOREFRONTS: Storefront[] = [
  {
    id: DEFAULT_STOREFRONT_ID,
    name: "王振1号店",
    description: "主店铺 · API 已连接",
    enabled: true,
    connected: true,
    badge: "主",
  },
  {
    id: "next-store",
    name: "下一家 WB 店铺",
    description: "提供 API 后即可启用",
    enabled: false,
    connected: false,
    badge: "+",
  },
];

export function storefrontById(id?: string | null) {
  return STOREFRONTS.find((store) => store.id === id && store.enabled) ?? STOREFRONTS[0];
}
