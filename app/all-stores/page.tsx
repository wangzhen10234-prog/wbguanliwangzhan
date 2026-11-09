"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "../_components/app-sidebar";
import { DEFAULT_GROUP_SETTINGS, buildAllStoresReport, csvCell, dayInZone, mondayOf, nextGroupSyncAt, reportDays, shiftDay, type AllStoresReport, type GroupSettings, type GroupStoreData, type ReportEvent } from "../_lib/all-stores-report";

type Store = { id: string; name: string };
type SavedStatement = { id: string; savedAt: string; report: AllStoresReport; settings: GroupSettings; sourceTimes: Record<string, string> };
type StatementSummary = { id: string; savedAt: string; from: string; to: string; orders: number; returns: number };
type Tab = "daily" | "weekly" | "returns" | "batches" | "mapping";
function formatTime(at?: string | null, zone = "Asia/Shanghai") {
  if (!at || !Number.isFinite(Date.parse(at))) return "尚未成功读取";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(at));
}
async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, signal: init.signal || AbortSignal.timeout(65_000) });
  if (response.status === 401) throw new Error("登录已过期，请刷新页面重新登录");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "读取失败，请稍后重试");
  return body as T;
}
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
function blankStore(store: Store, from: string, to: string, warning: string): GroupStoreData {
  return { storeId: store.id, storeName: store.name, orders: [], returns: [], products: [], supplies: [], ordersState: "error", returnsState: "error", catalogState: "error", suppliesState: "error", ordersAt: null, returnsAt: null, suppliesAt: null, coverageStart: null, supplyWindow: { from, to }, warnings: [warning] };
}

