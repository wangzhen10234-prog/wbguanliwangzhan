"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "../_components/app-sidebar";

type FinanceMovement = {
  id: string;
  reportRowId: string;
  reportId: string;
  date: string;
  operation: string;
  rawOperation: string;
  deductionReason: string;
  isAdvertising: boolean;
  direction: "credit" | "debit" | "neutral";
  orderNumber: string;
  orderUid: string;
  srid: string;
  nmId: number;
  sellerSku: string;
  title: string;
  transactionAmount: number;
  settlementAmount: number;
  platformFees: number;
  additionalPayment: number;
  netChange: number;
  currency: string;
  balanceBefore: number | null;
  balanceAfter: number | null;
  details: {
    financeDate: string; saleDate: string; orderDate: string; documentType: string; operationName: string; deductionReason: string;
    officeName: string; warehouseName: string; barcode: string; stickerId: string; country: string; quantity: number;
    deliveryAmount: number; returnAmount: number; retailAmount: number; retailPriceWithDiscount: number; productDiscountPercent: number;
    sellerPromo: number; spp: number; baseCommissionPercent: number; commissionPercent: number; salesCommission: number; wbReward: number;
    acquiringPercent: number; paymentProcessing: string; acquiringBank: string; shkId: string;
  };
  feeBreakdown: { logistics: number; acquiring: number; penalty: number; deduction: number; storage: number; acceptance: number };
};

type PromotionTrace = {
  available: boolean;
  source: string;
  fetchedAt?: string;
  date: string;
  queriedFrom?: string;
  queriedTo?: string;
  targetAmount: number;
  match?: {
    level: "document_total" | "single_amount" | "period_total" | "multiple_documents" | "multiple_amounts" | "none";
    reason: string; candidateCount: number; candidateTotal: number; candidateCampaignCount: number; matchedDocumentNumber: number;
    periodTotal: number; otherCount: number; otherTotal: number; confidence: "high" | "medium" | "none"; officiallyLinked: false;
  };
  entries: Array<{
    key: string; documentNumber: number; chargedAt: string | null; amount: number; campaignId: number; campaignName: string;
    campaignType: number; paymentType: string; campaignStatus: number; campaignStatusLabel: string; candidate: boolean;
  }>;
  limitation: string;
  error?: string;
};

type FinanceData = {
  syncedAt: string;
  syncSchedule: { nextAt: string };
  dataAvailability: { balance: boolean; financeReport: boolean };
  metrics: { salesAmount: number; ordersCount: number; payoutAmount: number | null; returnsCount: number; returnRate: number; balanceCurrent: number | null; balanceAvailable: number | null };
  accountBalance: { available: boolean; source: string; currency: string; current: number | null; forWithdraw: number | null; rawCurrent: number | null; rawForWithdraw: number | null; unitScale: number; fetchedAt: string | null };
  settlement: { available: boolean; source: string; currency: string; fetchedAt: string | null; rowsCount: number; unallocatedExpenses: number };
  financeMovementSummary: { entries: number; creditEntries: number; debitEntries: number; matchedOrderEntries: number; credits: number; debits: number; netChange: number; currency: string };
  financeBalanceTrace: { available: boolean; mode: string; source: string; anchorBalance: number | null; anchorAt: string | null; calculatedOpeningBalance: number | null; includesWithdrawalsOrUnpublishedChanges: boolean };
  financeMovements: FinanceMovement[];
  trend: Array<{ date: string; sales: number; orders: number }>;
};

type WithdrawalRecord = {
  id: string;
  amount: number;
  currency: string;
  requestedAt: string;
  note: string;
  status: "tracking" | "arrived" | "cancelled";
  baselineCurrent: number | null;
  baselineForWithdraw: number | null;
  balanceChangeObservedAt: string | null;
  completedAt: string | null;
};

type WithdrawalTrackerData = {
  storeId: string;
  balance: { currency: string; current: number | null; forWithdraw: number | null; fetchedAt: string; source: string };
  active: WithdrawalRecord | null;
  history: WithdrawalRecord[];
  monitor: { intervalSeconds: number; balanceChangeObserved: boolean; stage: "idle" | "awaiting_wb_confirmation" | "balance_change_observed" };
  officialCapability: { statusApiAvailable: false; balanceApiAvailable: true; source: string; limitation: string };
};

const MOVEMENT_PAGE_SIZE = 20;

function toInputDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function shiftDate(dateString: string, days: number) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
function money(value: number | null | undefined, currency = "CNY") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("zh-CN", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}
function compact(value: string, start = 10, end = 7) {
  if (!value || value.length <= start + end + 1) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}
