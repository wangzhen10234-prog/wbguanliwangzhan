"use client";

import type { ReactNode } from "react";

type Section = "overview" | "audit" | "sales" | "returns" | "products" | "details" | "stock" | "finance" | "advertising" | "promotions";

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
  const navigation: Array<{ section: Section; href: string; label: string; icon: string }> = [
    { section: "overview", href: "/", label: "经营总览", icon: "▦" },
    { section: "audit", href: "/audit", label: "商品优化诊断", icon: "✦" },
    { section: "sales", href: "/sales", label: "销售状况", icon: "↗" },
    { section: "products", href: "/products", label: "综合商品分析", icon: "◇" },
    { section: "details", href: "/details", label: "产品详情", icon: "▤" },
    { section: "stock", href: "/stock", label: "库存监控", icon: "▥" },
    { section: "returns", href: "/returns", label: "退货", icon: "↩" },
    { section: "finance", href: "/finance", label: "回款与余额", icon: "₽" },
    { section: "promotions", href: "/promotions", label: "平台活动评估", icon: "%" },
    { section: "advertising", href: "/advertising", label: "推广", icon: "◉" },
  ];

  return (
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">W</span><div><strong>WB Insight</strong><small>俄罗斯店铺分析</small></div></div>
      <div className="sidebar-scroll-area">
        <nav aria-label="主导航">
          {navigation.map((item) => <a key={item.section} className={`nav-item ${active === item.section ? "active" : ""}`} href={item.href}><span className={`nav-icon ${item.section}`} aria-hidden="true">{item.icon}</span>{item.label}</a>)}
        </nav>
        {children}
      </div>
      <div className="sidebar-foot">
        <div className="sidebar-schedule"><b>北京时间自动同步</b><span>08:00 · 14:00 · 19:00 · 23:00</span><small>下次：{timeLabel(nextSyncAt)}</small></div>
        <div className={`sync-status ${error ? "error" : "connected"}`}><span className="status-dot" /><div><b>{error ? "WB API 同步异常" : "WB API 已安全连接"}</b><small>{error ? "可点击下方手动重试" : `最近读取 ${timeLabel(syncedAt)}`}</small></div></div>
        <button className="connect-btn" disabled={loading} onClick={onRefresh}>{loading ? "正在同步…" : "手动同步 WB 数据"}</button>
      </div>
    </aside>
  );
}
