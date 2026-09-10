"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "../_components/app-sidebar";
import type { InventorySegment } from "../_lib/inventory-segments";

type StockFilter = "all" | "available" | InventorySegment;
type StockProduct = { nmId: number; name: string; sku: string; image: string | null; category: string; stock: number; dailyUnits: number; stockCoverDays: number | null; inventorySegment: InventorySegment; status: string };
type StockData = {
  syncedAt: string;
  syncSchedule: { nextAt: string };
  warehouses: Array<{ name: string; stock: number }>;
  products: StockProduct[];
  inventory: { available: boolean; totalQuantity: number; productCount: number; critical: number; low: number; slow: number };
};

function toInputDate(date: Date) { return date.toISOString().slice(0, 10); }
function shiftDate(dateString: string, days: number) { const date = new Date(`${dateString}T12:00:00`); date.setDate(date.getDate() + days); return toInputDate(date); }

export default function StockPage() {
  const today = toInputDate(new Date());
  const from = shiftDate(today, -29);
  const [warehouse, setWarehouse] = useState("");
  const [data, setData] = useState<StockData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [reloadKey, setReloadKey] = useState(0);
  const forceRefreshRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ from, to: today, view: "stock" });
    if (warehouse) params.set("warehouse", warehouse);
    if (forceRefreshRef.current) params.set("refresh", "manual");
    forceRefreshRef.current = false;
    fetch(`/api/wb/dashboard?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { const body = await response.json() as StockData | { error?: string }; if (!response.ok) throw new Error("error" in body && body.error ? body.error : "库存读取失败"); return body as StockData; })
      .then(setData)
      .catch((reason: Error) => { if (reason.name !== "AbortError") setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [from, today, warehouse, reloadKey]);

  useEffect(() => {
    const nextAt = data?.syncSchedule?.nextAt;
    if (!nextAt) return;
    const timer = window.setTimeout(() => { if (window.localStorage.getItem("wb-last-auto-sync") === nextAt) { window.setTimeout(() => { setLoading(true); setReloadKey((key) => key + 1); }, 12_000); return; } window.localStorage.setItem("wb-last-auto-sync", nextAt); setLoading(true); setReloadKey((key) => key + 1); }, Math.max(1_000, new Date(nextAt).getTime() - Date.now() + 1_500));
    return () => window.clearTimeout(timer);
  }, [data?.syncSchedule?.nextAt]);

  const products = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (data?.products ?? [])
      .filter((item) => stockFilter === "all" || (stockFilter === "available" ? item.stock > 0 : item.inventorySegment === stockFilter))
      .filter((item) => !needle || [item.name, item.sku, String(item.nmId)].some((value) => value.toLocaleLowerCase().includes(needle)))
      .sort((a, b) => a.stock - b.stock);
  }, [data, query, stockFilter]);
  const inventory = data?.inventory;
  const filterLabel = ({ all: "全部库存商品", available: "有库存商品", critical: "即将缺货", low: "库存偏低", slow: "周转较慢", healthy: "库存健康" } as const)[stockFilter];
  function refresh() { forceRefreshRef.current = true; setLoading(true); setError(""); setReloadKey((key) => key + 1); }
  function selectStockFilter(nextFilter: StockFilter) { setStockFilter((current) => current === nextFilter && nextFilter !== "all" ? "all" : nextFilter); }

  return (
    <main className="app-shell">
      <AppSidebar active="stock" syncedAt={data?.syncedAt} nextSyncAt={data?.syncSchedule?.nextAt} loading={loading} error={error} onRefresh={refresh} />
      <section className="workspace product-workspace">
        <header className="topbar product-topbar"><div><p className="eyebrow">CURRENT INVENTORY · 当前可售库存</p><h1>库存监控</h1></div><div className="avatar">Z</div></header>
        <section className="product-scope-panel compact-scope"><div className="product-scope-heading"><strong>库存范围</strong><small>库存为当前值，不随历史周期回溯</small></div><label><span>WB 仓库</span><select disabled={loading} value={warehouse} onChange={(event) => { setLoading(true); setWarehouse(event.target.value); }}><option value="">全部仓库</option>{(data?.warehouses ?? []).map((item) => <option key={item.name} value={item.name}>{item.name} · 库存 {item.stock}</option>)}</select></label><p>运输途中库存不计入当前可售库存。</p></section>
        <section className="product-stat-grid stock-stat-grid" aria-label="库存商品快捷筛选">
          <button type="button" className={`stock-stat-card ${stockFilter === "all" ? "active" : ""}`} aria-pressed={stockFilter === "all"} aria-controls="stock-detail-table" onClick={() => selectStockFilter("all")}><span>可售库存总量</span><strong>{inventory?.available ? inventory.totalQuantity.toLocaleString("en-US") : "—"}</strong><small>点击查看全部库存商品</small></button>
          <button type="button" className={`stock-stat-card ${stockFilter === "available" ? "active" : ""}`} aria-pressed={stockFilter === "available"} aria-controls="stock-detail-table" onClick={() => selectStockFilter("available")}><span>有库存商品</span><strong>{inventory?.available ? inventory.productCount : "—"}</strong><small>点击查看库存大于 0 的商品</small></button>
          <button type="button" className={`stock-stat-card ${(inventory?.critical ?? 0) > 0 ? "attention" : ""} ${stockFilter === "critical" ? "active" : ""}`} aria-pressed={stockFilter === "critical"} aria-controls="stock-detail-table" onClick={() => selectStockFilter("critical")}><span>即将缺货</span><strong>{inventory?.critical ?? 0}</strong><small>库存为 0 或不足 5 天</small></button>
          <button type="button" className={`stock-stat-card ${stockFilter === "low" ? "active" : ""}`} aria-pressed={stockFilter === "low"} aria-controls="stock-detail-table" onClick={() => selectStockFilter("low")}><span>库存偏低</span><strong>{inventory?.low ?? 0}</strong><small>预计可售 5–10 天</small></button>
          <button type="button" className={`stock-stat-card ${stockFilter === "slow" ? "active" : ""}`} aria-pressed={stockFilter === "slow"} aria-controls="stock-detail-table" onClick={() => selectStockFilter("slow")}><span>周转较慢</span><strong>{inventory?.slow ?? 0}</strong><small>近 30 天无签收但有库存</small></button>
        </section>
        <section className="product-table-panel">
          <div className="product-table-toolbar"><div><h2>商品库存明细</h2><p aria-live="polite">{filterLabel} · {products.length} 个商品 · {warehouse || "全部仓库"} · 按当前库存从低到高排列</p></div><div className="product-filters"><label className="product-search"><span>⌕</span><input type="search" value={query} placeholder="搜索商品、卖家商品编号或 WB 货号" onChange={(event) => setQuery(event.target.value)} /></label></div></div>
          <div className="product-detail-table-wrap"><table id="stock-detail-table" className="stock-detail-table"><thead><tr><th>商品</th><th>当前库存</th><th>近 30 天日均签收</th><th>预计可售天数</th><th>库存状态</th></tr></thead><tbody>{products.map((item, index) => <tr key={item.nmId}><td>{item.image ? <span className="product-photo" style={{ backgroundImage: `url(${item.image})` }} aria-hidden="true" /> : <div className={`product-thumb tone-${index % 4}`}>{item.category.slice(0, 1) || "W"}</div>}<div className="product-identity emphasized-sku"><b>{item.name}</b><small>{item.sku}</small><em>WB {item.nmId} · {item.category}</em></div></td><td><b>{item.stock}</b></td><td><span>{item.dailyUnits.toFixed(2)}</span></td><td><span>{item.stockCoverDays === null ? "无销量" : `${item.stockCoverDays.toFixed(1)} 天`}</span></td><td><span className={`product-status status-${item.status}`}>{item.status}</span></td></tr>)}{!loading && !products.length && <tr className="empty-row"><td colSpan={5}>“{filterLabel}”中没有符合搜索条件的商品</td></tr>}</tbody></table></div>
        </section>
      </section>
    </main>
  );
}
