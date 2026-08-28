"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { DEFAULT_STOREFRONT_ID, STOREFRONTS, STOREFRONT_STORAGE_KEY, storefrontById } from "../_lib/storefronts";

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

const STOREFRONT_CHANGE_EVENT = "wb-insight-store-change";

function subscribeStorefront(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(STOREFRONT_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(STOREFRONT_CHANGE_EVENT, onChange);
  };
}

function storedStorefrontId() {
  return storefrontById(window.localStorage.getItem(STOREFRONT_STORAGE_KEY)).id;
}

function StoreSwitcher() {
  const activeStoreId = useSyncExternalStore(subscribeStorefront, storedStorefrontId, () => DEFAULT_STOREFRONT_ID);
  const [open, setOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  const activeStore = storefrontById(activeStoreId);
  const connectedCount = STOREFRONTS.filter((store) => store.enabled && store.connected).length;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!switcherRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function selectStore(storeId: string) {
    const nextStore = storefrontById(storeId);
    if (!nextStore.enabled || nextStore.id === activeStoreId) {
      setOpen(false);
      return;
    }
    window.localStorage.setItem(STOREFRONT_STORAGE_KEY, nextStore.id);
    window.dispatchEvent(new Event(STOREFRONT_CHANGE_EVENT));
    setOpen(false);
    window.location.reload();
  }

  return <div className={`store-switcher ${open ? "open" : ""}`} ref={switcherRef}>
    <button type="button" className="store-switcher-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span className="store-avatar" aria-hidden="true">{activeStore.badge}</span>
      <span className="store-switcher-copy"><small>店铺切换</small><b>{activeStore.name}</b><em>{activeStore.description}</em></span>
      <span className="store-switcher-chevron" aria-hidden="true">⌄</span>
    </button>
    <div className="store-switcher-menu" role="listbox" aria-label="选择 WB 店铺" hidden={!open}>
      <div className="store-switcher-menu-head"><b>我的 WB 店铺</b><span>{connectedCount} 家已连接</span></div>
      {STOREFRONTS.map((store) => <button
        type="button"
        role="option"
        aria-selected={store.id === activeStore.id}
        className={`${store.id === activeStore.id ? "selected" : ""} ${store.enabled ? "" : "pending"}`}
        disabled={!store.enabled}
        key={store.id}
        onClick={() => selectStore(store.id)}
      >
        <span className="store-option-avatar" aria-hidden="true">{store.badge}</span>
        <span><b>{store.name}</b><small>{store.description}</small></span>
        <i aria-hidden="true">{store.id === activeStore.id ? "✓" : store.enabled ? "" : "待接入"}</i>
      </button>)}
      <p>新增店铺后，订单、商品、库存和财务数据将按店铺独立管理。</p>
    </div>
  </div>;
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
      <StoreSwitcher />
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