function detailTimestamp(value?: string | null) {
  if (!value) return "WB 未返回";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}（WB 日期）`;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return `${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(parsed)}（北京时间）`;
}
function beijingInputTimestamp(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date).replace(" ", "T");
}
function feeBreakdown(movement: FinanceMovement) {
  const labels: Array<[keyof FinanceMovement["feeBreakdown"], string]> = [
    ["logistics", "物流"], ["acquiring", "收款"], ["penalty", "罚款"], ["deduction", "其他扣款"], ["storage", "仓储"], ["acceptance", "入库"],
  ];
  const parts = labels.filter(([key]) => movement.feeBreakdown[key] > 0).map(([key, label]) => `${label} ${movement.feeBreakdown[key].toFixed(2)}`);
  return parts.length ? parts.join("＋") : "无额外费用";
}

export default function FinancePage() {
  const today = toInputDate(new Date());
  const [days, setDays] = useState(30);
  const from = days === 0 ? "2024-01-29" : shiftDate(today, -(days - 1));
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [showMovements, setShowMovements] = useState(false);
  const [movementQuery, setMovementQuery] = useState("");
  const [movementFilter, setMovementFilter] = useState<"all" | "credit" | "debit">("all");
  const [movementPage, setMovementPage] = useState(1);
  const [selectedMovement, setSelectedMovement] = useState<FinanceMovement | null>(null);
  const [promotionTrace, setPromotionTrace] = useState<PromotionTrace | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [showOtherPromotionEntries, setShowOtherPromotionEntries] = useState(false);
  const [showWithdrawalTracker, setShowWithdrawalTracker] = useState(false);
  const [withdrawalData, setWithdrawalData] = useState<WithdrawalTrackerData | null>(null);
  const [withdrawalLoading, setWithdrawalLoading] = useState(false);
  const [withdrawalError, setWithdrawalError] = useState("");
  const [withdrawalAmount, setWithdrawalAmount] = useState("");
  const [withdrawalRequestedAt, setWithdrawalRequestedAt] = useState(() => beijingInputTimestamp());
  const [withdrawalNote, setWithdrawalNote] = useState("");
  const [withdrawalReloadKey, setWithdrawalReloadKey] = useState(0);
  const forceRefreshRef = useRef(false);
  const movementPanelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ from, to: today, view: "finance", includeFinance: "true", includeOrders: "true" });
    if (forceRefreshRef.current) params.set("refresh", "manual");
    forceRefreshRef.current = false;
    fetch(`/api/wb/dashboard?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { const body = await response.json() as FinanceData | { error?: string }; if (!response.ok) throw new Error("error" in body && body.error ? body.error : "财务数据读取失败"); return body as FinanceData; })
      .then((body) => { setData(body); setMovementPage(1); })
      .catch((reason: Error) => { if (reason.name !== "AbortError") setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [from, today, reloadKey]);

  useEffect(() => {
    const nextAt = data?.syncSchedule?.nextAt;
    if (!nextAt) return;
    const timer = window.setTimeout(() => { if (window.localStorage.getItem("wb-last-auto-sync") === nextAt) { window.setTimeout(() => { setLoading(true); setReloadKey((key) => key + 1); }, 12_000); return; } window.localStorage.setItem("wb-last-auto-sync", nextAt); setLoading(true); setReloadKey((key) => key + 1); }, Math.max(1_000, new Date(nextAt).getTime() - Date.now() + 1_500));
    return () => window.clearTimeout(timer);
  }, [data?.syncSchedule?.nextAt]);

  useEffect(() => {
    if (!showMovements) return;
    const frame = window.requestAnimationFrame(() => movementPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [showMovements]);

  useEffect(() => {
    if (!selectedMovement) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedMovement(null); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [selectedMovement]);

  useEffect(() => {
    if (!selectedMovement?.isAdvertising || !selectedMovement.date) return;
    const controller = new AbortController();
    const targetAmount = selectedMovement.feeBreakdown.deduction || Math.abs(selectedMovement.netChange);
    const params = new URLSearchParams({ date: selectedMovement.date, amount: String(targetAmount) });
    fetch(`/api/wb/finance-movement-detail?${params}`, { signal: controller.signal, cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (response) => { const body = await response.json() as PromotionTrace | { error?: string }; if (!response.ok) throw new Error("error" in body && body.error ? body.error : "推广费用明细读取失败"); return body as PromotionTrace; })
      .then(setPromotionTrace)
      .catch((reason: Error) => { if (reason.name !== "AbortError") setPromotionTrace({ available: false, source: "WB Promotion API /adv/v1/upd", date: selectedMovement.date, targetAmount, entries: [], limitation: "推广归属不会根据金额猜测。", error: reason.message }); })
      .finally(() => { if (!controller.signal.aborted) setTraceLoading(false); });
    return () => controller.abort();
  }, [selectedMovement]);

  useEffect(() => {
    if (!data?.accountBalance?.fetchedAt) return;
    const controller = new AbortController();
    setWithdrawalLoading(true);
    fetch("/api/wb/withdrawal-tracker", { signal: controller.signal, cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (response) => {
        const body = await response.json() as WithdrawalTrackerData | { error?: string };
        if (!response.ok) throw new Error("error" in body && body.error ? body.error : "提现进度读取失败");
        return body as WithdrawalTrackerData;
      })
      .then((body) => { setWithdrawalData(body); setWithdrawalError(""); })
      .catch((reason: Error) => { if (reason.name !== "AbortError") setWithdrawalError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setWithdrawalLoading(false); });
    return () => controller.abort();
  }, [data?.accountBalance?.fetchedAt, withdrawalReloadKey]);

  useEffect(() => {
    if (!withdrawalData?.active) return;
    const timer = window.setInterval(() => setWithdrawalReloadKey((key) => key + 1), (withdrawalData.monitor.intervalSeconds || 60) * 1_000);
    return () => window.clearInterval(timer);
  }, [withdrawalData?.active?.id, withdrawalData?.monitor.intervalSeconds]);

  useEffect(() => {
    if (!showWithdrawalTracker || withdrawalData?.active || withdrawalAmount) return;
    const available = withdrawalData?.balance.forWithdraw ?? data?.accountBalance?.forWithdraw;
    if (available !== null && available !== undefined && available > 0) setWithdrawalAmount(available.toFixed(2));
  }, [data?.accountBalance?.forWithdraw, showWithdrawalTracker, withdrawalAmount, withdrawalData?.active, withdrawalData?.balance.forWithdraw]);

  const filteredMovements = useMemo(() => {
    const needle = movementQuery.trim().toLocaleLowerCase();
    return (data?.financeMovements ?? []).filter((movement) => {
      if (movementFilter !== "all" && movement.direction !== movementFilter) return false;
      if (!needle) return true;
      return [movement.orderNumber, movement.orderUid, movement.srid, movement.sellerSku, String(movement.nmId || ""), movement.operation, movement.rawOperation, movement.reportRowId]
        .some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [data?.financeMovements, movementFilter, movementQuery]);
  const movementPageCount = Math.max(1, Math.ceil(filteredMovements.length / MOVEMENT_PAGE_SIZE));
  const visibleMovements = filteredMovements.slice((movementPage - 1) * MOVEMENT_PAGE_SIZE, movementPage * MOVEMENT_PAGE_SIZE);
  const promotionCandidateEntries = promotionTrace?.entries.filter((entry) => entry.candidate) ?? [];
  const promotionOtherEntries = promotionTrace?.entries.filter((entry) => !entry.candidate) ?? [];
  const visiblePromotionEntries = promotionCandidateEntries.length > 0 && !showOtherPromotionEntries ? promotionCandidateEntries : promotionTrace?.entries ?? [];

  const metrics = data?.metrics;
  const balance = data?.accountBalance;
  const settlement = data?.settlement;
  const latestBillDate = (data?.financeMovements ?? []).reduce((latest, movement) => {
    const date = movement.date;
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && date > latest ? date : latest;
  }, "");
  const billDateLabel = !settlement?.available ? "账单暂不可用" : latestBillDate || "本期暂无账单";
  const movementSummary = data?.financeMovementSummary;
  const settlementCurrency = settlement?.currency || balance?.currency || "CNY";
  const financeReady = Boolean(balance?.available && settlement?.available);
  const activeWithdrawal = withdrawalData?.active;
  const withdrawalCurrency = withdrawalData?.balance.currency || balance?.currency || "CNY";
  const withdrawalStageLabel = !activeWithdrawal
    ? "当前没有正在追踪的提现"
    : withdrawalData?.monitor.balanceChangeObserved
      ? "已检测到相近金额的余额变化，等待核对到账"
      : "已记录申请，等待 WB 后台付款状态";
  function refresh() { forceRefreshRef.current = true; setLoading(true); setError(""); setReloadKey((key) => key + 1); }
  function openMovementDetail(movement: FinanceMovement) { setPromotionTrace(null); setShowOtherPromotionEntries(false); setTraceLoading(movement.isAdvertising); setSelectedMovement(movement); }
  async function startWithdrawalTracking() {
    const amount = Number(withdrawalAmount);
    if (!Number.isFinite(amount) || amount <= 0) { setWithdrawalError("请输入正确的提现金额"); return; }
    setWithdrawalLoading(true);
    setWithdrawalError("");
    try {
      const response = await fetch("/api/wb/withdrawal-tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ amount, requestedAt: `${withdrawalRequestedAt}:00+08:00`, note: withdrawalNote }),
      });
      const body = await response.json() as WithdrawalTrackerData | { error?: string };
      if (!response.ok) throw new Error("error" in body && body.error ? body.error : "提现追踪保存失败");
      setWithdrawalData(body as WithdrawalTrackerData);
      setWithdrawalAmount("");
      setWithdrawalNote("");
    } catch (reason) {
      setWithdrawalError(reason instanceof Error ? reason.message : "提现追踪保存失败");
    } finally {
      setWithdrawalLoading(false);
    }
  }
  async function closeWithdrawalTracking(action: "arrived" | "cancel") {
    const confirmed = window.confirm(action === "arrived"
      ? "请确认收款银行账户已经实际到账。确认后，本次提现将标记为“已确认到账”并进入历史记录。"
      : "确认结束本次提现追踪吗？结束后会保留历史记录，但不代表款项已经到账。");
    if (!confirmed) return;
    setWithdrawalLoading(true);
    setWithdrawalError("");
    try {
      const response = await fetch("/api/wb/withdrawal-tracker", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json() as WithdrawalTrackerData | { error?: string };
      if (!response.ok) throw new Error("error" in body && body.error ? body.error : "提现追踪更新失败");
      setWithdrawalData(body as WithdrawalTrackerData);
      setWithdrawalRequestedAt(beijingInputTimestamp());
    } catch (reason) {
      setWithdrawalError(reason instanceof Error ? reason.message : "提现追踪更新失败");
    } finally {
      setWithdrawalLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <AppSidebar active="finance" syncedAt={balance?.fetchedAt || data?.syncedAt} nextSyncAt={data?.syncSchedule?.nextAt} loading={loading} error={error} onRefresh={refresh} />
      <section className="workspace product-workspace">
        <header className="topbar product-topbar"><div><p className="eyebrow">FINANCE · WB 账户与销售结算</p><h1>回款与余额</h1></div><div className="period-presets finance-periods">{[7, 30, 90, 180, 0].map((value) => <button key={value} className={days === value ? "active" : ""} disabled={loading} onClick={() => { setLoading(true); setDays(value); }}>{value ? `近 ${value} 天` : "全部历史"}</button>)}</div></header>
        <div className={`notice ${error ? "error" : financeReady ? "connected" : ""}`}><div className="notice-icon">{loading ? "↻" : error ? "!" : financeReady ? "✓" : "!"}</div><div><strong>{loading ? "正在读取 WB 余额与正式财务明细" : error ? "财务数据同步未完成" : financeReady ? "真实余额与财务结算明细已更新" : "部分财务数据暂时不可用"}</strong><p>{error || `${from} 至 ${today}；余额取自 WB 余额接口，资金明细取自 WB 正式财务结算报告。`}</p></div></div>
        <section className="finance-stat-grid">
          <article className="featured"><span>本期已结算净额</span><strong>{settlement?.available ? money(movementSummary?.netChange ?? metrics?.payoutAmount, settlementCurrency) : "—"}</strong><small>{settlement?.available ? `${movementSummary?.entries ?? 0} 条 WB 正式结算明细` : "未读取到正式财务报告，不使用预估值代替"}</small></article>
          <button type="button" className={`finance-balance-card ${showMovements ? "active" : ""}`} aria-expanded={showMovements} onClick={() => setShowMovements((value) => !value)}><span>账户当前余额</span><strong>{money(balance?.current, balance?.currency || "CNY")}</strong><small>余额读取时间：{detailTimestamp(balance?.fetchedAt)}</small><small>本期账单最新日期：{billDateLabel}</small><small>账单读取时间：{detailTimestamp(settlement?.fetchedAt)}</small><em>{showMovements ? "收起资金明细 ↑" : "点击查看逐笔资金变动 →"}</em></button>
          <button type="button" className={`finance-withdrawal-card ${showWithdrawalTracker ? "active" : ""}`} aria-expanded={showWithdrawalTracker} onClick={() => setShowWithdrawalTracker((value) => !value)}><span>可提现余额</span><strong>{money(withdrawalData?.balance.forWithdraw ?? balance?.forWithdraw, withdrawalCurrency)}</strong><small>{activeWithdrawal ? `正在追踪 ${money(activeWithdrawal.amount, activeWithdrawal.currency)}` : "WB 字段 for_withdraw · 当前可提取金额"}</small><em>{showWithdrawalTracker ? "收起提现进度 ↑" : activeWithdrawal ? "查看正在提现的进度 →" : "记录并追踪本次提现 →"}</em></button>
          <article><span>本期销售额</span><strong>{money(metrics?.salesAmount, "RUB")}</strong><small>{metrics?.ordersCount ?? 0} 笔有效订单 · 销售端货币</small></article>
          <article className={(metrics?.returnsCount ?? 0) > 0 ? "attention" : ""}><span>退货与取消</span><strong>{metrics?.returnsCount ?? 0}</strong><small>比例 {(metrics?.returnRate ?? 0).toFixed(1)}%</small></article>
        </section>

        {showWithdrawalTracker && <section className="withdrawal-monitor-panel" aria-labelledby="withdrawal-monitor-title">
          <header className="withdrawal-monitor-header">
            <div><span>WITHDRAWAL MONITOR · 每 60 秒核对</span><h2 id="withdrawal-monitor-title">提现进度监测</h2><p>自动读取当前店铺的 WB 官方余额变化；付款状态未开放 API 的阶段会明确标为“待 WB 后台确认”。</p></div>
            <div className="withdrawal-monitor-live"><i className={withdrawalLoading ? "loading" : ""} /> <b>{withdrawalLoading ? "正在核对" : "余额实时监测已开启"}</b><small>最近核对：{detailTimestamp(withdrawalData?.balance.fetchedAt)}</small></div>
          </header>

          {withdrawalError && <div className="withdrawal-monitor-error">{withdrawalError}</div>}
          {activeWithdrawal ? <div className="withdrawal-active-layout">
            <div className="withdrawal-active-summary">
              <div className="withdrawal-amount-line"><span>本次正在提现</span><strong>{money(activeWithdrawal.amount, activeWithdrawal.currency)}</strong><em>{withdrawalData?.monitor.balanceChangeObserved ? "余额变化已检测" : "等待状态确认"}</em></div>
              <dl>
                <div><dt>申请时间</dt><dd>{detailTimestamp(activeWithdrawal.requestedAt)}</dd></div>
                <div><dt>记录时账户余额</dt><dd>{money(activeWithdrawal.baselineCurrent, activeWithdrawal.currency)}</dd></div>
                <div><dt>当前账户余额</dt><dd>{money(withdrawalData?.balance.current, withdrawalCurrency)}</dd></div>
                <div><dt>当前可提现余额</dt><dd>{money(withdrawalData?.balance.forWithdraw, withdrawalCurrency)}</dd></div>
              </dl>
              {activeWithdrawal.note && <p className="withdrawal-note">备注：{activeWithdrawal.note}</p>}
              <div className="withdrawal-actions"><a href="https://seller.wildberries.ru/" target="_blank" rel="noreferrer">打开 WB 付款历史</a><button type="button" className="refresh" disabled={withdrawalLoading} onClick={() => setWithdrawalReloadKey((key) => key + 1)}>立即核对余额</button><button type="button" className="cancel" disabled={withdrawalLoading} onClick={() => closeWithdrawalTracking("cancel")}>结束追踪</button><button type="button" className="arrived" disabled={withdrawalLoading} onClick={() => closeWithdrawalTracking("arrived")}>我已确认到账</button></div>
            </div>
            <ol className="withdrawal-timeline">
              <li className="done"><i>✓</i><div><b>已记录提现申请</b><span>{detailTimestamp(activeWithdrawal.requestedAt)}</span></div></li>
              <li className={withdrawalData?.monitor.balanceChangeObserved ? "done" : "active"}><i>{withdrawalData?.monitor.balanceChangeObserved ? "✓" : "2"}</i><div><b>{withdrawalData?.monitor.balanceChangeObserved ? "检测到相近金额的余额下降" : "等待 WB 处理"}</b><span>{withdrawalData?.monitor.balanceChangeObserved ? `${detailTimestamp(activeWithdrawal.balanceChangeObservedAt)}；仅为余额侧证据` : "请在 WB 卖家后台“余额 → 付款历史”核对官方状态"}</span></div></li>
              <li className={withdrawalData?.monitor.balanceChangeObserved ? "active" : "pending"}><i>3</i><div><b>银行入账处理中</b><span>WB 公开 API 不返回银行打款进度，系统不会用余额变化冒充已到账</span></div></li>
              <li className="pending"><i>4</i><div><b>确认到账</b><span>收到银行款项后点击“我已确认到账”，本次记录将进入历史</span></div></li>
            </ol>
          </div> : <div className="withdrawal-empty-layout">
            <div className="withdrawal-start-copy"><span>当前状态</span><h3>{withdrawalStageLabel}</h3><p>在 WB 提交提现后，在这里记录金额和时间。系统将每 60 秒核对官方余额，并把本次记录按店铺独立保存。</p><dl><div><dt>账户余额</dt><dd>{money(withdrawalData?.balance.current ?? balance?.current, withdrawalCurrency)}</dd></div><div><dt>可提现余额</dt><dd>{money(withdrawalData?.balance.forWithdraw ?? balance?.forWithdraw, withdrawalCurrency)}</dd></div></dl></div>
            <div className="withdrawal-start-form"><label><span>本次提现金额</span><div><b>{withdrawalCurrency}</b><input type="number" min="0.01" step="0.01" value={withdrawalAmount} onChange={(event) => setWithdrawalAmount(event.target.value)} /></div></label><label><span>WB 提交时间（北京时间）</span><input type="datetime-local" value={withdrawalRequestedAt} onChange={(event) => setWithdrawalRequestedAt(event.target.value)} /></label><label><span>备注（可选）</span><input type="text" maxLength={200} placeholder="例如：提现到工商银行卡" value={withdrawalNote} onChange={(event) => setWithdrawalNote(event.target.value)} /></label><button type="button" disabled={withdrawalLoading} onClick={startWithdrawalTracking}>{withdrawalLoading ? "正在建立追踪…" : "开始追踪本次提现"}</button></div>
          </div>}

          <div className="withdrawal-capability-note"><b>官方接口能力边界</b><p>{withdrawalData?.officialCapability.limitation || "WB 公开 API 仅返回账户余额与可提现余额；提现付款状态需在 WB 卖家后台的付款历史中确认。"}</p></div>
          {(withdrawalData?.history.length ?? 0) > 0 && <div className="withdrawal-history"><div><h3>最近提现记录</h3><span>按当前店铺独立保存</span></div><div className="withdrawal-history-list">{withdrawalData?.history.slice(0, 5).map((item) => <article key={item.id}><span>{detailTimestamp(item.requestedAt)}</span><b>{money(item.amount, item.currency)}</b><em className={item.status}>{item.status === "arrived" ? "已确认到账" : "已结束追踪"}</em><small>{item.completedAt ? `完成：${detailTimestamp(item.completedAt)}` : "—"}</small></article>)}</div></div>}
        </section>}

        {showMovements && <section ref={movementPanelRef} className="finance-movement-panel">
          <div className="finance-movement-heading"><div><span>WB OFFICIAL FINANCE LEDGER</span><h2>账户资金结算明细</h2><p>每一行对应 WB 正式财务报告的一行；每笔均可查看原始类型、时间、金额组成和可追溯关联。余额与账单分别更新，最新账单日期以已返回记录为准。</p></div><div className="finance-movement-source"><b>本期账单最新日期：{billDateLabel}</b><small>{settlement?.source}<br />账单读取时间：{detailTimestamp(settlement?.fetchedAt)}</small></div></div>
          <div className="finance-movement-summary"><div><span>入账合计</span><b className="movement-credit">+{money(movementSummary?.credits ?? 0, settlementCurrency)}</b><small>{movementSummary?.creditEntries ?? 0} 条</small></div><div><span>扣款合计</span><b className="movement-debit">−{money(movementSummary?.debits ?? 0, settlementCurrency)}</b><small>{movementSummary?.debitEntries ?? 0} 条</small></div><div><span>本期净变动</span><b className={(movementSummary?.netChange ?? 0) >= 0 ? "movement-credit" : "movement-debit"}>{money(movementSummary?.netChange ?? 0, settlementCurrency)}</b><small>{movementSummary?.entries ?? 0} 条 WB 明细</small></div></div>
          <div className="finance-movement-toolbar"><label><span>⌕</span><input type="search" value={movementQuery} placeholder="搜索订单号、SKU、类型或 WB 行号" onChange={(event) => { setMovementQuery(event.target.value); setMovementPage(1); }} /></label><select value={movementFilter} onChange={(event) => { setMovementFilter(event.target.value as "all" | "credit" | "debit"); setMovementPage(1); }}><option value="all">全部资金变动</option><option value="credit">只看入账</option><option value="debit">只看扣款</option></select><button type="button" onClick={() => setShowMovements(false)}>收起明细</button></div>
          <div className="finance-movement-table-wrap">
            <table className="finance-movement-table">
              <thead><tr><th>结算日期</th><th>变动类型</th><th>订单 / 关联号</th><th>SKU</th><th>成交与佣金后结算</th><th>平台费用</th><th>补款</th><th>本笔净变动</th><th>WB 报告行号</th><th>账单余额轨迹<small>由当前余额倒推</small></th><th>详情</th></tr></thead>
              <tbody>
                {visibleMovements.map((movement) => <tr key={movement.id}>
                  <td><b>{movement.date || "—"}</b></td>
                  <td><span className={`movement-kind ${movement.direction}`}>{movement.operation}</span><small title={movement.deductionReason || movement.rawOperation}>{movement.deductionReason || movement.rawOperation || "WB 财务结算"}</small></td>
                  <td><b title={movement.orderNumber || movement.orderUid || movement.srid}>{movement.orderNumber ? `订单 ${movement.orderNumber}` : movement.orderUid ? compact(movement.orderUid) : movement.srid ? compact(movement.srid) : "平台级费用"}</b><small title={movement.orderUid || movement.srid}>{movement.orderUid ? `UID ${compact(movement.orderUid, 8, 6)}` : movement.srid ? `SRID ${compact(movement.srid, 8, 6)}` : "未关联具体订单"}</small></td>
                  <td><b>{movement.sellerSku || (movement.nmId ? String(movement.nmId) : "—")}</b><small>{movement.nmId ? `WB ${movement.nmId}` : "平台级"}</small></td>
                  <td><b>{money(movement.transactionAmount, movement.currency)}</b><small>佣金后 {money(movement.settlementAmount, movement.currency)}</small></td>
                  <td><b className={movement.platformFees > 0 ? "movement-debit" : ""}>{movement.platformFees > 0 ? `−${money(movement.platformFees, movement.currency)}` : money(0, movement.currency)}</b><small>{feeBreakdown(movement)}</small></td>
                  <td><b className={movement.additionalPayment > 0 ? "movement-credit" : movement.additionalPayment < 0 ? "movement-debit" : ""}>{money(movement.additionalPayment, movement.currency)}</b></td>
                  <td><b className={movement.netChange >= 0 ? "movement-credit" : "movement-debit"}>{movement.netChange > 0 ? "+" : ""}{money(movement.netChange, movement.currency)}</b></td>
                  <td><b>{movement.reportRowId || "—"}</b><small>{movement.reportId ? `报告 ${movement.reportId}` : "WB 唯一行号"}</small></td>
                  <td className="movement-balance-trace">{movement.balanceBefore !== null && movement.balanceAfter !== null ? <><b>{money(movement.balanceBefore, movement.currency)} → {money(movement.balanceAfter, movement.currency)}</b><small>账单推算 · 本笔 {movement.netChange >= 0 ? "增加" : "减少"} {money(Math.abs(movement.netChange), movement.currency)}</small></> : <><b>—</b><small>仅支持截至今日的余额轨迹</small></>}</td>
                  <td className="movement-detail-cell"><button type="button" onClick={() => openMovementDetail(movement)}>查看详情</button></td>
                </tr>)}
                {!loading && visibleMovements.length === 0 && <tr className="empty-row"><td colSpan={11}>{settlement?.available ? "没有符合当前筛选条件的财务明细" : "WB 正式财务结算明细暂时无法读取，请稍后手动同步"}</td></tr>}
              </tbody>
            </table>
          </div>
          <footer className="product-table-footer"><span>共 {filteredMovements.length} 条 · 第 {Math.min(movementPage, movementPageCount)} / {movementPageCount} 页</span><div><button onClick={() => setMovementPage((value) => Math.max(1, value - 1))} disabled={movementPage <= 1}>← 上一页</button><button onClick={() => setMovementPage((value) => Math.min(movementPageCount, value + 1))} disabled={movementPage >= movementPageCount}>下一页 →</button></div></footer>
          <p className="finance-ledger-note">准确性说明：每笔净变动来自 WB 正式财务报告并按 WB 行号去重；余额轨迹以实时当前余额为锚点，按结算行号倒推。推广扣款会进一步读取 WB 推广费用 API；由于财务与推广接口没有共同关联键，只显示日期和金额核对出的候选，不会冒充官方唯一归属。</p>
        </section>}

        <section className="product-table-panel">
          <div className="product-table-toolbar"><div><h2>每日销售与订单</h2><p>用于对照销售额变化；真实回款与扣费以上方 WB 正式财务结算明细为准。</p></div></div>
          <div className="product-detail-table-wrap"><table className="finance-detail-table"><thead><tr><th>日期</th><th>销售额</th><th>订单数</th><th>日均单价</th></tr></thead><tbody>{[...(data?.trend ?? [])].reverse().map((item) => <tr key={item.date}><td><b>{item.date}</b></td><td><b>{money(item.sales, "RUB")}</b></td><td><span>{item.orders}</span></td><td><span>{item.orders ? money(item.sales / item.orders, "RUB") : "—"}</span></td></tr>)}{!loading && !data?.trend.length && <tr className="empty-row"><td colSpan={4}>本周期暂无销售记录</td></tr>}</tbody></table></div>
        </section>
      </section>
      {selectedMovement && <div className="finance-detail-backdrop">
        <section className="finance-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="finance-detail-title">
          <header className="finance-detail-header">
            <div><span className={`movement-kind ${selectedMovement.direction}`}>{selectedMovement.operation}</span><h2 id="finance-detail-title">本笔资金变动详情</h2><p>WB 财务行 {selectedMovement.reportRowId || "未返回"} · {selectedMovement.reportId ? `报告 ${selectedMovement.reportId}` : "报告号未返回"}</p></div>
            <div className="finance-detail-header-amount"><small>本笔净变动</small><b className={selectedMovement.netChange >= 0 ? "movement-credit" : "movement-debit"}>{selectedMovement.netChange > 0 ? "+" : ""}{money(selectedMovement.netChange, selectedMovement.currency)}</b></div>
            <button type="button" aria-label="关闭资金详情" onClick={() => setSelectedMovement(null)}>×</button>
          </header>

          <div className="finance-detail-summary">
            <article><span>结算日期</span><b>{detailTimestamp(selectedMovement.details.financeDate || selectedMovement.date)}</b><small>WB 财务报告时间</small></article>
            <article><span>原始操作</span><b>{selectedMovement.details.operationName || selectedMovement.rawOperation || "WB 未返回"}</b><small>{selectedMovement.details.documentType || "单据类型未返回"}</small></article>
            <article><span>扣款/补款原因</span><b>{selectedMovement.details.deductionReason || "WB 未提供附加原因"}</b><small>{selectedMovement.isAdvertising ? "已识别为推广相关费用" : "按财务原始字段展示"}</small></article>
            <article><span>关联对象</span><b>{selectedMovement.orderNumber ? `订单 ${selectedMovement.orderNumber}` : selectedMovement.sellerSku || (selectedMovement.nmId ? `WB ${selectedMovement.nmId}` : "平台级资金变动")}</b><small>{selectedMovement.orderUid || selectedMovement.srid || "没有订单关联字段"}</small></article>
          </div>

          <section className="finance-detail-section">
            <div className="finance-detail-section-title"><div><h3>金额组成与核算</h3><p>净变动严格按本行 WB 财务字段计算，不与其他行混算。</p></div><span>WB FINANCE API</span></div>
            <div className="finance-detail-formula">
              <article><span>佣金后结算</span><b>{money(selectedMovement.settlementAmount, selectedMovement.currency)}</b><small>WB forPay</small></article><i>−</i>
              <article className="cost"><span>平台费用</span><b>{money(selectedMovement.platformFees, selectedMovement.currency)}</b><small>物流、收款、罚款等合计</small></article><i>＋</i>
              <article><span>补款</span><b>{money(selectedMovement.additionalPayment, selectedMovement.currency)}</b><small>WB additionalPayment</small></article><i>＝</i>
              <article className={selectedMovement.netChange >= 0 ? "result credit" : "result debit"}><span>本笔净变动</span><b>{money(selectedMovement.netChange, selectedMovement.currency)}</b><small>页面资金流水采用值</small></article>
            </div>
            <div className="finance-fee-grid">
              {([['logistics', '物流费用'], ['acquiring', '收款手续费'], ['penalty', '平台罚款'], ['deduction', '其他/推广扣款'], ['storage', '仓储费用'], ['acceptance', '入库费用']] as Array<[keyof FinanceMovement['feeBreakdown'], string]>).map(([key, label]) => <div key={key} className={selectedMovement.feeBreakdown[key] > 0 ? "charged" : ""}><span>{label}</span><b>{money(selectedMovement.feeBreakdown[key], selectedMovement.currency)}</b></div>)}
            </div>
          </section>

          <section className="finance-detail-section">
            <div className="finance-detail-section-title"><div><h3>订单、商品与官方时间</h3><p>空白项表示 WB 本行没有返回该字段，不补造数据。</p></div><span>RAW FIELDS</span></div>
            <dl className="finance-official-fields">
              <div><dt>订单时间</dt><dd>{detailTimestamp(selectedMovement.details.orderDate)}</dd></div><div><dt>销售时间</dt><dd>{detailTimestamp(selectedMovement.details.saleDate)}</dd></div>
              <div><dt>订单号</dt><dd>{selectedMovement.orderNumber || "WB 本行未关联数字订单号"}</dd></div><div><dt>订单 UID / SRID</dt><dd>{selectedMovement.orderUid || selectedMovement.srid || "WB 未返回"}</dd></div>
              <div><dt>卖家 SKU</dt><dd>{selectedMovement.sellerSku || "WB 未返回"}</dd></div><div><dt>WB 商品 ID</dt><dd>{selectedMovement.nmId || "WB 未返回"}</dd></div>
              <div><dt>商品名称</dt><dd>{selectedMovement.title || "WB 未返回"}</dd></div><div><dt>数量</dt><dd>{selectedMovement.details.quantity || "WB 未返回"}</dd></div>
              <div><dt>仓库 / 办公点</dt><dd>{selectedMovement.details.warehouseName || selectedMovement.details.officeName || "WB 未返回"}</dd></div><div><dt>条码 / 贴纸</dt><dd>{selectedMovement.details.barcode || selectedMovement.details.stickerId || selectedMovement.details.shkId || "WB 未返回"}</dd></div>
              <div><dt>收款处理</dt><dd>{selectedMovement.details.paymentProcessing || "WB 未返回"}{selectedMovement.details.acquiringBank ? ` · ${selectedMovement.details.acquiringBank}` : ""}</dd></div><div><dt>成交价 / 零售额</dt><dd>{money(selectedMovement.details.retailPriceWithDiscount || selectedMovement.transactionAmount, selectedMovement.currency)} / {money(selectedMovement.details.retailAmount, selectedMovement.currency)}</dd></div>
            </dl>
          </section>

          <section className="finance-detail-section finance-promotion-trace">
            <div className="finance-detail-section-title"><div><h3>推广扣款追溯</h3><p>查询结算日前 31 天的 WB 官方推广费用，按 UPD 单据归组核对活动、时间与合计金额。</p></div><span>WB /adv/v1/upd</span></div>
            {!selectedMovement.isAdvertising ? <div className="finance-trace-empty"><b>本笔不是推广类扣款</b><span>财务原始原因未包含推广或广告标识，因此不调用推广费用接口。</span></div> : traceLoading ? <div className="finance-trace-empty loading"><b>正在读取完整账期推广费用…</b><span>正在按 UPD 单据归组，并与本笔扣款总额逐分核对。</span></div> : !promotionTrace?.available ? <div className="finance-trace-empty error"><b>推广费用明细暂未取得</b><span>{promotionTrace?.error || "WB 推广费用接口暂时没有返回数据"}</span><small>{promotionTrace?.limitation}</small></div> : <>
              <div className={`finance-trace-result ${promotionTrace.match?.confidence === "none" ? "caution" : "candidate"}`}><div><span>{promotionTrace.match?.confidence === "high" ? "高可信账务匹配" : "追溯结果"}</span><b>{promotionTrace.match?.reason}</b><small>目标扣款 {money(promotionTrace.targetAmount, selectedMovement.currency)} · 匹配合计 {money(promotionTrace.match?.candidateTotal ?? 0, selectedMovement.currency)} · 查询 {promotionTrace.queriedFrom} 至 {promotionTrace.queriedTo}</small></div><em>{promotionTrace.match?.candidateCount ? `${promotionTrace.match.candidateCount} 条 · ${promotionTrace.match.candidateCampaignCount} 个活动` : "未定位"}</em></div>
              {promotionCandidateEntries.length > 0 && <div className="finance-trace-period-summary"><div><b>{promotionTrace.match?.matchedDocumentNumber ? `计入 UPD ${promotionTrace.match.matchedDocumentNumber}` : "计入本笔扣款"}</b><span>{promotionCandidateEntries.length} 条费用合计 {money(promotionTrace.match?.candidateTotal ?? 0, selectedMovement.currency)}</span></div>{promotionOtherEntries.length > 0 && <button type="button" onClick={() => setShowOtherPromotionEntries((value) => !value)}>{showOtherPromotionEntries ? "只看计入本笔" : `查看同期其他 ${promotionOtherEntries.length} 条`}</button>}</div>}
              <div className="finance-promotion-table-wrap"><table><thead><tr><th>归属</th><th>扣费时间</th><th>推广活动</th><th>活动 ID</th><th>金额</th><th>支付方式</th><th>UPD 单据</th><th>活动状态</th></tr></thead><tbody>{visiblePromotionEntries.map((entry) => <tr key={entry.key} className={entry.candidate ? "candidate" : ""}><td>{entry.candidate ? <strong>计入本笔</strong> : "同期其他"}</td><td>{detailTimestamp(entry.chargedAt)}</td><td><b>{entry.campaignName}</b></td><td>{entry.campaignId || "WB 未返回"}</td><td><b>{money(entry.amount, selectedMovement.currency)}</b></td><td>{entry.paymentType}</td><td>{entry.documentNumber || "WB 未生成"}</td><td>{entry.campaignStatusLabel}</td></tr>)}{visiblePromotionEntries.length === 0 && <tr><td colSpan={8}>该 31 天账期没有推广费用记录</td></tr>}</tbody></table></div>
              <p className="finance-trace-limitation">{promotionTrace.limitation}</p>
            </>}
          </section>
          <footer className="finance-detail-footer"><span>财务来源：WB /api/finance/v1/sales-reports/detailed</span><button type="button" onClick={() => setSelectedMovement(null)}>关闭详情</button></footer>
        </section>
      </div>}
    </main>
  );
}
