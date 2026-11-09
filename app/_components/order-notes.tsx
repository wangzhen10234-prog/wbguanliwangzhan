"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const NotesContext = createContext<{ notes: Record<string, string>; ready: boolean; editingId: string | null; open: (id: string, number: string, anchor: HTMLButtonElement) => void }>({ notes: {}, ready: false, editingId: null, open: () => {} });

export type OrderNotesState = { notes: Record<string, string>; ready: boolean };

export function OrderNotesProvider({ orderIds, revision, onStateChange, children }: { orderIds: string[]; revision: number; onStateChange: (state: OrderNotesState) => void; children: ReactNode }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState<{ id: string; number: string; anchor: HTMLButtonElement } | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number; side: string; arrow: number } | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const ids = orderIds.join(",");

  useEffect(() => {
    const controller = new AbortController();
    setReady(false);
    setLoadError("");
    const allIds = ids.split(",").filter(Boolean);
    const batches: string[][] = [];
    for (let index = 0; index < allIds.length; index += 100) batches.push(allIds.slice(index, index + 100));
    Promise.all(batches.map(async (batch) => {
      const response = await fetch(`/api/order-notes?ids=${encodeURIComponent(batch.join(","))}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json() as { notes?: Record<string, string>; error?: string };
      if (!response.ok || !body.notes) throw new Error(body.error || "备注读取失败");
      return body.notes;
    }))
      .then((results) => {
        if (controller.signal.aborted) return;
        setNotes(Object.assign({}, ...results));
        setReady(true);
      }).catch((reason: Error) => { if (reason.name !== "AbortError") setLoadError(reason.message); });
    return () => controller.abort();
  }, [ids, revision, retry]);

  useEffect(() => { onStateChange({ notes, ready }); }, [notes, ready, onStateChange]);

  useLayoutEffect(() => {
    if (!editing) { setPosition(null); return; }
    const place = () => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (!editing.anchor.isConnected) { setEditing(null); return; }
      const rect = editing.anchor.getBoundingClientRect();
      const width = dialog.offsetWidth;
      const height = dialog.offsetHeight;
      const gap = 12;
      const clamp = (value: number, max: number) => Math.max(gap, Math.min(value, max - gap));
      if (rect.right + gap + width <= window.innerWidth || rect.left - gap - width >= 0) {
        const right = rect.right + gap + width <= window.innerWidth;
        const top = clamp(rect.top - 20, window.innerHeight - height);
        setPosition({ left: right ? rect.right + gap : rect.left - gap - width, top, side: right ? "right" : "left", arrow: Math.max(16, Math.min(rect.top + rect.height / 2 - top, height - 16)) });
      } else {
        const left = clamp(rect.left - width / 2 + rect.width / 2, window.innerWidth - width);
        const below = rect.bottom + gap + height <= window.innerHeight;
        setPosition({ left, top: clamp(below ? rect.bottom + gap : rect.top - height - gap, window.innerHeight - height), side: below ? "below" : "above", arrow: Math.max(18, Math.min(rect.left + rect.width / 2 - left, width - 18)) });
      }
    };
    place();
    const observer = new ResizeObserver(place);
    if (dialogRef.current) observer.observe(dialogRef.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    const previous = editing.anchor;
    dialogRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) setEditing(null);
      if (event.key !== "Tab") return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), textarea:not(:disabled)");
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    const onOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!saving && !dialogRef.current?.contains(target) && !editing.anchor.contains(target)) setEditing(null);
    };
    document.addEventListener("pointerdown", onOutside);
    return () => { document.removeEventListener("keydown", onKeyDown); document.removeEventListener("pointerdown", onOutside); if (previous.isConnected) previous.focus({ preventScroll: true }); };
  }, [editing, saving]);

  async function save() {
    if (!editing || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/order-notes", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: editing.id, text: draft }) });
      const body = await response.json() as { text?: string; error?: string };
      if (!response.ok || typeof body.text !== "string") throw new Error(body.error || "保存失败，请重试");
      setNotes((current) => ({ ...current, [editing.id]: body.text! }));
      setEditing(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败，请重试"); }
    finally { setSaving(false); }
  }

  return <NotesContext.Provider value={{ notes, ready, editingId: editing?.id ?? null, open: (id, number, anchor) => { if (saving) return; setPosition(null); setEditing((current) => current?.id === id ? null : { id, number, anchor }); setDraft(notes[id] ?? ""); setError(""); } }}>
    {loadError && <div className="order-notes-load-error" role="alert">{loadError}<button type="button" onClick={() => setRetry((value) => value + 1)}>重新读取备注</button></div>}
    {children}
    {editing && <section ref={dialogRef} id="order-note-popover" className={`order-note-dialog order-note-popover ${position?.side ?? "right"}`} style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden", "--note-arrow": `${position?.arrow ?? 26}px` } as CSSProperties} role="dialog" aria-labelledby="order-note-title">
        <header><div><h2 id="order-note-title">订单备注</h2><p>订单 {editing.number}</p></div><button type="button" className="order-note-close" aria-label="关闭备注气泡" disabled={saving} onClick={() => setEditing(null)}>×</button></header>
        <textarea aria-label="订单备注内容" value={draft} maxLength={2000} disabled={saving} placeholder="输入这笔订单的备注…" onChange={(event) => setDraft(event.target.value)} />
        <div className="order-note-hint"><span>清空后保存可取消标记</span><span>{draft.length}/2000</span></div>
        {error && <p className="order-note-error" role="alert">{error}</p>}
        <footer><button type="button" disabled={saving} onClick={() => setDraft("")}>清空</button><button type="button" className="primary" disabled={saving} onClick={save}>{saving ? "保存中…" : "保存"}</button></footer>
      </section>
    }
  </NotesContext.Provider>;
}

export function OrderNoteButton({ orderId, orderNumber }: { orderId: string; orderNumber: string }) {
  const { notes, ready, editingId, open } = useContext(NotesContext);
  const note = notes[orderId] ?? "";
  return <button type="button" className={`order-note-button ${note ? "has-note" : ""}`} disabled={!ready} aria-haspopup="dialog" aria-expanded={editingId === orderId} aria-controls={editingId === orderId ? "order-note-popover" : undefined} aria-label={`${note ? "编辑" : "添加"}订单 ${orderNumber} 备注`} title={!ready ? "正在读取备注" : note || "添加订单备注"} onClick={(event) => open(orderId, orderNumber, event.currentTarget)}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6Z" /><path d="m14 5 5 5" /></svg>
  </button>;
}
