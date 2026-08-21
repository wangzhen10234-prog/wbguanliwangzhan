"use client";

import Link from "next/link";
import type { ReactNode } from "react";

type Section = "overview" | "sales" | "products" | "stock" | "finance";

type AppSidebarProps = {
  active: Section;
  syncedAt?: string;
  nextSyncAt?: string;
  loading?: boolean;
  error?: string;
  onRefresh: () => void;
  children?: ReactNode;
};

function timeLabel(value?: string) {
  if (!value) return "等待首次读取";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function AppSidebar({ active, syncedAt, nextSyncAt, loading = false, error = "", onRefresh, children }: AppSidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">W</span><div><strong>WB Insight</strong><small>俄罗斯店铺分析</small></div></div>
      <nav aria-label="主导航">
        <Link className={`nav-item ${active === "overview" ? "active" : ""}`} href="/"><span>▦</span>经营总览</Link>
        <Link className={`nav-item ${active === "sales" ? "active" : ""}`} href="/sales"><span>↗</span>销售状况</Link>
        <Link className={`nav-item ${active === "products" ? "active" : ""}`} href="/products"><span>◇</span>综合商品分析</Link>
        <Link className={`nav-item ${active === "stock" ? "active" : ""}`} href="/stock"><span>□</span>库存监控</Link>
        <Link className={`nav-item ${active === "finance" ? "active" : ""}`} href="/finance"><span>₽</span>回款与余额</Link>
      </nav>
      {children}
      <div className="sidebar-foot">
        <div className="sidebar-schedule"><b>北京时间自动同步</b><span>08:00 · 14:00 · 19:00 · 23:00</span><small>下次：{timeLabel(nextSyncAt)}</small></div>
        <div className={`sync-status ${error ? "error" : "connected"}`}><span className="status-dot" /><div><b>{error ? "WB API 同步异常" : "WB API 已安全连接"}</b><small>{error ? "可点击下方手动重试" : `最近读取 ${timeLabel(syncedAt)}`}</small></div></div>
        <button className="connect-btn" disabled={loading} onClick={onRefresh}>{loading ? "正在同步…" : "手动同步 WB 数据"}</button>
      </div>
    </aside>
  );
}
