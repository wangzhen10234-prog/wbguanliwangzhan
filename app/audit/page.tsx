"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppSidebar } from "../_components/app-sidebar";
import { auditPhotoCandidates, type ProductAuditResult } from "../_lib/product-audit";

type AuditData = {
  source: "wildberries";
  syncedAt: string;
  period: { from: string; to: string; days: number };
  syncSchedule: { nextAt: string; mode: "scheduled" | "manual" };
  dataAvailability: {
    productCards: boolean;
    salesFunnel: boolean;
    searchQueries: boolean;
    visualSemantics: false;
    searchReason: string;
  };
  summary: {
    products: number;
    critical: number;
    highPriority: number;
    contentIncomplete: number;
    lowConversion: number;
    healthy: number;
    averageScore: number;
  };
  products: ProductAuditResult[];
};

type SummaryFilter = "all" | "priority" | "content" | "conversion" | "healthy";
type SortKey = "overall" | "image" | "title" | "description" | "attributes" | "funnel" | "traffic" | "orders";

const DAY_MS = 86_400_000;

function beijingDateKey(value: Date | string = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function shiftDate(value: string, days: number) {
  return new Date(new Date(`${value}T12:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function countDays(from: string, to: string) {
  return Math.round((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / DAY_MS) + 1;
}

function percent(value: number) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function scoreTone(value: number) {
  return value >= 78 ? "good" : value >= 60 ? "medium" : "bad";
}

function priorityLabel(value: ProductAuditResult["priority"]) {
  return ({ critical: "立即优化", high: "优先优化", medium: "持续优化", healthy: "表现健康" } as const)[value];
}

function areaLabel(value: ProductAuditResult["issues"][number]["area"]) {
  return ({ image: "图片", title: "标题", description: "描述", attributes: "特征", funnel: "转化" } as const)[value];
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function productPhoto(product: ProductAuditResult) {
  const photo = product.photos[0];
  return photo?.c246x328 || photo?.c516x688 || photo?.hq || photo?.big || photo?.square || "";
}

function AuditPhotoImage({ photo, mode, alt, onDimensions, onUnavailable }: {
  photo: ProductAuditResult["photos"][number];
  mode: "preview" | "thumb";
  alt: string;
  onDimensions?: (width: number, height: number) => void;
  onUnavailable?: () => void;
}) {
  const candidates = auditPhotoCandidates(photo, mode);
  const [attempt, setAttempt] = useState(0);
  const source = candidates[attempt];
  if (!source) return <span className="audit-photo-unavailable">图片源暂时不可用</span>;
  return <img
    src={source}
    alt={alt}
    referrerPolicy="no-referrer"
    onLoad={(event) => onDimensions?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
    onError={() => {
      if (attempt + 1 < candidates.length) setAttempt(attempt + 1);
      else {
        onUnavailable?.();
        setAttempt(candidates.length);
      }
    }}
  />;
}

function ScoreGauge({ label, value }: { label: string; value: number }) {
  return <div className="audit-score-gauge"><div><span>{label}</span><b className={scoreTone(value)}>{value}</b></div><i><em className={scoreTone(value)} style={{ width: `${value}%` }} /></i></div>;
}

function SourceChip({ connected, children }: { connected: boolean; children: ReactNode }) {
  return <span className={`audit-source-chip ${connected ? "connected" : "unavailable"}`}><i />{children}</span>;
}

function ProductDetail({ product, onClose }: { product: ProductAuditResult; onClose: () => void }) {
  const [activePhoto, setActivePhoto] = useState(0);
  const [photoDimensions, setPhotoDimensions] = useState<Record<number, string>>({});
  const photos = product.photos;
  const selectedPhoto = photos[activePhoto];
  const selectedHasSource = auditPhotoCandidates(selectedPhoto, "preview").length > 0;

  return <div className="audit-drawer-layer" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <aside className="audit-drawer" role="dialog" aria-modal="true" aria-labelledby="audit-detail-title">
      <header className="audit-drawer-header">
        <div><span>WB {product.nmId}</span><h2 id="audit-detail-title">{product.sku}</h2><p>{product.title}</p></div>
        <button type="button" onClick={onClose} aria-label="关闭商品诊断">×</button>
      </header>

      <section className="audit-detail-overview">
        <div className={`audit-overall-score ${scoreTone(product.scores.overall)}`}><span>综合诊断</span><b>{product.scores.overall}</b><small>{priorityLabel(product.priority)}</small></div>
        <div className="audit-score-list">
          <ScoreGauge label="图片完整性" value={product.scores.image} />
          <ScoreGauge label="标题质量" value={product.scores.title} />
          <ScoreGauge label="描述质量" value={product.scores.description} />
          <ScoreGauge label="商品特征" value={product.scores.attributes} />
          <ScoreGauge label="经营转化" value={product.scores.funnel} />
        </div>
      </section>

      <section className="audit-detail-section">
        <div className="audit-detail-heading"><div><span>01</span><h3>图片诊断</h3></div><small>WB Content API · 数量、高清源与页面预览</small></div>
        <div className="audit-photo-layout">
          <div className="audit-photo-preview">
            {selectedPhoto && selectedHasSource ? <AuditPhotoImage
              key={`${product.nmId}-${activePhoto}`}
              photo={selectedPhoto}
              mode="preview"
              alt={`${product.sku} 第 ${activePhoto + 1} 张商品图`}
              onDimensions={(width, height) => setPhotoDimensions((value) => ({ ...value, [activePhoto]: `${width} × ${height}` }))}
              onUnavailable={() => setPhotoDimensions((value) => ({ ...value, [activePhoto]: "WB 图片源暂时不可用" }))}
            /> : <div>暂无商品图</div>}
            {selectedPhoto && selectedHasSource && <span className="audit-photo-dimensions">{photoDimensions[activePhoto] || "正在读取图片尺寸…"}</span>}
          </div>
          <div className="audit-photo-thumbs">
            {photos.map((photo, index) => {
              const hasSource = auditPhotoCandidates(photo, "thumb").length > 0;
              return <button key={`${product.nmId}-${index}`} type="button" className={activePhoto === index ? "active" : ""} onClick={() => setActivePhoto(index)}>{hasSource ? <AuditPhotoImage photo={photo} mode="thumb" alt="" /> : <span>{index + 1}</span>}<small>{index === 0 ? "首图" : `${index + 1}`}</small></button>;
            })}
          </div>
        </div>
        <ul className="audit-evidence-list">{product.imageEvidence.map((item) => <li key={item}>{item}</li>)}</ul>
        <p className="audit-honesty-note">系统能准确检查 WB 返回的图片数量、图片源、尺寸与顺序；构图、文案遮挡和审美仍需结合上方原图人工复核，当前不会伪造“AI 看图”结论。</p>
      </section>

      <section className="audit-detail-section">
        <div className="audit-detail-heading"><div><span>02</span><h3>标题与搜索表达</h3></div><small>当前标题原文与可核验证据</small></div>
        <blockquote className="audit-copy-block">{product.title || "WB 商品卡未返回标题"}</blockquote>
        <ul className="audit-evidence-list">{product.titleEvidence.map((item) => <li key={item}>{item}</li>)}</ul>
        <div className="audit-rewrite-framework"><b>建议标题结构</b><span>核心品类 → 关键规格/尺寸 → 核心功能 → 适用对象或场景</span><small>保留自然俄语表达；删除重复词、SKU 编码和无法验证的夸张承诺。</small></div>
      </section>

      <section className="audit-detail-section">
        <div className="audit-detail-heading"><div><span>03</span><h3>描述与卖点</h3></div><small>{product.descriptionLength} 个字符</small></div>
        <div className="audit-description-preview">{product.description || "WB 商品卡未返回商品描述"}</div>
        <ul className="audit-evidence-list">{product.descriptionEvidence.map((item) => <li key={item}>{item}</li>)}</ul>
        <div className="audit-rewrite-framework"><b>建议描述顺序</b><span>一句话用途 → 3–5 个真实卖点 → 尺寸材质 → 使用方法 → 包装清单 → 注意事项</span><small>所有数字必须与商品特征和实物一致，避免因描述不符增加拒收与退货。</small></div>
      </section>

      <section className="audit-detail-section">
        <div className="audit-detail-heading"><div><span>04</span><h3>商品特征完整性</h3></div><small>{product.characteristicCount} 项有效特征</small></div>
        <div className="audit-dimension-grid"><span>长 <b>{product.dimensions.length || "—"} cm</b></span><span>宽 <b>{product.dimensions.width || "—"} cm</b></span><span>高 <b>{product.dimensions.height || "—"} cm</b></span><span>毛重 <b>{product.dimensions.weightBrutto || "—"} kg</b></span></div>
        <div className="audit-characteristics">{product.characteristics.length ? product.characteristics.map((item) => <div key={`${item.name}-${item.value}`}><span>{item.name}</span><b>{item.value}</b></div>) : <p>WB 商品卡未返回有效特征</p>}</div>
      </section>

      <section className="audit-detail-section">
        <div className="audit-detail-heading"><div><span>05</span><h3>经营漏斗</h3></div><small>WB Sales Funnel API · 当前选择周期</small></div>
        <div className="audit-funnel-flow"><div><span>进卡</span><b>{product.funnel.openCount}</b><small>{product.funnel.openDynamic === null ? "无对比" : `环比 ${product.funnel.openDynamic >= 0 ? "+" : ""}${percent(product.funnel.openDynamic)}`}</small></div><i>→</i><div><span>加购</span><b>{product.funnel.cartCount}</b><small>转化 {percent(product.funnel.addToCartPercent)}</small></div><i>→</i><div><span>下单</span><b>{product.funnel.orderCount}</b><small>转化 {percent(product.funnel.cartToOrderPercent)}</small></div><i>→</i><div><span>买断</span><b>{product.funnel.buyoutCount}</b><small>买断率 {percent(product.funnel.buyoutPercent)}</small></div></div>
        <div className="audit-business-metrics"><span>订单额 <b>₽ {Math.round(product.funnel.orderSum).toLocaleString()}</b></span><span>平均价 <b>₽ {Math.round(product.funnel.avgPrice).toLocaleString()}</b></span><span>取消 <b>{product.funnel.cancelCount}</b></span><span>收藏 <b>{product.funnel.addToWishlist}</b></span><span>本地化率 <b>{percent(product.funnel.localizationPercent)}</b></span></div>
      </section>

      <section className="audit-detail-section priority-actions">
        <div className="audit-detail-heading"><div><span>06</span><h3>问题证据与修改顺序</h3></div><small>先处理高影响问题</small></div>
        <div className="audit-issue-list">{product.issues.length ? product.issues.map((issue, index) => <article key={`${issue.title}-${index}`} className={issue.severity}><span>{areaLabel(issue.area)}</span><div><h4>{issue.title}</h4><p>{issue.evidence}</p><b>{issue.action}</b></div></article>) : <div className="audit-no-issues">当前未发现高优先级结构问题，继续观察经营变化。</div>}</div>
        <ol className="audit-action-list">{product.recommendations.map((item) => <li key={item}>{item}</li>)}</ol>
      </section>
    </aside>
  </div>;
}

export default function AuditPage() {
  const today = beijingDateKey();
  const [draftFrom, setDraftFrom] = useState(() => shiftDate(today, -29));
  const [draftTo, setDraftTo] = useState(today);
  const [from, setFrom] = useState(() => shiftDate(today, -29));
  const [to, setTo] = useState(today);
  const [data, setData] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dateError, setDateError] = useState("");
  const [query, setQuery] = useState("");
  const [summaryFilter, setSummaryFilter] = useState<SummaryFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("overall");
  const [selected, setSelected] = useState<ProductAuditResult | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const forceRefreshRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ from, to });
    if (forceRefreshRef.current) params.set("refresh", "manual");
    forceRefreshRef.current = false;
    fetch(`/api/wb/audit?${params}`, { headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as AuditData | { error?: string };
        if (!response.ok) throw new Error("error" in body && body.error ? body.error : "商品诊断同步失败");
        return body as AuditData;
      })
      .then(setData)
      .catch((reason: Error) => { if (reason.name !== "AbortError") setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [from, to, reloadKey]);

  useEffect(() => {
    const nextAt = data?.syncSchedule.nextAt;
    if (!nextAt) return;
    const timer = window.setTimeout(() => { setLoading(true); setError(""); setReloadKey((value) => value + 1); }, Math.max(1000, new Date(nextAt).getTime() - Date.now() + 1500));
    return () => window.clearTimeout(timer);
  }, [data?.syncSchedule.nextAt]);

  useEffect(() => {
    if (!selected) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [selected]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const products = (data?.products ?? []).filter((product) => {
      const matchesQuery = !needle || [product.sku, product.title, product.subjectName, String(product.nmId)].some((value) => value.toLocaleLowerCase().includes(needle));
      const matchesPriority = priorityFilter === "all" || product.priority === priorityFilter;
      const matchesSummary = summaryFilter === "all"
        || (summaryFilter === "priority" && (product.priority === "critical" || product.priority === "high"))
        || (summaryFilter === "content" && Math.min(product.scores.image, product.scores.title, product.scores.description, product.scores.attributes) < 60)
        || (summaryFilter === "conversion" && product.funnel.openCount >= 20 && product.scores.funnel < 55)
        || (summaryFilter === "healthy" && product.priority === "healthy");
      return matchesQuery && matchesPriority && matchesSummary;
    });
    const value = (product: ProductAuditResult) => ({ overall: product.scores.overall, image: product.scores.image, title: product.scores.title, description: product.scores.description, attributes: product.scores.attributes, funnel: product.scores.funnel, traffic: product.funnel.openCount, orders: product.funnel.orderCount })[sortKey];
    return products.sort((a, b) => value(a) - value(b));
  }, [data?.products, priorityFilter, query, sortKey, summaryFilter]);

  function choosePeriod(days: number) {
    const nextFrom = shiftDate(today, -(days - 1));
    setLoading(true); setError("");
    setDraftFrom(nextFrom); setDraftTo(today); setFrom(nextFrom); setTo(today); setDateError("");
  }

  function applyPeriod() {
    const days = countDays(draftFrom, draftTo);
    if (!draftFrom || !draftTo || draftFrom > draftTo) return setDateError("开始日期不能晚于结束日期");
    if (days > 90 || draftTo > today) return setDateError("诊断周期最多 90 天，且结束日期不能晚于今天");
    setLoading(true); setError("");
    setDateError(""); setFrom(draftFrom); setTo(draftTo);
  }

  function refresh() {
    forceRefreshRef.current = true;
    setLoading(true); setError("");
    setReloadKey((value) => value + 1);
  }

  function exportCsv() {
    const headers = ["卖家商品编号", "WB商品ID", "商品标题", "综合分", "图片分", "标题分", "描述分", "特征分", "转化分", "进卡", "加购率", "下单", "买断率", "优先级", "首要建议"];
    const rows = filtered.map((product) => [product.sku, product.nmId, product.title, product.scores.overall, product.scores.image, product.scores.title, product.scores.description, product.scores.attributes, product.scores.funnel, product.funnel.openCount, percent(product.funnel.addToCartPercent), product.funnel.orderCount, percent(product.funnel.buyoutPercent), priorityLabel(product.priority), product.recommendations[0] || ""]);
    const csv = "\ufeff" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `WB商品优化诊断-${from}-${to}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  return <main className="app-shell">
    <AppSidebar active="audit" syncedAt={data?.syncedAt} nextSyncAt={data?.syncSchedule.nextAt} loading={loading} error={error} onRefresh={refresh}>
      <div className="nav-section">诊断口径</div>
      <div className="audit-side-summary"><span>当前周期</span><b>{from}</b><i>至</i><b>{to}</b><small>内容＋经营漏斗</small></div>
    </AppSidebar>

    <section className="workspace audit-workspace">
      <header className="topbar audit-topbar"><div><p className="eyebrow">PRODUCT AUDIT · WB 商品内容与经营诊断</p><h1>商品优化诊断</h1><p>用 WB 商品卡和真实经营漏斗找出图片、标题、描述、特征与转化问题，并给出逐项修改顺序。</p></div><div className="avatar">Z</div></header>

      <section className="audit-source-banner">
        <div className="audit-source-mark">✦</div>
        <div><h2>所有经营数字来自 WB API，诊断分数可解释、可追溯</h2><p>评分不影响店铺数据，也不会自动修改商品卡。搜索词接口未开通时不计 0 分；图片审美不伪造机器结论。</p></div>
        <div className="audit-source-chips"><SourceChip connected={Boolean(data?.dataAvailability.productCards)}>商品卡</SourceChip><SourceChip connected={Boolean(data?.dataAvailability.salesFunnel)}>销售漏斗</SourceChip><SourceChip connected={Boolean(data?.dataAvailability.searchQueries)}>搜索词</SourceChip></div>
      </section>

      <section className="audit-period-panel">
        <div><b>分析周期</b><small>经营漏斗与上一同长度周期对比</small></div>
        <div className="audit-period-presets">{[7, 30, 90].map((days) => <button type="button" key={days} className={countDays(from, to) === days ? "active" : ""} onClick={() => choosePeriod(days)}>近 {days} 天</button>)}</div>
        <label><span>开始</span><input type="date" max={draftTo} value={draftFrom} onChange={(event) => { setDraftFrom(event.target.value); setDateError(""); }} /></label>
        <label><span>结束</span><input type="date" min={draftFrom} max={today} value={draftTo} onChange={(event) => { setDraftTo(event.target.value); setDateError(""); }} /></label>
        <button type="button" className="audit-query-button" onClick={applyPeriod}>{loading ? "分析中…" : "开始诊断"}</button>
        {dateError && <p role="alert">{dateError}</p>}
      </section>

      <section className="audit-summary-grid" aria-label="商品诊断汇总">
        <button type="button" className={summaryFilter === "all" ? "active" : ""} onClick={() => setSummaryFilter("all")}><span>已诊断商品</span><b>{data?.summary.products ?? 0}</b><small>平均分 {data?.summary.averageScore ?? 0}</small></button>
        <button type="button" className={`attention ${summaryFilter === "priority" ? "active" : ""}`} onClick={() => setSummaryFilter("priority")}><span>高优先级</span><b>{data?.summary.highPriority ?? 0}</b><small>立即处理 {data?.summary.critical ?? 0}</small></button>
        <button type="button" className={summaryFilter === "content" ? "active" : ""} onClick={() => setSummaryFilter("content")}><span>内容不完整</span><b>{data?.summary.contentIncomplete ?? 0}</b><small>图片/标题/描述/特征</small></button>
        <button type="button" className={summaryFilter === "conversion" ? "active" : ""} onClick={() => setSummaryFilter("conversion")}><span>低转化商品</span><b>{data?.summary.lowConversion ?? 0}</b><small>有流量但漏斗偏弱</small></button>
        <button type="button" className={`healthy ${summaryFilter === "healthy" ? "active" : ""}`} onClick={() => setSummaryFilter("healthy")}><span>表现健康</span><b>{data?.summary.healthy ?? 0}</b><small>结构与转化均稳定</small></button>
      </section>

      <section className="audit-table-panel">
        <div className="audit-table-toolbar">
          <div><h2>商品诊断与优化清单</h2><p>点击“查看完整诊断”，查看原图、字段证据、经营漏斗和修改建议。</p></div>
          <div className="audit-table-actions"><label><span>⌕</span><input type="search" value={query} placeholder="搜索卖家商品编号、标题或 WB ID" onChange={(event) => setQuery(event.target.value)} /></label><select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option value="all">全部优先级</option><option value="critical">立即优化</option><option value="high">优先优化</option><option value="medium">持续优化</option><option value="healthy">表现健康</option></select><select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}><option value="overall">综合分从低到高</option><option value="image">图片分从低到高</option><option value="title">标题分从低到高</option><option value="description">描述分从低到高</option><option value="attributes">特征分从低到高</option><option value="funnel">转化分从低到高</option><option value="traffic">进卡量从低到高</option><option value="orders">订单量从低到高</option></select><button type="button" onClick={exportCsv}>导出 CSV</button></div>
        </div>
        {!data?.dataAvailability.searchQueries && data?.dataAvailability.searchReason && <div className="audit-search-warning"><b>搜索词数据未计入评分</b><span>{data.dataAvailability.searchReason}</span></div>}
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead><tr><th>商品</th><th>综合分</th><th>优化优先级</th><th>图片</th><th>标题</th><th>描述</th><th>特征</th><th>经营转化</th><th>进卡</th><th>加购率</th><th>下单</th><th>买断率</th><th>首要问题</th><th>操作</th></tr></thead>
            <tbody>
              {filtered.map((product) => <tr key={product.nmId}>
                <td><div className="audit-product-cell">{productPhoto(product) ? <img src={productPhoto(product)} alt="" /> : <span>W</span>}<div><b>{product.sku}</b><small>{product.title}</small><em>WB {product.nmId} · {product.subjectName}</em></div></div></td>
                <td><b className={`audit-score-value ${scoreTone(product.scores.overall)}`}>{product.scores.overall}</b></td>
                <td><span className={`audit-priority ${product.priority}`}>{priorityLabel(product.priority)}</span></td>
                {(["image", "title", "description", "attributes", "funnel"] as const).map((key) => <td key={key}><span className={`audit-mini-score ${scoreTone(product.scores[key])}`}>{product.scores[key]}</span></td>)}
                <td><b>{product.funnel.openCount}</b>{product.funnel.openDynamic !== null && <small className={product.funnel.openDynamic >= 0 ? "up" : "down"}>{product.funnel.openDynamic >= 0 ? "+" : ""}{percent(product.funnel.openDynamic)}</small>}</td>
                <td><b>{percent(product.funnel.addToCartPercent)}</b></td>
                <td><b>{product.funnel.orderCount}</b>{product.funnel.orderDynamic !== null && <small className={product.funnel.orderDynamic >= 0 ? "up" : "down"}>{product.funnel.orderDynamic >= 0 ? "+" : ""}{percent(product.funnel.orderDynamic)}</small>}</td>
                <td><b>{percent(product.funnel.buyoutPercent)}</b></td>
                <td><div className="audit-first-issue">{product.issues[0] ? <><span>{areaLabel(product.issues[0].area)}</span><b>{product.issues[0].title}</b><small>{product.issues[0].evidence}</small></> : <b className="healthy">暂无高优先级问题</b>}</div></td>
                <td><button type="button" className="audit-detail-button" onClick={() => setSelected(product)}>查看完整诊断</button></td>
              </tr>)}
              {!loading && filtered.length === 0 && <tr><td colSpan={14} className="audit-empty">没有符合当前筛选条件的商品</td></tr>}
            </tbody>
          </table>
        </div>
        <footer><span>共 {filtered.length} 个商品 · 所有分数均可在详情中查看证据</span><small>WB 商品卡实时字段＋销售漏斗当前周期</small></footer>
      </section>
    </section>
    {selected && <ProductDetail key={selected.nmId} product={selected} onClose={() => setSelected(null)} />}
  </main>;
}
