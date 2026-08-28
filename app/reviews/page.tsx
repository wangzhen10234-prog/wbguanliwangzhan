"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "../_components/app-sidebar";
import { analyzeProductReviews, classifyReviewIssues, orderStatusLabel, reviewIssueLabel, type ReviewFeedbackRecord, type ReviewQuestionRecord } from "../_lib/review-analysis";

type ProductRef = { nmId: number; sellerSku: string; name: string; brand: string; category: string; image: string };
type Feedback = ReviewFeedbackRecord & {
  sellerSku: string; productName: string; brand: string; size: string; createdAt: string; pros: string; cons: string; answer: string;
  answerEditable: boolean; viewed: boolean; archived: boolean; photos: string[]; videoPreview: string; videoUrl: string;
};
type Question = ReviewQuestionRecord & {
  sellerSku: string; productName: string; brand: string; createdAt: string; answer: string; answerEditable: boolean;
  answerCreatedAt: string; viewed: boolean; warned: boolean;
};
type ReviewData = {
  source: "WB Feedbacks and Questions API";
  syncedAt: string;
  syncSchedule: { timezone: "Asia/Shanghai"; hours: number[]; currentSlot: string; nextAt: string; mode: "scheduled" | "manual" };
  sellerRating: { available: boolean; valuation: number | null; feedbackCount: number | null };
  products: ProductRef[];
  feedbacks: Feedback[];
  questions: Question[];
  completeness: { feedbackLimitReached: boolean; questionLimitReached: boolean };
  stale: boolean;
  warning: string;
};

type View = "products" | "feedbacks" | "questions";
type Priority = "all" | "high" | "medium" | "stable";
type AnswerFilter = "all" | "answered" | "unanswered";
type Period = 30 | 90 | 180 | "all";

const PAGE_SIZE = 100;
const DAY_MS = 86_400_000;

