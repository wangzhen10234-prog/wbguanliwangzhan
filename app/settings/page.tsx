"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppSidebar } from "../_components/app-sidebar";

type SessionInfo = { username: string; updatedAt?: string; mustChangePassword?: boolean };
type LoginRecord = {
  id: string;
  loggedInAt: string;
  username: string;
  ip: string;
  location: string;
  timezone: string;
  edge: string;
  device: string;
  browser: string;
  operatingSystem: string;
  current?: boolean;
};
type StoreInfo = {
  id: string;
  name: string;
  badge: string;
  description: string;
  builtin: boolean;
  connected: boolean;
  tokenHint: string;
  tokenExpiresAt: string | null;
  tokenType: string | null;
  sellerId: string;
  permissions: string[];
  status: "active" | "expiring" | "expired" | "not_configured";
  daysRemaining: number | null;
  updatedAt: string | null;
};
type StoreEditor = { id: string; name: string; apiToken: string; mode: "new" | "edit" };

function beijingTime(value?: string) {
  if (!value) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export default function SettingsPage() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [records, setRecords] = useState<LoginRecord[]>([]);
  const [newUsername, setNewUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [activePanel, setActivePanel] = useState<"credentials" | "devices" | "api">("credentials");
  const [stores, setStores] = useState<StoreInfo[]>([]);
  const [storeEditor, setStoreEditor] = useState<StoreEditor | null>(null);
  const [storeLoading, setStoreLoading] = useState(true);
  const [storeSaving, setStoreSaving] = useState(false);
  const [showApiToken, setShowApiToken] = useState(false);
  const [storeError, setStoreError] = useState("");
  const [storeMessage, setStoreMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const response = await fetch("/api/auth/login-history", { cache: "no-store" });
      const body = await response.json() as { records?: LoginRecord[]; error?: string };
      if (response.status === 401) { window.location.replace("/login?next=/settings"); return; }
      if (!response.ok) throw new Error(body.error || "登录记录读取失败");
      setRecords(body.records || []);
    } catch (reason) {
      setHistoryError(reason instanceof Error ? reason.message : "登录记录读取失败");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadSession = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      if (response.status === 401) { window.location.replace("/login?next=/settings"); return; }
      const body = await response.json() as SessionInfo & { error?: string };
      if (!response.ok) throw new Error(body.error || "账号信息读取失败");
      setSession(body);
      setNewUsername(body.username);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "账号信息读取失败");
    }
  }, []);

  const loadStores = useCallback(async () => {
    setStoreLoading(true);
    setStoreError("");
    try {
      const response = await fetch("/api/settings/stores", { cache: "no-store" });
      const body = await response.json() as { stores?: StoreInfo[]; error?: string };
      if (response.status === 401) { window.location.replace("/login?next=/settings?panel=api"); return; }
      if (!response.ok) throw new Error(body.error || "店铺 API 读取失败");
      setStores(body.stores || []);
    } catch (reason) {
      setStoreError(reason instanceof Error ? reason.message : "店铺 API 读取失败");
    } finally {
      setStoreLoading(false);
    }
  }, []);

  useEffect(() => {
    const start = window.setTimeout(() => {
      void loadSession();
      void loadHistory();
      void loadStores();
      const query = new URLSearchParams(window.location.search);
      if (query.get("panel") === "api") setActivePanel("api");
      if (query.get("new") === "1") setStoreEditor({ id: "", name: "", apiToken: "", mode: "new" });
    }, 0);
    return () => window.clearTimeout(start);
  }, [loadHistory, loadSession, loadStores]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    if (newPassword && newPassword !== confirmPassword) { setError("两次输入的新密码不一致"); return; }
    if (!newPassword && newUsername === session?.username) { setError("账号信息没有变化"); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/auth/change-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newUsername, newPassword }),
      });
      const body = await response.json() as SessionInfo & { error?: string };
      if (!response.ok) throw new Error(body.error || "保存失败，请稍后重试");
      setSession({ username: body.username, updatedAt: body.updatedAt, mustChangePassword: false });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("账号信息已更新，其他设备上的旧登录已失效。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    window.location.replace("/login");
  }

  function refreshSettings() {
    void loadSession();
    void loadHistory();
    void loadStores();
  }

  async function storeAction(payload: Record<string, string>) {
    const response = await fetch("/api/settings/stores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json() as { stores?: StoreInfo[]; storeId?: string; error?: string };
    if (!response.ok) throw new Error(body.error || "操作失败，请稍后重试");
    setStores(body.stores || []);
    return body;
  }

  async function saveStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!storeEditor || storeSaving) return;
    setStoreSaving(true);
    setStoreError("");
    setStoreMessage("");
    try {
      await storeAction({ action: "save", id: storeEditor.id, name: storeEditor.name, apiToken: storeEditor.apiToken });
      setStoreMessage(storeEditor.mode === "new" ? "新店铺和 API 已保存，现在可以在左上角切换店铺。" : "店铺设置已更新，后续同步将使用最新 API。" );
      setStoreEditor(null);
      setShowApiToken(false);
    } catch (reason) {
      setStoreError(reason instanceof Error ? reason.message : "保存失败，请稍后重试");
    } finally {
      setStoreSaving(false);
    }
  }

  async function clearStoreToken(store: StoreInfo) {
    if (!window.confirm(`确定移除“${store.name}”的 API 吗？移除后该店铺将暂停同步。`)) return;
    setStoreError("");
    setStoreMessage("");
    try {
      await storeAction({ action: "clear-token", id: store.id });
      setStoreMessage(`已移除“${store.name}”的 API。`);
    } catch (reason) { setStoreError(reason instanceof Error ? reason.message : "API 移除失败"); }
  }

  async function deleteStore(store: StoreInfo) {
    if (!window.confirm(`确定删除“${store.name}”吗？商品和财务历史数据不会被自动删除，但店铺将从切换列表移除。`)) return;
    setStoreError("");
    setStoreMessage("");
    try {
      await storeAction({ action: "delete", id: store.id });
      setStoreMessage(`已从店铺列表删除“${store.name}”。`);
    } catch (reason) { setStoreError(reason instanceof Error ? reason.message : "店铺删除失败"); }
  }

  return <main className="app-shell account-shell">
    <AppSidebar active="settings" loading={historyLoading} onRefresh={refreshSettings} />
    <section className="workspace account-workspace settings-workspace">
      <header className="account-header"><div><p className="eyebrow">SECURITY · STORE ACCESS CONTROL</p><h1>系统设置</h1><p>集中管理登录安全、登录设备，以及每个店铺使用的 WB API。</p></div><button type="button" className="account-logout" onClick={logout}>退出登录</button></header>

      <nav className="settings-tabs" aria-label="设置分类">
        <button type="button" className={activePanel === "credentials" ? "active" : ""} aria-pressed={activePanel === "credentials"} onClick={() => setActivePanel("credentials")}><span aria-hidden="true">⚿</span><b>账号与密码</b><small>修改登录凭据</small></button>
        <button type="button" className={activePanel === "devices" ? "active" : ""} aria-pressed={activePanel === "devices"} onClick={() => setActivePanel("devices")}><span aria-hidden="true">⌘</span><b>登录设备</b><small>{historyLoading ? "正在读取" : `${records.length} 条成功登录记录`}</small></button>
        <button type="button" className={activePanel === "api" ? "active" : ""} aria-pressed={activePanel === "api"} onClick={() => setActivePanel("api")}><span aria-hidden="true">⌁</span><b>店铺与 API</b><small>{storeLoading ? "正在检测" : `${stores.filter((store) => store.connected).length}/${stores.length} 家已连接`}</small></button>
      </nav>

      {activePanel === "credentials" ? <div className="account-grid">
        <article className="account-summary">
          <span className="account-lock" aria-hidden="true">✓</span>
          <div><small>当前管理员</small><strong>{session?.username || "读取中…"}</strong><p>{session?.updatedAt ? `最近修改：${beijingTime(session.updatedAt)}` : "账号由服务器安全验证"}</p></div>
        </article>
        <article className="credential-card">
          <div className="credential-card-head"><div><span>登录安全</span><h2>修改用户名或密码</h2></div><em>需要验证当前密码</em></div>
          {session?.mustChangePassword ? <p className="password-notice">这是首次登录，请先修改临时密码。</p> : null}
          <form onSubmit={save}>
            <label><span>新用户名</span><input value={newUsername} onChange={(event) => setNewUsername(event.target.value)} minLength={3} maxLength={40} autoComplete="username" required /><small>3–40 位，可使用中英文、数字、点、横线和下划线</small></label>
            <label><span>当前密码</span><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" maxLength={128} required /></label>
            <label><span>新密码</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={10} maxLength={128} placeholder="不修改密码时留空" /><small>至少 10 位，建议同时包含大小写字母、数字与符号</small></label>
            <label><span>确认新密码</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" maxLength={128} disabled={!newPassword} /></label>
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            {message ? <p className="auth-success" role="status">{message}</p> : null}
            <div className="credential-actions"><Link href="/">返回经营后台</Link><button type="submit" disabled={saving || !session}>{saving ? "正在保存…" : "保存账号设置"}</button></div>
          </form>
        </article>
      </div> : activePanel === "devices" ? <section className="login-history-card" aria-live="polite">
        <header><div><span>访问记录</span><h2>最近登录设备</h2><p>仅记录成功登录；时间统一换算为北京时间。</p></div><button type="button" onClick={() => void loadHistory()} disabled={historyLoading}>{historyLoading ? "正在检测…" : "重新检测"}</button></header>
        <div className="login-history-note"><strong>IP 网络位置仅供参考</strong><span>VPN、代理、移动网络和运营商出口都可能让省份或城市出现偏差。记录保留 180 天。</span></div>
        {historyError ? <p className="auth-error" role="alert">{historyError}</p> : null}
        {!historyLoading && !historyError && records.length === 0 ? <div className="login-history-empty"><b>暂无登录记录</b><span>下一次成功登录后，将在这里显示设备、IP 和大致地区。</span></div> : null}
        <div className="login-history-list">
          {records.map((record) => <article key={record.id} className={record.current ? "current" : ""}>
            <span className="device-icon" aria-hidden="true">{record.device === "手机" ? "▯" : record.device === "平板电脑" ? "▭" : "▣"}</span>
            <div className="device-main"><div><b>{record.device} · {record.operatingSystem}</b>{record.current ? <em>当前设备</em> : null}</div><small>{record.browser}</small></div>
            <div className="device-location"><b>{record.location || "地区未知"}</b><small>IP：<code>{record.ip || "未获取"}</code>{record.edge ? ` · 节点 ${record.edge}` : ""}</small></div>
            <time dateTime={record.loggedInAt}><b>{beijingTime(record.loggedInAt)}</b><small>北京时间</small></time>
          </article>)}
        </div>
      </section> : <section className="store-api-card" id="api-management" aria-live="polite">
        <header><div><span>WB API MANAGEMENT</span><h2>店铺与 API 管理</h2><p>新增店铺、替换即将到期的 API，并检查各项数据权限。</p></div><button type="button" className="store-add-button" onClick={() => { setStoreEditor({ id: "", name: "", apiToken: "", mode: "new" }); setStoreError(""); setStoreMessage(""); }}>＋ 添加新店铺</button></header>
        <div className="store-api-security"><span aria-hidden="true">◆</span><div><b>API 仅保存在服务器，并经过加密</b><small>保存后不再回显完整 API；每次新增或更换时，都会先向 WB 官方接口验证有效性。</small></div></div>

        {storeEditor ? <form className="store-api-editor" onSubmit={saveStore}>
          <div className="store-api-editor-head"><div><b>{storeEditor.mode === "new" ? "添加新店铺" : "修改店铺与 API"}</b><small>{storeEditor.mode === "new" ? "填写名称和 WB API，验证通过后自动加入左上角店铺选择。" : "只修改名称时 API 可留空；填写新 API 即表示更换。"}</small></div><button type="button" onClick={() => { setStoreEditor(null); setStoreError(""); }}>×</button></div>
          <div className="store-api-fields">
            <label><span>店铺名称</span><input value={storeEditor.name} onChange={(event) => setStoreEditor({ ...storeEditor, name: event.target.value })} minLength={2} maxLength={40} placeholder="例如：王振3号店" required /></label>
            <label><span>{storeEditor.mode === "new" ? "WB API" : "新 WB API（不更换可留空）"}</span><div className="api-token-input"><input type={showApiToken ? "text" : "password"} value={storeEditor.apiToken} onChange={(event) => setStoreEditor({ ...storeEditor, apiToken: event.target.value })} autoComplete="off" placeholder="粘贴完整的 WB API 令牌" required={storeEditor.mode === "new"} /><button type="button" onClick={() => setShowApiToken((value) => !value)}>{showApiToken ? "隐藏" : "显示"}</button></div></label>
          </div>
          <div className="store-api-editor-actions"><span>正式 WB API 通常有效 180 天，系统按令牌到期时间提前提醒。</span><button type="submit" disabled={storeSaving}>{storeSaving ? "正在连接 WB 检测…" : "验证并保存"}</button></div>
        </form> : null}

        {storeError ? <p className="auth-error store-api-message" role="alert">{storeError}</p> : null}
        {storeMessage ? <p className="auth-success store-api-message" role="status">{storeMessage}</p> : null}
        {storeLoading && stores.length === 0 ? <div className="login-history-empty"><b>正在读取店铺 API…</b><span>系统正在检测当前连接与到期时间。</span></div> : null}

        <div className="store-api-list" data-horizontal-scroll>
          {stores.map((store) => <article key={store.id} className={`store-api-row ${store.status}`}>
            <span className="managed-store-avatar" aria-hidden="true">{store.badge}</span>
            <div className="managed-store-name"><div><b>{store.name}</b>{store.builtin ? <em>固定店铺</em> : <em>自建店铺</em>}</div><small>{store.sellerId ? `WB 店铺标识 ${store.sellerId}` : "店铺数据独立保存"}</small></div>
            <div className="managed-store-token"><b>{store.connected ? store.tokenHint : "尚未配置 API"}</b><small>{store.tokenType || "等待添加 WB API"}</small></div>
            <div className="managed-store-expiry"><b>{store.tokenExpiresAt ? beijingTime(store.tokenExpiresAt).split(" ")[0] : "—"}</b><small>{store.status === "expired" ? "API 已过期" : store.status === "expiring" ? `仅剩 ${store.daysRemaining} 天` : store.status === "active" ? `剩余 ${store.daysRemaining} 天` : "同步已暂停"}</small></div>
            <div className="managed-store-permissions"><b>API 权限</b><div>{store.permissions.length ? store.permissions.map((permission) => <span key={permission}>{permission}</span>) : <span className="muted">未读取</span>}</div></div>
            <div className="managed-store-status"><span className={store.connected ? "connected" : "disconnected"}>{store.connected ? "已连接" : "未连接"}</span><small>{store.updatedAt ? `更新 ${beijingTime(store.updatedAt)}` : "服务器现有配置"}</small></div>
            <div className="managed-store-actions"><button type="button" onClick={() => { setStoreEditor({ id: store.id, name: store.name, apiToken: "", mode: "edit" }); setShowApiToken(false); setStoreError(""); setStoreMessage(""); }}>{store.connected ? "更换 API" : "添加 API"}</button>{store.connected ? <button type="button" className="danger" onClick={() => void clearStoreToken(store)}>移除 API</button> : null}{!store.builtin ? <button type="button" className="danger" onClick={() => void deleteStore(store)}>删除店铺</button> : null}</div>
          </article>)}
        </div>
        <footer className="store-api-foot"><b>到期提醒规则</b><span>剩余 30 天以内显示橙色提醒；到期后显示红色，并停止使用该 API 请求 WB 数据。</span></footer>
      </section>}
    </section>
  </main>;
}
