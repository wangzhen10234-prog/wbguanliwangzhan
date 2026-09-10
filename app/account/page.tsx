"use client";

import { useEffect } from "react";

export default function AccountPage() {
  useEffect(() => {
    window.location.replace(`/settings${window.location.search}`);
  }, []);

  return <main className="login-page"><p>正在打开系统设置…</p></main>;
}