function dateTime(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function dateOnly(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function percent(value: number | null) {
  return value === null || !Number.isFinite(value) ? "—" : `${value.toFixed(1)}%`;
}

function stars(value: number | null) {
  return value === null || !Number.isFinite(value) ? "暂无评分" : `★ ${value.toFixed(2)}`;
}

function normalize(value: string | number) {
  return String(value).toLocaleLowerCase().replace(/[\s_.-]+/g, "");
}

function productImage(product?: ProductRef) {
  return product?.image || "";
}

function priorityLabel(priority: "high" | "medium" | "stable") {
  if (priority === "high") return "优先处理";
  if (priority === "medium") return "需要优化";
  return "口碑稳定";
}

function feedbackBody(feedback: Feedback) {
  return [feedback.text, feedback.pros ? `优点：${feedback.pros}` : "", feedback.cons ? `不足：${feedback.cons}` : ""].filter(Boolean).join(" · ") || "买家未填写文字评价";
}

function periodContains(value: string, period: Period) {
  if (period === "all") return true;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp >= Date.now() - period * DAY_MS;
}

function average(records: Feedback[]) {
  const valid = records.filter((record) => record.rating >= 1 && record.rating <= 5);
  return valid.length ? valid.reduce((sum, record) => sum + record.rating, 0) / valid.length : null;
}

function replyTemplate(product: ProductRef | undefined) {
  return `Здравствуйте! Спасибо за обратную связь. Нам жаль, что товар не оправдал ожиданий. Мы проверим эту ситуацию по товару ${product?.sellerSku || ""}. Пожалуйста, свяжитесь с нами через чат покупателя и уточните детали заказа — постараемся помочь.`;
}

export default function ReviewsPage() {
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [view, setView] = useState<View>("products");
  const [period, setPeriod] = useState<Period>(90);
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState<Priority>("all");
  const [answerFilter, setAnswerFilter] = useState<AnswerFilter>("all");
  const [ratingFilter, setRatingFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const forceRefreshRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (forceRefreshRef.current) params.set("refresh", "manual");
    forceRefreshRef.current = false;
    fetch(`/api/wb/reviews?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as ReviewData | { error?: string };
        if (!response.ok) throw new Error("error" in body && body.error ? body.error : "评价与提问同步失败");
        return body as ReviewData;
      })
      .then((body) => { setData(body); setError(""); })
      .catch((reason: Error) => { if (reason.name !== "AbortError") setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reloadKey]);

  useEffect(() => {
    const nextAt = data?.syncSchedule.nextAt;
    if (!nextAt) return;
    const timer = window.setTimeout(() => { setLoading(true); setReloadKey((value) => value + 1); }, Math.max(1000, new Date(nextAt).getTime() - Date.now() + 1500));
    return () => window.clearTimeout(timer);
  }, [data?.syncSchedule.nextAt]);

  useEffect(() => {
    if (selectedProductId === null) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedProductId(null); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedProductId]);

  const productById = useMemo(() => new Map((data?.products ?? []).map((product) => [product.nmId, product])), [data?.products]);
  const periodFeedbacks = useMemo(() => (data?.feedbacks ?? []).filter((feedback) => periodContains(feedback.createdAt, period)), [data?.feedbacks, period]);
  const periodQuestions = useMemo(() => (data?.questions ?? []).filter((question) => periodContains(question.createdAt, period)), [data?.questions, period]);
  const productRows = useMemo(() => (data?.products ?? []).map((product) => {
    const feedbacks = periodFeedbacks.filter((feedback) => feedback.nmId === product.nmId);
    const questions = periodQuestions.filter((question) => question.nmId === product.nmId);
    const analysis = analyzeProductReviews(feedbacks, questions);
    const currentThirty = (data?.feedbacks ?? []).filter((feedback) => feedback.nmId === product.nmId && new Date(feedback.createdAt).getTime() >= Date.now() - 30 * DAY_MS);
    const previousThirty = (data?.feedbacks ?? []).filter((feedback) => {
      const time = new Date(feedback.createdAt).getTime();
      return feedback.nmId === product.nmId && time < Date.now() - 30 * DAY_MS && time >= Date.now() - 60 * DAY_MS;
    });
    const currentAverage = average(currentThirty);
    const previousAverage = average(previousThirty);
    const trend = currentAverage !== null && previousAverage !== null ? currentAverage - previousAverage : null;
    return { product, feedbacks, questions, analysis, trend };
  }), [data?.feedbacks, data?.products, periodFeedbacks, periodQuestions]);

  const summary = useMemo(() => ({
    reviews: periodFeedbacks.length,
    low: periodFeedbacks.filter((feedback) => feedback.rating <= 3).length,
    unansweredReviews: periodFeedbacks.filter((feedback) => !feedback.answered).length,
    unansweredQuestions: periodQuestions.filter((question) => !question.answered).length,
    urgentProducts: productRows.filter((row) => row.analysis.priority === "high").length,
  }), [periodFeedbacks, periodQuestions, productRows]);

  const filteredProducts = useMemo(() => {
    const needle = normalize(query);
    return productRows.filter((row) => {
      const matchesQuery = !needle || [row.product.sellerSku, row.product.name, row.product.brand, row.product.category, row.product.nmId].some((value) => normalize(value).includes(needle));
      return matchesQuery && (priority === "all" || row.analysis.priority === priority);
    }).sort((a, b) => {
      const order = { high: 0, medium: 1, stable: 2 };
      return order[a.analysis.priority] - order[b.analysis.priority] || b.analysis.low - a.analysis.low || b.analysis.total - a.analysis.total;
    });
  }, [priority, productRows, query]);

  const filteredFeedbacks = useMemo(() => {
    const needle = normalize(query);
    return periodFeedbacks.filter((feedback) => {
      const matchesQuery = !needle || [feedback.sellerSku, feedback.productName, feedback.brand, feedback.nmId, feedback.text, feedback.pros, feedback.cons].some((value) => normalize(value).includes(needle));
      const matchesRating = ratingFilter === "all" || ratingFilter === "low" && feedback.rating <= 3 || String(feedback.rating) === ratingFilter;
      const matchesAnswer = answerFilter === "all" || answerFilter === "answered" && feedback.answered || answerFilter === "unanswered" && !feedback.answered;
      return matchesQuery && matchesRating && matchesAnswer;
    });
  }, [answerFilter, periodFeedbacks, query, ratingFilter]);

  const filteredQuestions = useMemo(() => {
    const needle = normalize(query);
    return periodQuestions.filter((question) => {
      const matchesQuery = !needle || [question.sellerSku, question.productName, question.brand, question.nmId, question.text].some((value) => normalize(value).includes(needle));
      const matchesAnswer = answerFilter === "all" || answerFilter === "answered" && question.answered || answerFilter === "unanswered" && !question.answered;
      return matchesQuery && matchesAnswer;
    }).sort((a, b) => Number(a.answered) - Number(b.answered) || b.createdAt.localeCompare(a.createdAt));
  }, [answerFilter, periodQuestions, query]);

  const activeRows = view === "products" ? filteredProducts : view === "feedbacks" ? filteredFeedbacks : filteredQuestions;
  const totalPages = Math.max(1, Math.ceil(activeRows.length / PAGE_SIZE));
  const visibleProducts = filteredProducts.slice((Math.min(page, totalPages) - 1) * PAGE_SIZE, Math.min(page, totalPages) * PAGE_SIZE);
  const visibleFeedbacks = filteredFeedbacks.slice((Math.min(page, totalPages) - 1) * PAGE_SIZE, Math.min(page, totalPages) * PAGE_SIZE);
  const visibleQuestions = filteredQuestions.slice((Math.min(page, totalPages) - 1) * PAGE_SIZE, Math.min(page, totalPages) * PAGE_SIZE);
  const selectedRow = productRows.find((row) => row.product.nmId === selectedProductId) ?? null;

  function selectView(next: View, answer: AnswerFilter = "all", rating = "all") {
    setView(next);
    setAnswerFilter(answer);
    setRatingFilter(rating);
    setPage(1);
  }

  function refresh() {
    forceRefreshRef.current = true;
    setLoading(true);
    setError("");
    setReloadKey((value) => value + 1);
  }

  async function copyReply() {
    if (!selectedRow) return;
    await navigator.clipboard.writeText(replyTemplate(selectedRow.product));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return <main className="app-shell">
    <AppSidebar active="reviews" syncedAt={data?.syncedAt} nextSyncAt={data?.syncSchedule.nextAt} loading={loading} error={error} onRefresh={refresh} />
    <section className="workspace review-workspace">
      <header className="topbar"><div><p className="eyebrow">CUSTOMER VOICE · WB 评价与提问</p><h1>评价与提问</h1></div><div className="avatar">Z</div></header>

      <section className="review-source-banner">
        <span>★</span><div><h2>评价、星级与买家提问均来自 WB 官方 API</h2><p>紫色数据为平台原始记录；“问题分类”和“修改建议”由系统按低星文字、退货关联和未回复数量分析，不冒充 WB 官方结论。</p></div><small>{data?.syncedAt ? `最近读取 ${dateTime(data.syncedAt)}` : "等待首次读取"}</small>
      </section>
      {(data?.warning || error) && <div className="review-warning" role="alert">{error || data?.warning}</div>}

      <section className="review-period-panel">
        <div><b>分析周期</b><small>星级、问题和建议随周期重新计算</small></div>
        <div>{([30, 90, 180, "all"] as Period[]).map((item) => <button type="button" key={item} className={period === item ? "active" : ""} onClick={() => { setPeriod(item); setPage(1); }}>{item === "all" ? "全部历史" : `近 ${item} 天`}</button>)}</div>
        <small>{data?.completeness.feedbackLimitReached || data?.completeness.questionLimitReached ? "部分明细达到 WB 返回上限，页面未隐藏这一限制" : "当前明细未触及 WB 返回上限"}</small>
      </section>

      <section className="review-stat-grid" aria-label="评价与提问汇总">
        <button type="button" onClick={() => selectView("products")}><span>WB 店铺官方评分</span><b className="rating">{data?.sellerRating.valuation ? `★ ${data.sellerRating.valuation.toFixed(2)}` : "—"}</b><small>{data?.sellerRating.feedbackCount === null || data?.sellerRating.feedbackCount === undefined ? "官方评价总数待返回" : `${data.sellerRating.feedbackCount.toLocaleString("zh-CN")} 条官方累计评价`}</small></button>
        <button type="button" onClick={() => selectView("feedbacks")}><span>周期评价明细</span><b>{summary.reviews}</b><small>点击查看每条评价</small></button>
        <button type="button" className="bad" onClick={() => selectView("feedbacks", "all", "low")}><span>一至三星评价</span><b>{summary.low}</b><small>需要定位原因</small></button>
        <button type="button" className="warn" onClick={() => selectView("feedbacks", "unanswered")}><span>未回复评价</span><b>{summary.unansweredReviews}</b><small>点击直接处理</small></button>
        <button type="button" className="warn" onClick={() => selectView("questions", "unanswered")}><span>未回答提问</span><b>{summary.unansweredQuestions}</b><small>购买决策问题优先</small></button>
        <button type="button" className="bad" onClick={() => { setView("products"); setPriority("high"); setPage(1); }}><span>优先处理商品</span><b>{summary.urgentProducts}</b><small>低星或未回答问题</small></button>
      </section>

      <section className="review-panel">
        <header className="review-panel-header">
          <div><h2>{view === "products" ? "商品评价诊断" : view === "feedbacks" ? "买家评价明细" : "买家提问明细"}</h2><p>{view === "products" ? "查看每个商品的星级分布、低星原因、回复率和可执行修改建议。" : view === "feedbacks" ? "低星、退货关联和未回复评价优先显示处理线索。" : "未回答提问置顶；重复问题建议同步到俄语商品详情 FAQ。"}</p></div>
          <div className="review-tabs"><button type="button" className={view === "products" ? "active" : ""} onClick={() => selectView("products")}>商品诊断</button><button type="button" className={view === "feedbacks" ? "active" : ""} onClick={() => selectView("feedbacks")}>评价明细</button><button type="button" className={view === "questions" ? "active" : ""} onClick={() => selectView("questions")}>提问明细</button></div>
        </header>
        <div className="review-toolbar">
          <label><span>⌕</span><input type="search" value={query} placeholder="搜索 SKU、商品、WB ID 或评价文字" onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label>
          {view === "products" && <select value={priority} onChange={(event) => { setPriority(event.target.value as Priority); setPage(1); }}><option value="all">全部处理级别</option><option value="high">优先处理</option><option value="medium">需要优化</option><option value="stable">口碑稳定</option></select>}
          {view === "feedbacks" && <select value={ratingFilter} onChange={(event) => { setRatingFilter(event.target.value); setPage(1); }}><option value="all">全部星级</option><option value="low">一至三星</option><option value="1">1 星</option><option value="2">2 星</option><option value="3">3 星</option><option value="4">4 星</option><option value="5">5 星</option></select>}
          {view !== "products" && <select value={answerFilter} onChange={(event) => { setAnswerFilter(event.target.value as AnswerFilter); setPage(1); }}><option value="all">全部回复状态</option><option value="unanswered">未回复</option><option value="answered">已回复</option></select>}
        </div>

        {view === "products" && <div className="review-table-wrap"><table className="review-product-table"><thead><tr><th>商品</th><th>评价数</th><th>平均星级</th><th>五星分布</th><th>好评率</th><th>低星评价</th><th>关联退货/拒收</th><th>提问</th><th>回复率</th><th>近30天趋势</th><th>主要问题</th><th>建议</th></tr></thead><tbody>{visibleProducts.map((row) => <tr key={row.product.nmId}>
          <td><div className="review-product-cell">{row.product.image ? <img src={row.product.image} alt="" referrerPolicy="no-referrer" /> : <span>W</span>}<div><b>{row.product.sellerSku}</b><small>{row.product.name}</small><em>WB {row.product.nmId} · {row.product.category}</em></div></div></td>
          <td><b>{row.analysis.total}</b><small>周期有效星级</small></td>
          <td><b className={row.analysis.averageRating !== null && row.analysis.averageRating < 4 ? "value-bad" : "review-rating-value"}>{stars(row.analysis.averageRating)}</b><small>WB 评价明细计算</small></td>
          <td><div className="review-star-mini"><span>5★ {row.analysis.starCounts[5]}</span><span>4★ {row.analysis.starCounts[4]}</span><span>3★ {row.analysis.starCounts[3]}</span><span>2★ {row.analysis.starCounts[2]}</span><span>1★ {row.analysis.starCounts[1]}</span></div></td>
          <td><b className={(row.analysis.positiveRate ?? 100) < 80 ? "value-bad" : "value-good"}>{percent(row.analysis.positiveRate)}</b><small>四至五星占比</small></td>
          <td><b className={row.analysis.low ? "value-bad" : ""}>{row.analysis.low}</b><small>其中一至二星 {row.analysis.critical}</small></td>
          <td><b className={row.analysis.returnedFeedbacks ? "value-bad" : ""}>{row.analysis.returnedFeedbacks}</b><small>WB orderStatus</small></td>
          <td><b>{row.analysis.questions}</b><small className={row.analysis.unansweredQuestions ? "value-bad" : ""}>未回答 {row.analysis.unansweredQuestions}</small></td>
          <td><b>{percent(row.analysis.responseRate)}</b><small>评价＋提问</small></td>
          <td><b className={row.trend === null ? "" : row.trend < 0 ? "value-bad" : "value-good"}>{row.trend === null ? "样本不足" : `${row.trend >= 0 ? "+" : ""}${row.trend.toFixed(2)} 星`}</b><small>近30天 vs 前30天</small></td>
          <td><div className="review-issue-pills">{row.analysis.issues.slice(0, 2).map((issue) => <span key={issue.key}>{issue.label} {issue.count}</span>)}{!row.analysis.issues.length && <small>暂无集中问题</small>}</div></td>
          <td><button type="button" className={`review-detail-button ${row.analysis.priority}`} onClick={() => setSelectedProductId(row.product.nmId)}>{priorityLabel(row.analysis.priority)}</button><small>点击查看修改建议</small></td>
        </tr>)}{!loading && !visibleProducts.length && <tr><td className="review-empty" colSpan={12}>没有符合条件的商品</td></tr>}</tbody></table></div>}

        {view === "feedbacks" && <div className="review-table-wrap"><table className="review-feedback-table"><thead><tr><th>评价时间</th><th>商品</th><th>星级</th><th>买家评价</th><th>订单状态</th><th>问题线索</th><th>回复状态</th><th>卖家回复</th><th>处理</th></tr></thead><tbody>{visibleFeedbacks.map((feedback) => {
          const product = productById.get(feedback.nmId);
          const issues = classifyReviewIssues(feedbackBody(feedback));
          return <tr key={feedback.id}><td><b>{dateOnly(feedback.createdAt)}</b><small>{feedback.archived ? "归档评价" : "活跃评价"}</small></td><td><div className="review-product-cell compact">{productImage(product) ? <img src={productImage(product)} alt="" referrerPolicy="no-referrer" /> : <span>W</span>}<div><b>{feedback.sellerSku}</b><small>{feedback.productName}</small><em>WB {feedback.nmId} · 规格 {feedback.size}</em></div></div></td><td><b className={feedback.rating <= 3 ? "value-bad" : "review-rating-value"}>{feedback.rating} ★</b><small>{feedback.photos.length || feedback.videoUrl ? `${feedback.photos.length} 图${feedback.videoUrl ? " · 有视频" : ""}` : "无媒体"}</small></td><td><p className="review-copy">{feedbackBody(feedback)}</p></td><td><span className={`review-order-status ${feedback.orderStatus}`}>{orderStatusLabel(feedback.orderStatus)}</span></td><td><div className="review-issue-pills">{issues.slice(0, 3).map((issue) => <span key={issue}>{reviewIssueLabel(issue)}</span>)}{!issues.length && <small>未命中规则</small>}</div></td><td><span className={`review-answer-status ${feedback.answered ? "answered" : "unanswered"}`}>{feedback.answered ? "已回复" : "未回复"}</span><small>{feedback.viewed ? "已查看" : "未查看"}</small></td><td><p className="review-copy answer">{feedback.answer || "—"}</p></td><td><button type="button" className="review-detail-button" onClick={() => setSelectedProductId(feedback.nmId)}>查看建议</button></td></tr>;
        })}{!loading && !visibleFeedbacks.length && <tr><td className="review-empty" colSpan={9}>没有符合条件的评价</td></tr>}</tbody></table></div>}

        {view === "questions" && <div className="review-table-wrap"><table className="review-question-table"><thead><tr><th>提问时间</th><th>商品</th><th>买家提问</th><th>状态</th><th>卖家回答</th><th>回答时间</th><th>处理</th></tr></thead><tbody>{visibleQuestions.map((question) => {
          const product = productById.get(question.nmId);
          return <tr key={question.id}><td><b>{dateTime(question.createdAt)}</b><small>{question.viewed ? "已查看" : "未查看"}</small></td><td><div className="review-product-cell compact">{productImage(product) ? <img src={productImage(product)} alt="" referrerPolicy="no-referrer" /> : <span>W</span>}<div><b>{question.sellerSku}</b><small>{question.productName}</small><em>WB {question.nmId}</em></div></div></td><td><p className="review-question-copy">{question.text || "—"}</p></td><td><span className={`review-answer-status ${question.answered ? "answered" : "unanswered"}`}>{question.answered ? "已回答" : "未回答"}</span>{question.warned && <small className="value-bad">WB 已警告</small>}</td><td><p className="review-copy answer">{question.answer || "—"}</p></td><td><b>{dateTime(question.answerCreatedAt)}</b><small>{question.answerEditable ? "允许编辑" : "不可编辑/未回答"}</small></td><td><button type="button" className="review-detail-button" onClick={() => setSelectedProductId(question.nmId)}>查看建议</button></td></tr>;
        })}{!loading && !visibleQuestions.length && <tr><td className="review-empty" colSpan={7}>没有符合条件的提问</td></tr>}</tbody></table></div>}

        <footer><span>共 {activeRows.length} 条 · 每页最多 {PAGE_SIZE} 条</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>← 上一页</button><b>{Math.min(page, totalPages)} / {totalPages}</b><button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页 →</button></div></footer>
      </section>

      {selectedRow && <div className="review-drawer-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedProductId(null); }}><aside className="review-drawer" role="dialog" aria-modal="true" aria-label={`${selectedRow.product.sellerSku} 评价诊断`}>
        <header><div className="review-drawer-product">{selectedRow.product.image ? <img src={selectedRow.product.image} alt="" referrerPolicy="no-referrer" /> : <span>W</span>}<div><small>WB {selectedRow.product.nmId}</small><h2>{selectedRow.product.sellerSku}</h2><p>{selectedRow.product.name}</p></div></div><button type="button" aria-label="关闭" onClick={() => setSelectedProductId(null)}>×</button></header>
        <section className="review-drawer-summary"><article><span>平均星级</span><b>{stars(selectedRow.analysis.averageRating)}</b><small>{selectedRow.analysis.total} 条评价</small></article><article><span>好评率</span><b>{percent(selectedRow.analysis.positiveRate)}</b><small>四至五星</small></article><article><span>低星</span><b className="value-bad">{selectedRow.analysis.low}</b><small>一至三星</small></article><article><span>回复率</span><b>{percent(selectedRow.analysis.responseRate)}</b><small>评价＋提问</small></article><article><span>未回答提问</span><b className={selectedRow.analysis.unansweredQuestions ? "value-bad" : ""}>{selectedRow.analysis.unansweredQuestions}</b><small>应优先处理</small></article><article><span>退货/拒收评价</span><b className={selectedRow.analysis.returnedFeedbacks ? "value-bad" : ""}>{selectedRow.analysis.returnedFeedbacks}</b><small>订单状态关联</small></article></section>
        <section className="review-drawer-section"><div className="review-section-heading"><div><span>01</span><h3>星级分布</h3></div><small>WB productValuation</small></div><div className="review-star-bars">{([5, 4, 3, 2, 1] as const).map((star) => <div key={star}><b>{star} 星</b><i><em style={{ width: `${selectedRow.analysis.total ? selectedRow.analysis.starCounts[star] / selectedRow.analysis.total * 100 : 0}%` }} /></i><span>{selectedRow.analysis.starCounts[star]}</span></div>)}</div></section>
        <section className="review-drawer-section"><div className="review-section-heading"><div><span>02</span><h3>主要问题与修改建议</h3></div><small>系统规则分析 · 非 WB 官方评分</small></div><div className="review-recommendations">{selectedRow.analysis.recommendations.map((recommendation, index) => <article className={recommendation.level} key={`${recommendation.title}-${index}`}><span>{recommendation.level === "high" ? "优先" : recommendation.level === "medium" ? "优化" : "观察"}</span><div><h4>{recommendation.title}</h4><p>{recommendation.detail}</p></div></article>)}</div></section>
        <section className="review-drawer-section"><div className="review-section-heading"><div><span>03</span><h3>低星评价证据</h3></div><small>最多显示最近 20 条</small></div><div className="review-evidence-list">{selectedRow.feedbacks.filter((feedback) => feedback.rating <= 3).slice(0, 20).map((feedback) => <article key={feedback.id}><div><b className="value-bad">{feedback.rating} ★</b><small>{dateOnly(feedback.createdAt)} · {orderStatusLabel(feedback.orderStatus)}</small></div><p>{feedbackBody(feedback)}</p><em>{feedback.answered ? `已回复：${feedback.answer}` : "尚未回复"}</em></article>)}{!selectedRow.feedbacks.some((feedback) => feedback.rating <= 3) && <p className="review-no-evidence">当前周期没有一至三星评价。</p>}</div></section>
        <section className="review-drawer-section"><div className="review-section-heading"><div><span>04</span><h3>买家提问</h3></div><small>未回答优先</small></div><div className="review-evidence-list questions">{[...selectedRow.questions].sort((a, b) => Number(a.answered) - Number(b.answered)).slice(0, 20).map((question) => <article key={question.id}><div><b>{question.answered ? "已回答" : "未回答"}</b><small>{dateOnly(question.createdAt)}</small></div><p>{question.text}</p><em>{question.answer || "请核实商品参数后回复；不要直接发送未经确认的数据。"}</em></article>)}{!selectedRow.questions.length && <p className="review-no-evidence">当前周期没有买家提问。</p>}</div></section>
        <section className="review-drawer-section"><div className="review-section-heading"><div><span>05</span><h3>俄语低星回复模板</h3></div><small>发送前必须按实际情况修改</small></div><p className="review-reply-template">{replyTemplate(selectedRow.product)}</p><button type="button" className="review-copy-button" onClick={copyReply}>{copied ? "已复制" : "复制回复模板"}</button><p className="review-honesty-note">模板只用于加快起草。商品参数、补偿、退换货承诺必须人工确认后再通过 WB 后台发送。</p></section>
      </aside></div>}
    </section>
  </main>;
}
