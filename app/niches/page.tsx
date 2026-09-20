"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "../_components/app-sidebar";
import { DEFAULT_SCORE_WEIGHTS, type MarketCategoryMetric, type MarketHistoryPoint, type MarketMetricKey, type ScoreWeights } from "../_lib/market-niche-types";
import { scoreMarketCategories } from "../_lib/market-niche-score";

type ApiData = {
  rows: MarketCategoryMetric[];
  watchedIds: string[];
  importedAt: string;
  sourceFile: string;
  availablePeriods: number[];
  watchlist: Array<{ current: MarketCategoryMetric; previous: MarketHistoryPoint | null }>;
  sourceBoundary: { directlyAvailable: string[]; requiresExport: string[]; unavailable: string[] };
};

type SortKey = MarketMetricKey | "opportunityScore" | "nameRu";
const PERIODS = [7, 30, 90, 180, 365];
const NUMERIC_KEYS: SortKey[] = ["revenueRub", "salesUnits", "revenueGrowth", "salesGrowth", "sellerCount", "productCount", "averagePriceRub", "buyoutRate", "turnoverDays", "concentration", "opportunityScore"];

function numberLabel(value: number | null | undefined, suffix = "") {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value)}${suffix}`;
}
function money(value: number | null | undefined) { return typeof value === "number" ? `₽ ${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value)}` : "—"; }
function timeLabel(value: string) { return value ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "尚未导入"; }

export default function NichesPage() {
  const [period, setPeriod] = useState(30);
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("revenueRub");
  const [descending, setDescending] = useState(true);
  const [minimumRevenue, setMinimumRevenue] = useState("");
  const [minimumGrowth, setMinimumGrowth] = useState("");
  const [maximumSellers, setMaximumSellers] = useState("");
  const [minimumBuyout, setMinimumBuyout] = useState("");
  const [maximumConcentration, setMaximumConcentration] = useState("");
  const [parentFilter, setParentFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState(0);
  const [scoreOpen, setScoreOpen] = useState<string>("");
  const [scoreSettingsOpen, setScoreSettingsOpen] = useState(false);
  const [weights, setWeights] = useState<ScoreWeights>(DEFAULT_SCORE_WEIGHTS);
  const [selected, setSelected] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/market/categories?period=${period}`, { cache: "no-store" });
      const body = await response.json() as ApiData & { error?: string };
      if (!response.ok) throw new Error(body.error || "全市场数据读取失败");
      setData(body);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "全市场数据读取失败"); }
    finally { setLoading(false); }
  }, [period]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  useEffect(() => {
    try { const saved = window.localStorage.getItem("wb-market-score-weights"); if (saved) queueMicrotask(() => setWeights({ ...DEFAULT_SCORE_WEIGHTS, ...JSON.parse(saved) })); } catch { /* keep verified defaults */ }
  }, []);

  const scoredRows = useMemo(() => scoreMarketCategories(data?.rows || [], weights), [data, weights]);
  const parents = useMemo(() => [...new Set(scoredRows.map((row) => row.parentName).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")), [scoredRows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("ru-RU");
    const minRevenue = Number(minimumRevenue || 0);
    const minGrowth = Number(minimumGrowth || -Infinity);
    const maxSellers = Number(maximumSellers || Infinity);
    const minBuyout = Number(minimumBuyout || -Infinity);
    const maxConcentration = Number(maximumConcentration || Infinity);
    return [...scoredRows].filter((row) => !q || `${row.nameZh} ${row.nameRu} ${row.subjectId}`.toLocaleLowerCase("ru-RU").includes(q))
      .filter((row) => !parentFilter || row.parentName === parentFilter || row.parentId === parentFilter)
      .filter((row) => !levelFilter || row.level === levelFilter)
      .filter((row) => !minRevenue || (row.revenueRub ?? -Infinity) >= minRevenue)
      .filter((row) => !minimumGrowth || (row.revenueGrowth ?? -Infinity) >= minGrowth)
      .filter((row) => !maximumSellers || (row.sellerCount ?? Infinity) <= maxSellers)
      .filter((row) => !minimumBuyout || (row.buyoutRate ?? -Infinity) >= minBuyout)
      .filter((row) => !maximumConcentration || (row.concentration ?? Infinity) <= maxConcentration)
      .sort((a, b) => {
        const av = a[sort]; const bv = b[sort];
        const direction = descending ? -1 : 1;
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * direction;
        if (av == null) return 1; if (bv == null) return -1;
        return String(av).localeCompare(String(bv), "zh-CN") * direction;
      });
  }, [scoredRows, query, sort, descending, minimumRevenue, minimumGrowth, maximumSellers, minimumBuyout, maximumConcentration, parentFilter, levelFilter]);

  const potentials = useMemo(() => filtered.filter((row) => (row.opportunityScore ?? 0) >= 65).slice(0, 4), [filtered]);

  async function importFile(file: File) {
    setImporting(true); setImportMessage("");
    const form = new FormData(); form.set("file", file); form.set("periodDays", String(period));
    try {
      const response = await fetch("/api/market/import", { method: "POST", body: form });
      const body = await response.json() as { imported?: number; error?: string };
      if (!response.ok) throw new Error(body.error || "导入失败");
      setImportMessage(`已导入 ${body.imported || 0} 个品类；数据源已标记为 WB 官方导出`);
      await load();
    } catch (caught) { setImportMessage(caught instanceof Error ? caught.message : "导入失败"); }
    finally { setImporting(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function toggleWatch(row: MarketCategoryMetric) {
    const watched = !(data?.watchedIds || []).includes(row.subjectId);
    const response = await fetch("/api/market/category", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.subjectId, watched }) });
    if (response.ok) setData((current) => current ? { ...current, watchedIds: watched ? [...current.watchedIds, row.subjectId] : current.watchedIds.filter((id) => id !== row.subjectId) } : current);
  }

  function selectForCompare(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length < 5 ? [...current, id] : current);
  }

  function updateWeight(key: keyof ScoreWeights, value: string) {
    const next = { ...weights, [key]: Math.max(0, Math.min(100, Number(value) || 0)) };
    setWeights(next);
    window.localStorage.setItem("wb-market-score-weights", JSON.stringify(next));
  }

  return <div className="app-shell">
    <AppSidebar active="niches" syncedAt={data?.importedAt} loading={loading} error={error} onRefresh={load} />
    <main className="main niche-workspace">
      <header className="topbar niche-topbar"><div><p className="eyebrow">MARKET-WIDE ANALYTICS · Анализ ниш</p><h1>WB 全市场选品</h1><p>分析 Wildberries 全平台品类；与自己店铺的经营数据严格隔离。</p></div><div className="niche-import-tools"><input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" hidden onChange={(event) => event.target.files?.[0] && void importFile(event.target.files[0])}/><button onClick={() => fileRef.current?.click()} disabled={importing}>{importing ? "正在校验导入…" : "导入 WB 官方报表"}</button><small>支持《Анализ ниш》XLSX、UTF-8 CSV / TSV</small></div></header>

      <section className="niche-boundary-banner"><div><b>数据边界已锁定</b><p>公开 API 没有已验证的“全市场分析”接口。页面只展示 WB 官方报表真实导入的数据；缺失字段统一显示“—”。</p></div><span>WB_EXPORT · 官方导出</span></section>
      {importMessage && <div className={`niche-import-message ${importMessage.startsWith("已") ? "success" : "error"}`}>{importMessage}</div>}

      <section className="niche-filter-card">
        <div className="niche-periods"><b>时间范围</b>{PERIODS.map((days) => <button key={days} className={period === days ? "active" : ""} onClick={() => setPeriod(days)}>{days} 天</button>)}</div>
        <label className="niche-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索中文、俄文或 WB subject ID" /></label>
        <div className="niche-composite-filters">
          <label>一级/父级品类<select value={parentFilter} onChange={(e) => setParentFilter(e.target.value)}><option value="">全部父级</option>{parents.map((name) => <option key={name}>{name}</option>)}</select></label>
          <label>类目层级<select value={levelFilter} onChange={(e) => setLevelFilter(Number(e.target.value))}><option value={0}>全部层级</option><option value={1}>一级品类</option><option value={2}>二级品类</option><option value={3}>三级细分类目</option></select></label>
          <label>最低销售额<input inputMode="numeric" value={minimumRevenue} onChange={(e) => setMinimumRevenue(e.target.value)} placeholder="₽" /></label>
          <label>最低增长率<input inputMode="decimal" value={minimumGrowth} onChange={(e) => setMinimumGrowth(e.target.value)} placeholder="%" /></label>
          <label>最大卖家数<input inputMode="numeric" value={maximumSellers} onChange={(e) => setMaximumSellers(e.target.value)} placeholder="家" /></label>
          <label>最低购买率<input inputMode="decimal" value={minimumBuyout} onChange={(e) => setMinimumBuyout(e.target.value)} placeholder="%" /></label>
          <label>最高集中度<input inputMode="decimal" value={maximumConcentration} onChange={(e) => setMaximumConcentration(e.target.value)} placeholder="%" /></label>
        </div>
        <div className="niche-score-settings"><button onClick={() => setScoreSettingsOpen((value) => !value)}>⚙ 机会评分参数</button><small>先归一化，再按权重合成；权重保存在当前浏览器。</small>{scoreSettingsOpen && <div>{(Object.keys(weights) as Array<keyof ScoreWeights>).map((key) => <label key={key}><span>{({marketSize:"市场规模",growth:"增长",sellerScarcity:"卖家稀缺",productScarcity:"商品稀缺",lowConcentration:"低集中度",buyout:"购买率",turnover:"周转",supplyDemand:"供需",lowSeasonality:"低季节性风险"} as Record<keyof ScoreWeights,string>)[key]}</span><input type="number" min="0" max="100" value={weights[key]} onChange={(e) => updateWeight(key,e.target.value)} /></label>)}<button onClick={() => { setWeights(DEFAULT_SCORE_WEIGHTS); window.localStorage.removeItem("wb-market-score-weights"); }}>恢复默认权重</button></div>}</div>
      </section>

      {!!data?.watchlist?.length && <section className="niche-watch-section"><header><div><h2>选品观察列表</h2><p>对比当前官方快照与上一份同周期快照，判断需求与竞争是否同步变化。</p></div><span>{data.watchlist.length} 个品类</span></header><div className="niche-watch-grid">{data.watchlist.map(({ current, previous }) => <a href={`/market/category/${encodeURIComponent(current.subjectId)}?period=${period}`} key={current.subjectId}><b>{current.nameZh || current.nameRu}</b><small>{current.nameRu} · WB {current.subjectId}</small><dl><div><dt>销售额</dt><dd>{money(previous?.revenueRub)} → {money(current.revenueRub)}</dd></div><div><dt>卖家</dt><dd>{numberLabel(previous?.sellerCount)} → {numberLabel(current.sellerCount)}</dd></div><div><dt>商品卡</dt><dd>{numberLabel(previous?.productCount)} → {numberLabel(current.productCount)}</dd></div><div><dt>平均价</dt><dd>{money(previous?.averagePriceRub)} → {money(current.averagePriceRub)}</dd></div><div><dt>机会评分变化</dt><dd>—</dd></div></dl><em>{previous ? `上一快照 ${previous.metricDate}` : "等待下一份不同日期快照"}</em></a>)}</div></section>}

      <section className="niche-potential-section"><header><div><h2>潜力品类</h2><p>基于当前筛选集归一化评分，只用于缩小研究范围，不构成囤货建议。</p></div><span>值得进一步研究</span></header>{potentials.length ? <div className="niche-potential-grid">{potentials.map((row) => <a href={`/market/category/${encodeURIComponent(row.subjectId)}?period=${period}`} key={row.subjectId}><i>{row.opportunityScore}</i><b>{row.nameZh || row.nameRu}</b><small>{row.nameRu}</small><p>{row.opportunityReasons?.slice(0, 2).join("；")}</p></a>)}</div> : <div className="niche-empty-inline">当前没有足够真实指标生成潜力品类。导入 WB 官方报表后系统才会评分。</div>}</section>

      <section className="niche-table-panel"><header><div><h2>全市场品类总览</h2><p>{data?.sourceFile ? `来源：${data.sourceFile} · 更新于 ${timeLabel(data.importedAt)}` : "尚未导入全市场报表"}</p></div><div className="niche-table-actions"><select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>{NUMERIC_KEYS.map((key) => <option key={key} value={key}>{({revenueRub:"销售额",salesUnits:"销量",revenueGrowth:"销售增长",salesGrowth:"销量增长",sellerCount:"卖家数量",productCount:"商品卡数量",averagePriceRub:"平均价格",buyoutRate:"购买率",turnoverDays:"周转天数",concentration:"集中度",opportunityScore:"机会评分"} as Record<string,string>)[key]}</option>)}</select><button onClick={() => setDescending((value) => !value)}>{descending ? "从高到低 ↓" : "从低到高 ↑"}</button>{selected.length > 1 && <a href={`/niches/compare?ids=${selected.map(encodeURIComponent).join(",")}&period=${period}`}>对比 {selected.length} 个品类</a>}</div></header>
        {!loading && !filtered.length ? <div className="niche-empty-state"><strong>暂无可展示的全市场品类数据</strong><p>{data?.availablePeriods?.length ? `已导入周期：${data.availablePeriods.join("、")} 天；当前选择 ${period} 天。` : "请从 WB 卖家后台导出《Анализ ниш》，另存为 CSV 后导入。系统不会用店铺数据填充这里。"}</p><button onClick={() => fileRef.current?.click()}>选择官方报表</button></div> : <div className="niche-table-wrap" data-horizontal-scroll><table className="niche-table"><thead><tr><th>对比</th><th>品类 / WB ID</th><th>机会评分</th><th>销售额</th><th>销量</th><th>销售增长</th><th>销量增长</th><th>卖家</th><th>商品卡</th><th>平均价格</th><th>购买率</th><th>平均库存</th><th>周转天数</th><th>集中度</th><th>季节性</th><th>供需</th><th>来源 / 更新</th><th>操作</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td><input type="checkbox" checked={selected.includes(row.subjectId)} onChange={() => selectForCompare(row.subjectId)} aria-label={`对比 ${row.nameRu}`} /></td><td><a href={`/market/category/${encodeURIComponent(row.subjectId)}?period=${period}`}><b>{row.nameZh || row.nameRu}</b><span>{row.nameZh ? row.nameRu : ""}</span><small>WB {row.subjectId}</small></a></td><td><button className="niche-score" disabled={row.opportunityScore == null} onClick={() => setScoreOpen(scoreOpen === row.id ? "" : row.id)}>{row.opportunityScore ?? "—"}</button>{scoreOpen === row.id && <div className="niche-score-popover"><b>评分说明</b>{row.opportunityReasons?.map((reason) => <p key={reason}>• {reason}</p>)}<small>各指标在当前筛选结果内做百分位归一化；缺失指标不参与。</small></div>}</td><td>{money(row.revenueRub)}</td><td>{numberLabel(row.salesUnits)}</td><td>{numberLabel(row.revenueGrowth,"%")}</td><td>{numberLabel(row.salesGrowth,"%")}</td><td>{numberLabel(row.sellerCount)}</td><td>{numberLabel(row.productCount)}</td><td>{money(row.averagePriceRub)}</td><td>{numberLabel(row.buyoutRate,"%")}</td><td>{numberLabel(row.averageStock)}</td><td>{numberLabel(row.turnoverDays," 天")}</td><td>{numberLabel(row.concentration,"%")}</td><td>{numberLabel(row.seasonality)}</td><td>{numberLabel(row.supplyDemand)}</td><td><span className="niche-source">WB_EXPORT</span><small>{row.metricDate}</small><em>官方导出</em></td><td><button className={(data?.watchedIds || []).includes(row.subjectId) ? "watched" : ""} onClick={() => void toggleWatch(row)}>{(data?.watchedIds || []).includes(row.subjectId) ? "已观察" : "加入观察"}</button></td></tr>)}</tbody></table></div>}
      </section>

      <section className="niche-source-matrix"><article><b>公开 API 可直接取得</b>{data?.sourceBoundary.directlyAvailable.map((item) => <p key={item}>✓ {item}</p>)}</article><article><b>需要 WB 官方报表导入</b>{data?.sourceBoundary.requiresExport.map((item) => <p key={item}>↥ {item}</p>)}</article><article><b>当前公开来源不可用</b>{data?.sourceBoundary.unavailable.map((item) => <p key={item}>— {item}</p>)}</article></section>
    </main>
  </div>;
}
