import { env } from "cloudflare:workers";
import { mergeOfficialMarketCatalog, readMarketDataset } from "../../../_lib/market-niche-repository";
import { WbOfficialProvider } from "../../../_lib/providers/wb-official-provider";
import { resolveWbStore } from "../../../_lib/server-storefront";

const HEADERS = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const SIX_HOURS = 6 * 60 * 60 * 1000;
let pending: Promise<Awaited<ReturnType<typeof mergeOfficialMarketCatalog>>> | null = null;

export async function POST(request: Request) {
  try {
    const store = await resolveWbStore(request, env);
    if (!store.token) return json({ error: "当前店铺的 WB API 尚未配置" }, 503);
    const current = await readMarketDataset();
    const force = new URL(request.url).searchParams.get("force") === "1";
    const fresh = current.sourceFile.includes("/content/v2/object/all") && Date.now() - Date.parse(current.importedAt || "") < SIX_HOURS;
    if (!force && fresh) return json({ synced: false, cached: true, subjects: current.categories.length, syncedAt: current.importedAt, source: current.sourceFile });
    if (!pending) pending = new WbOfficialProvider(store.token).load()
      .then((dataset) => mergeOfficialMarketCatalog(dataset.categories, dataset.sourceFile, dataset.importedAt))
      .finally(() => { pending = null; });
    const dataset = await pending;
    return json({ synced: true, cached: false, subjects: dataset.categories.length, syncedAt: dataset.importedAt, source: dataset.sourceFile });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code.includes("401") || code.includes("403")) return json({ error: "当前店铺 API 缺少 WB 内容/类目读取权限" }, 403);
    if (code.includes("429")) return json({ error: "WB 类目接口请求频繁，请稍后重试" }, 429);
    console.error("market catalog sync failed", error);
    return json({ error: "WB 官方类目 API 暂时无法同步" }, 502);
  }
}
