import { readMarketDataset, setMarketWatch } from "../../../_lib/market-niche-repository";
import { scoreMarketCategories } from "../../../_lib/market-niche-score";

const HEADERS = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const id = (url.searchParams.get("id") || "").trim();
    const period = Number(url.searchParams.get("period") || 30);
    if (!id) return json({ error: "缺少品类 ID" }, 400);
    const dataset = await readMarketDataset();
    const rows = scoreMarketCategories(dataset.categories.filter((item) => item.subjectId === id));
    const category = rows.find((item) => item.periodDays === period) || rows[0];
    if (!category) return json({ error: "没有找到该品类的已导入数据" }, 404);
    const history = dataset.history.filter((item) => item.subjectId === id && item.periodDays === category.periodDays);
    return json({ category, history, watched: dataset.watchedIds.includes(id), products: [], sellers: [], priceDistribution: [], capabilities: { products: false, sellers: false, priceDistribution: false } });
  } catch (error) {
    console.error("market category failed", error);
    return json({ error: "品类详情暂时无法读取" }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { id?: unknown; watched?: unknown };
    const id = typeof payload.id === "string" ? payload.id.trim().slice(0, 160) : "";
    if (!id || typeof payload.watched !== "boolean") return json({ error: "观察状态无效" }, 400);
    const dataset = await setMarketWatch(id, payload.watched);
    return json({ watched: dataset.watchedIds.includes(id) });
  } catch {
    return json({ error: "观察列表暂时无法更新" }, 500);
  }
}