export default function AllStoresPage() {
  const [clock, setClock] = useState(() => Date.now());
  const [today] = useState(() => dayInZone(Date.now(), "Asia/Shanghai"));
  const [from, setFrom] = useState(mondayOf(today));
  const [to, setTo] = useState(today);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [history, setHistory] = useState<StatementSummary[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [sources, setSources] = useState<GroupStoreData[]>([]);
  const [settings, setSettings] = useState<GroupSettings>(DEFAULT_GROUP_SETTINGS);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<Tab>("daily");
  const [query, setQuery] = useState("");
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SavedStatement | null>(null);
  const [savedLink, setSavedLink] = useState("");
  const [detail, setDetail] = useState<{ title: string; events: ReportEvent[] } | null>(null);
  const [showPending, setShowPending] = useState(false);
  const forceRef = useRef(false);
  const dirtyRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      try {
        const statement = new URLSearchParams(window.location.search).get("statement");
        if (statement) {
          const copy = await api<SavedStatement>(`/api/all-stores?statement=${encodeURIComponent(statement)}`, { signal: controller.signal });
          if (!active) return;
          setSaved(copy); setSettings(copy.settings); setFrom(copy.report.from); setTo(copy.report.to); setDraftFrom(copy.report.from); setDraftTo(copy.report.to);
          return;
        }
        const manifest = await api<{ stores: Store[]; settings: GroupSettings; statements: StatementSummary[] }>("/api/all-stores", { signal: controller.signal });
        if (!active) return;
        setStores(manifest.stores); setHistory(manifest.statements || []);
        if (!dirtyRef.current) setSettings(manifest.settings);
        setSources([]);
        setProgress(Object.fromEntries(manifest.stores.map((store) => [store.id, "等待同步"])));
        const force = forceRef.current; forceRef.current = false;
        let cursor = 0;
        // Two stores at a time, with a separate bounded request for each. A
        // failed store never prevents the other stores' quantities displaying.
        await Promise.all([0, 1].map(async () => {
          while (active && cursor < manifest.stores.length) {
            const store = manifest.stores[cursor++];
            setProgress((previous) => ({ ...previous, [store.id]: "正在核对供货单、订单与退货…" }));
            let source: GroupStoreData;
            try {
              const params = new URLSearchParams({ storeId: store.id, from, to });
              if (force) params.set("refresh", "manual");
              source = await api<GroupStoreData>(`/api/all-stores?${params}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(65_000)]) });
            } catch (reason) {
              source = blankStore(store, from, to, reason instanceof Error ? reason.message : "未能读取");
            }
            if (!active) return;
            setSources((previous) => [...previous.filter((row) => row.storeId !== store.id), source]);
            setProgress((previous) => ({ ...previous, [store.id]: source.ordersState === "fresh" && source.returnsState === "fresh" && source.suppliesState === "fresh" && source.catalogState === "fresh" ? "同步完成" : "部分资料待更新" }));
          }
        }));
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : "读取失败"); }
      finally { if (active) { setLoading(false); setClock(Date.now()); } }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [from, to, reload]);

  useEffect(() => {
    if (!detail && !showPending) return;
    const previous = document.activeElement;
    const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>("button");
    buttons?.[0]?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setDetail(null); setShowPending(false); }
      if (event.key === "Tab" && buttons?.length) {
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("keydown", close); if (previous instanceof HTMLElement) previous.focus(); };
  }, [detail, showPending]);

  // While this page is open, discover added stores and refresh every five
  // minutes. A hidden tab does not spend the seller API's rate limit.
  useEffect(() => {
    if (saved) return;
    const timer = window.setInterval(() => {
      if (!document.hidden && !loading && !saving && !dirtyRef.current) { setLoading(true); setError(""); setReload((n) => n + 1); }
    }, 300_000);
    return () => window.clearInterval(timer);
  }, [saved, loading, saving]);

  const report = useMemo(() => saved?.report || buildAllStoresReport(sources, from, to, settings), [saved, sources, from, to, settings]);
  const needle = query.trim().toLowerCase();
  const skus = report.skuList.filter((sku) => !needle || sku.toLowerCase().includes(needle));
  const totalOrders = report.totals.reduce((sum, row) => sum + row.orders, 0);
  const totalReturns = report.totals.reduce((sum, row) => sum + row.returns, 0);
  const missingSources = !saved && (sources.length !== stores.length || stores.length === 0);
  const complete = !loading && !error && !missingSources && report.complete;
  const mapped = report.sources.every((source) => source.automatic || !report.events.some((event) => !event.excluded && event.sourceKey === source.key));
  const partial = !saved && !complete;
  const oldestAt = sources.flatMap((source) => [source.ordersAt, source.returnsAt, source.suppliesAt]).filter((at): at is string => Boolean(at)).sort()[0];
  function refresh() { if (saved) { window.location.href = "/all-stores"; return; } forceRef.current = true; setLoading(true); setError(""); setNotice(""); setReload((n) => n + 1); }
  function range(nextFrom: string, nextTo: string) {
    try {
      reportDays(nextFrom, nextTo);
      if (nextTo > today) throw new Error("结束日期不能晚于今天");
      setDraftFrom(nextFrom); setDraftTo(nextTo); setError(""); setNotice(""); setDetail(null); setShowPending(false);
      if (from === nextFrom && to === nextTo) return;
      setLoading(true); setFrom(nextFrom); setTo(nextTo);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "日期无效"); }
  }
  function changeMapping(key: string, value: string) {
    dirtyRef.current = true; setDirty(true);
    setSettings((previous) => { const mappings = { ...previous.mappings }; if (value.trim()) mappings[key] = value; else delete mappings[key]; return { ...previous, mappings }; });
  }
  async function saveSettings() {
    setSaving(true); setError("");
    try {
      const result = await api<{ settings: GroupSettings }>("/api/all-stores", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
      setSettings(result.settings); setDirty(false); dirtyRef.current = false; setNotice("SKU 对应已保存，不会修改任何店铺的产品资料。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); }
    finally { setSaving(false); }
  }
  async function saveStatement() {
    setSaving(true); setError("");
    try {
      const result = await api<{ id: string; savedAt: string }>("/api/all-stores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from, to, version: settings.version, sourceTimes: Object.fromEntries(sources.map((source) => [source.storeId, `${source.ordersAt}|${source.returnsAt}|${source.suppliesAt}`])) }) });
      const link = `/all-stores?statement=${result.id}`;
      setHistory((previous) => [{ id: result.id, savedAt: result.savedAt, from, to, orders: totalOrders, returns: totalReturns }, ...previous].slice(0, 30));
      setSavedLink(link); setNotice("本期数量快照已保存。打开快照链接可查看本次核对的固定结果，后续同步不会改写它。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); }
    finally { setSaving(false); }
  }
  function exportCsv() {
    const rows: unknown[][] = [
      ["所有店铺综合经营总览", from, to],
      ["状态", saved ? `已保存快照 ${saved.id}` : partial ? "不完整，不能作为完整结算依据" : dirty ? "SKU 对应尚未保存" : "已完成接口核对"],
      ["时间口径", "北京时间；单量按实际所属供货单创建日期，退货按取回日期；周一至周日"],
      ...report.problems.map((problem) => ["数据提示", problem]),
      ["每日已处理订单", ...report.skuList, "单日单量"],
      ...report.daily.map((row) => [row.day, ...report.skuList.map((sku) => row.counts[sku] || 0), row.total]),
      ["数量合计", ...report.skuList.map((sku) => report.totals.find((row) => row.sku === sku)?.orders || 0), totalOrders],
      [], ["每日取回退货", ...report.skuList, "单日退货量"],
      ...report.returnsDaily.map((row) => [row.day, ...report.skuList.map((sku) => row.counts[sku] || 0), row.total]),
      ["退货合计", ...report.skuList.map((sku) => report.totals.find((row) => row.sku === sku)?.returns || 0), totalReturns],
      [], ["每周汇总", "星期一", "星期日", "SKU", "已处理单量", "已取回退货", "周期"],
      ...report.weeks.flatMap((week) => week.rows.map((row) => ["周汇总", week.monday, week.sunday, row.sku, row.orders, row.returns, week.partial ? "仅所选日期，非完整周" : "完整周"])),
      [], ["逐笔明细", "类型", "归档日期", "店铺", "汇总SKU", "卖家商品编号", "订单号", "供货单号", "供货单创建/取回时间（北京时间）", "原始下单时间", "状态", "是否排除", "说明"],
      ...report.events.map((event) => ["明细", event.kind === "order" ? "订单" : "退货", event.day, event.storeName, event.sku, event.sellerSku, event.orderId, event.supplyId, formatTime(event.at), event.orderedAt, event.status, event.excluded ? "排除" : "计入", event.reason]),
    ];
    download(`全部店铺数量_${from}_${to}${partial ? "_未完整" : ""}.csv`, `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`, "text/csv;charset=utf-8");
  }
  function openEvents(kind: "order" | "return", day?: string, sku?: string, excluded = false) {
    setDetail({ title: `${day || "所选周期"} · ${sku || "全部 SKU"} · ${excluded ? "已排除无效订单" : kind === "order" ? "供货单订单" : "实际取回退货"}`, events: report.events.filter((event) => event.kind === kind && event.excluded === excluded && (!day || event.day === day) && (!sku || event.sku === sku)) });
  }
  function matrix(kind: "order" | "return") {
    const rows = kind === "order" ? report.daily : report.returnsDaily;
    return <div className="group-scroll" data-horizontal-scroll><table className="group-matrix"><thead><tr><th>日期（北京时间）</th>{skus.map((sku) => <th key={sku}>{sku}</th>)}<th>单日合计{needle ? "（全部SKU）" : ""}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.day}><th>{row.day}<small>{new Intl.DateTimeFormat("zh-CN", { weekday: "short", timeZone: "UTC" }).format(new Date(`${row.day}T00:00:00Z`))}</small></th>{skus.map((sku) => <td key={sku}>{row.counts[sku] ? <button type="button" className="group-count" onClick={() => openEvents(kind, row.day, sku)}>{row.counts[sku]}</button> : <span className="group-zero">—</span>}</td>)}<td><button type="button" className="group-count" onClick={() => openEvents(kind, row.day)}>{row.total}</button></td></tr>)}</tbody><tfoot><tr><th>数量合计</th>{skus.map((sku) => <td key={sku}><button type="button" className="group-count" onClick={() => openEvents(kind, undefined, sku)}>{report.totals.find((row) => row.sku === sku)?.[kind === "order" ? "orders" : "returns"] || 0}</button></td>)}<td>{kind === "order" ? totalOrders : totalReturns}</td></tr></tfoot></table></div>;
  }

  return <main className="app-shell">
    <AppSidebar active="all-stores" syncHoursLabel="14:10 · 16:10 · 22:10" nextSyncAt={nextGroupSyncAt(clock)} syncedAt={oldestAt || saved?.savedAt} loading={loading} error={error} warning={partial && !loading ? "全部店铺汇总尚未完整" : ""} onRefresh={refresh} />
    <section className="workspace group-workspace">
      <header className="topbar group-header"><div><p className="eyebrow">ALL STORES · DAILY SKU LEDGER</p><h1>所有店铺综合经营总览</h1><p>按实际供货批次核对每日 SKU 单量，退货按取回时间独立汇总。</p></div><div className="group-actions"><button type="button" disabled={loading || !report.events.length} onClick={exportCsv}>导出数量表</button>{!saved && <button type="button" className="primary" disabled={!complete || !mapped || dirty || saving} title="全部店铺读取完整、SKU 对应已保存后可保存" onClick={() => void saveStatement()}>{saving ? "正在保存…" : "保存本期数量快照"}</button>}</div></header>

      {saved ? <section className="group-banner"><b>已保存的数量快照 · {formatTime(saved.savedAt)}</b><p>这是保存时的固定数量，不随之后的订单变动改写。<a href="/all-stores">返回实时总览</a></p><small>快照编号 {saved.id}</small></section> : <>
        <section className="group-panel group-controls"><div className="group-presets"><b>结算周期</b><button type="button" onClick={() => range(today, today)}>今天</button><button type="button" onClick={() => range(mondayOf(today), today)}>本周</button><button type="button" onClick={() => range(shiftDay(mondayOf(today), -7), shiftDay(mondayOf(today), -1))}>上周（周一～周日）</button><button type="button" onClick={() => range(shiftDay(today, -29), today)}>近30天</button></div><div className="group-dates"><label>开始日期<input type="date" value={draftFrom} max={draftTo} onChange={(event) => setDraftFrom(event.target.value)} /></label><span>至</span><label>结束日期<input type="date" value={draftTo} min={draftFrom} max={today} onChange={(event) => setDraftTo(event.target.value)} /></label><button type="button" className="primary" onClick={() => range(draftFrom, draftTo)}>查询</button></div></section>
        <section className="group-rule"><b>北京时间 · 按供货单创建日期归档</b><p>同一天多张供货单合并，跨店订单分别核对，每个组装订单计 1 件；未建立供货单的有效新订单单列“待处理”。新订单阶段客户取消不计入数量。退货按实际取回时间换算为北京时间；WB 未带时区的退货时间按莫斯科时间解释。</p><small>本模块覆盖已启用店铺的 FBS 订单。新店保存 API 后，下次同步自动纳入。后台每天北京时间 14:10、16:10、22:10 自动归档近 8 天；页面打开时每 5 分钟检查更新。</small></section>
      </>}

      {error && <div className="group-alert" role="alert">{error}</div>}
      {notice && <div className="group-banner" role="status">{notice}{savedLink && <p><a href={savedLink} target="_blank" rel="noreferrer">打开已保存的数量快照 ↗</a>（可收藏此链接）</p>}</div>}
      {!saved && <section className="group-stores">{stores.map((store) => { const source = sources.find((row) => row.storeId === store.id); return <div className={`group-store ${source && source.ordersState === "fresh" && source.suppliesState === "fresh" && source.returnsState === "fresh" ? "ok" : "pending"}`} key={store.id}><b>{store.name}</b><span>{progress[store.id] || "等待同步"}</span>{source && <small>供货单 {formatTime(source.suppliesAt)}<br />订单 {formatTime(source.ordersAt)}<br />退货 {formatTime(source.returnsAt)}</small>}</div>; })}</section>}
      {(partial || report.problems.length > 0) && <section className="group-alert"><strong>{loading ? "正在汇总，当前数字仍在变化" : "当前汇总未完整，请先处理以下提示"}</strong><p>未读取到的资料不会当成 0。资料完整前无法保存完整数量快照。</p>{report.problems.length > 0 && <details><summary>查看 {report.problems.length} 项核对提示</summary><ul>{report.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul></details>}</section>}

      {!loading && !mapped && <section className="group-alert"><b>部分商品尚未合并到跨店 SKU</b><p>数量目前按店铺分别列出。请到“SKU 对应设置”填写同款统一编码，保存后即可合并，避免把不同规格算成同一款。</p><button type="button" className="group-text" onClick={() => setTab("mapping")}>打开 SKU 对应设置 →</button></section>}
      <section className="group-metrics"><button type="button" onClick={() => { setTab("daily"); setQuery(""); }}><span>本期已处理订单</span><b>{totalOrders}</b><small>{partial ? "暂计 · 数据未完整" : `${from} 至 ${to}`} · 按供货单</small></button><button type="button" onClick={() => { setTab("daily"); setQuery(""); }}><span>涉及 SKU</span><b>{report.totals.filter((row) => row.orders > 0).length}</b><small>跨店同款按 SKU 对应合并</small></button><button type="button" onClick={() => { setTab("returns"); setQuery(""); }}><span>本期实际取回退货</span><b>{totalReturns}</b><small>与发货单量分开列示，不自动相减</small></button><button type="button" onClick={() => setShowPending(true)}><span>当前有效新订单待处理</span><b>{report.pendingOrders.length}</b><small>全部当前待处理，不限所选周期 · 尚未计入批次</small></button></section>

      <section className="group-panel group-report"><div className="group-report-head"><div className="group-tabs" role="tablist" aria-label="汇总视图">{([["daily", "每日 SKU 数量"], ["weekly", "每周 SKU 汇总"], ["returns", "退货数量"], ["batches", "供货单核对"], ["mapping", "SKU 对应设置"]] as [Tab, string][]).map(([key, label]) => <button type="button" role="tab" aria-selected={tab === key} key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}</div><input type="search" aria-label="搜索汇总 SKU" placeholder="搜索汇总 SKU" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        {(tab === "daily" || tab === "returns") && <><div className="group-section-copy"><b>{tab === "daily" ? "每日已处理订单 · 商品数量表" : "每日实际取回退货 · 商品数量表"}</b><p>点击数字可核对具体订单。{tab === "returns" ? `尚未取回的退货另有 ${report.pendingReturns} 件（全部当前退货），不计入取回数量。` : "日期来自供货单创建时间，不使用订单下单日或固定中午截止时间。"}</p>{report.excluded > 0 && <button type="button" className="group-text" onClick={() => openEvents("order", undefined, undefined, true)}>查看已排除的 {report.excluded} 笔无效订单</button>}</div>{matrix(tab === "daily" ? "order" : "return")}</>}
        {tab === "weekly" && <><div className="group-section-copy"><b>自然周：周一至周日</b><p>所选周期切断某一周时，仅汇总选中的日期，并明确标记“非完整周”。退货独立展示。</p></div><div className="group-scroll" data-horizontal-scroll><table><thead><tr><th>星期一 ～ 星期日</th><th>汇总 SKU</th><th>已处理单量</th><th>实际取回退货</th><th>统计范围</th></tr></thead><tbody>{report.weeks.flatMap((week) => week.rows.filter((row) => skus.includes(row.sku)).map((row) => <tr key={`${week.monday}:${row.sku}`}><td>{week.monday} ～ {week.sunday}</td><th>{row.sku}</th><td><button type="button" className="group-count" onClick={() => setDetail({ title: `${week.monday} ～ ${week.sunday} · ${row.sku} · 供货订单`, events: report.events.filter((event) => event.kind === "order" && !event.excluded && event.sku === row.sku && event.day >= week.monday && event.day <= week.sunday) })}>{row.orders}</button></td><td><button type="button" className="group-count" onClick={() => setDetail({ title: `${week.monday} ～ ${week.sunday} · ${row.sku} · 取回退货`, events: report.events.filter((event) => event.kind === "return" && event.sku === row.sku && event.day >= week.monday && event.day <= week.sunday) })}>{row.returns}</button></td><td>{week.partial ? "非完整周 · 仅所选日期" : "完整周"}</td></tr>))}</tbody></table></div></>}
        {tab === "batches" && <><div className="group-section-copy"><b>各店供货单创建时间及订单数量</b><p>同一张供货单中的订单合计会逐笔去重。空供货单显示 0；未读取成功会显示“未读取”，不会显示为 0。</p></div><div className="group-scroll" data-horizontal-scroll><table><thead><tr><th>归档日期</th><th>店铺</th><th>供货单</th><th>创建时间（北京时间）</th><th>已包含订单</th><th>状态</th></tr></thead><tbody>{saved ? [...new Map(report.events.filter((event) => event.kind === "order").map((event) => [`${event.storeId}:${event.supplyId}`, event])).values()].map((event) => <tr key={`${event.storeId}:${event.supplyId}`}><td>{event.day}</td><td>{event.storeName}</td><td>{event.supplyId}</td><td>{formatTime(event.at)}</td><td>{report.events.filter((row) => row.storeId === event.storeId && row.supplyId === event.supplyId && !row.excluded).length}</td><td>保存时数量</td></tr>) : sources.flatMap((source) => source.supplies.filter((supply) => { const day = dayInZone(supply.createdAt, "Asia/Shanghai"); return day >= from && day <= to; }).map((supply) => <tr key={`${source.storeId}:${supply.id}`}><td>{dayInZone(supply.createdAt, "Asia/Shanghai")}</td><td>{source.storeName}</td><td><b>{supply.name}</b><small>{supply.id}</small></td><td>{formatTime(supply.createdAt)}</td><td>{supply.loaded ? <button type="button" className="group-count" onClick={() => setDetail({ title: `${source.storeName} · ${supply.id}`, events: report.events.filter((event) => event.storeId === source.storeId && event.supplyId === supply.id) })}>{supply.orderIds.length}</button> : "未读取"}</td><td>{supply.done ? "已交付配送" : "供货单仍开放，数量可能继续变化"}</td></tr>))}</tbody></table></div></>}
        {tab === "mapping" && <><div className="group-section-copy group-mapping-head"><div><b>不同店铺的同款商品合并到同一汇总 SKU</b><p>内部 SKU 和规格完全一致才自动合并。其余保留“店铺 / 商品编码”，请手动填写同一个汇总 SKU；不会更改原产品详情。</p></div>{!saved && <button type="button" className="primary" disabled={!dirty || saving} onClick={() => void saveSettings()}>{saving ? "保存中…" : dirty ? "保存 SKU 对应" : "已保存"}</button>}</div><div className="group-scroll" data-horizontal-scroll><table><thead><tr><th>店铺</th><th>卖家商品编号</th><th>内部 SKU</th><th>规格</th><th>汇总 SKU（同款填写相同值）</th><th>对应状态</th></tr></thead><tbody>{report.sources.filter((source) => !needle || [source.sku, source.sellerSku, source.internalSku].some((value) => value.toLowerCase().includes(needle))).map((source) => <tr key={source.key}><td>{source.storeName}</td><th>{source.sellerSku}</th><td>{source.internalSku || "—"}</td><td>{source.specification || "—"}</td><td><input type="text" aria-label={`${source.storeName} ${source.sellerSku} 汇总SKU`} disabled={Boolean(saved)} value={settings.mappings[source.key] ?? ""} placeholder={source.sku} maxLength={100} onChange={(event) => changeMapping(source.key, event.target.value)} /></td><td>{settings.mappings[source.key] ? "手动对应" : source.automatic ? "内部SKU＋规格一致" : "未合并，待核对"}</td></tr>)}</tbody></table></div></>}
        {!loading && !report.events.length && <p className="group-empty">{partial ? "数据尚未读取完整，请查看同步提示。" : "所选周期没有可计入的供货订单或已取回退货。"}</p>}
      </section>
      {!saved && history.length > 0 && <details className="group-panel group-history"><summary>最近保存的数量快照（{history.length}）</summary><div>{history.map((item) => <a href={`/all-stores?statement=${item.id}`} key={item.id}><b>{item.from} ～ {item.to}</b><span>订单 {item.orders} · 取回退货 {item.returns}</span><small>保存于 {formatTime(item.savedAt)} ↗</small></a>)}</div></details>}
      <p className="group-footnote">数量用于供货核对：已处理订单量不等于买家签收销量，退货取回量不等于当日客户取消量。来源为 WB 供货单、组装订单和退货与商品移动报表。</p>
    </section>
    {(detail || showPending) && <div className="group-dialog-backdrop"><section className="group-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-label={detail?.title || "当前待处理订单"}><header><div><b>{detail?.title || "当前有效新订单待处理"}</b><p>北京时间 · 每个订单计 1 件 · 可按订单号回到 WB 后台核对</p></div><button type="button" aria-label="关闭明细" onClick={() => { setDetail(null); setShowPending(false); }}>×</button></header><div className="group-scroll" data-horizontal-scroll>{detail ? <table><thead><tr><th>店铺</th><th>SKU / 卖家编码</th><th>订单号 / WB货号</th><th>供货单</th><th>供货单创建 / 实际取回</th><th>原始下单时间</th><th>状态与说明</th></tr></thead><tbody>{detail.events.map((event) => <tr key={event.key}><td>{event.storeName}</td><td><b>{event.sku}</b><small>{event.sellerSku}</small></td><td>{event.orderId || "WB未提供"}<small>WB {event.nmId}</small></td><td>{event.supplyId || "退货"}</td><td>{formatTime(event.at)}{event.kind === "return" && <small>莫斯科 {formatTime(event.at, "Europe/Moscow")}</small>}</td><td>{formatTime(event.orderedAt)}</td><td>{event.status}<small>{event.reason}</small></td></tr>)}</tbody></table> : <table><thead><tr><th>店铺</th><th>SKU</th><th>订单号</th><th>下单时间（北京时间）</th></tr></thead><tbody>{report.pendingOrders.map((order) => <tr key={`${order.storeId}:${order.orderId}`}><td>{order.storeName}</td><td>{order.sku}</td><td>{order.orderId}</td><td>{formatTime(order.createdAt)}</td></tr>)}</tbody></table>}</div><footer><button type="button" onClick={() => { setDetail(null); setShowPending(false); }}>关闭</button></footer></section></div>}
  </main>;
}
