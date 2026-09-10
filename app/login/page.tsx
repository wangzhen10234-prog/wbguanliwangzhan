"use client";

import { FormEvent, useState } from "react";

function safeNextPath() {
  const value = new URLSearchParams(window.location.search).get("next");
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/login") ? value : "/";
}

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await response.json() as { error?: string; mustChangePassword?: boolean };
      if (!response.ok) throw new Error(body.error || "登录失败，请稍后重试");
      window.location.replace(body.mustChangePassword ? "/settings?required=1" : safeNextPath());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败，请稍后重试");
      setLoading(false);
    }
  }

  return <main className="login-page">
    <section className="login-card" aria-labelledby="login-title">
      <div className="login-brand" aria-hidden="true">W</div>
      <p className="login-eyebrow">WB WORK · PRIVATE CONSOLE</p>
      <h1 id="login-title">登录经营后台</h1>
      <p className="login-lead">请输入管理员账号和密码，验证通过后才能查看店铺与财务数据。</p>
      <form onSubmit={submit}>
        <label><span>用户名</span><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required maxLength={40} /></label>
        <label><span>密码</span><div className="password-input"><input type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={128} /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "隐藏" : "显示"}</button></div></label>
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
        <button className="login-submit" type="submit" disabled={loading}>{loading ? "正在验证…" : "安全登录"}</button>
      </form>
      <p className="login-security"><span aria-hidden="true">●</span> 账号验证与数据接口均由服务器保护</p>
    </section>
  </main>;
}
