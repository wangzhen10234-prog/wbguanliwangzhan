import { env } from "cloudflare:workers";

type WbProductDetails = {
  nmId?: number;
  productName?: string;
  supplierArticle?: string;
  brandName?: string;
  size?: string;
};

type WbFeedback = {
  id?: string;
  text?: string;
  pros?: string;
  cons?: string;
  productValuation?: number;
  createdDate?: string;
  answer?: { text?: string; editable?: boolean } | null;
  productDetails?: WbProductDetails;
  wasViewed?: boolean;
  photoLinks?: Array<{ fullSize?: string; miniSize?: string }>;
  video?: { previewImage?: string; link?: string; durationSec?: number } | null;
  orderStatus?: string;
};

type WbQuestion = {
  id?: string;
  text?: string;
  createdDate?: string;
  answer?: { text?: string; editable?: boolean; createDate?: string } | null;
  productDetails?: WbProductDetails;
  wasViewed?: boolean;
  isWarned?: boolean;
};

type WbCard = {
  nmID?: number;
  vendorCode?: string;
  title?: string;
  brand?: string;
  subjectName?: string;
  photos?: Array<{ c246x328?: string; c516x688?: string; big?: string; square?: string }>;
};

type ReviewSnapshot = {
  source: "WB Feedbacks and Questions API";
  syncedAt: string;
  syncSchedule: { timezone: "Asia/Shanghai"; hours: number[]; currentSlot: string; nextAt: string; mode: "scheduled" | "manual" };
  sellerRating: { available: boolean; valuation: number | null; feedbackCount: number | null };
  products: Array<{ nmId: number; sellerSku: string; name: string; brand: string; category: string; image: string }>;
  feedbacks: Array<{
    id: string; nmId: number; sellerSku: string; productName: string; brand: string; size: string; createdAt: string; rating: number;
    text: string; pros: string; cons: string; answer: string; answered: boolean; answerEditable: boolean; viewed: boolean;
    archived: boolean; orderStatus: string; photos: string[]; videoPreview: string; videoUrl: string;
  }>;
  questions: Array<{
    id: string; nmId: number; sellerSku: string; productName: string; brand: string; createdAt: string; text: string;
    answer: string; answered: boolean; answerEditable: boolean; answerCreatedAt: string; viewed: boolean; warned: boolean;
  }>;
  completeness: { feedbackLimitReached: boolean; questionLimitReached: boolean };
  stale: boolean;
  warning: string;
};

type WorkerError = Error & { status?: number };
type SnapshotRecord = { value: ReviewSnapshot; syncSlot: string; manualBucket: number };

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
const FEEDBACK_API = "https://feedbacks-api.wildberries.ru";
const AUTO_SYNC_HOURS = [8, 14, 19, 23] as const;
const BEIJING_OFFSET_MS = 8 * 60 * 60_000;
const MANUAL_REFRESH_MS = 5 * 60_000;
const SNAPSHOT_KEY = "reviews-questions-v1";
const PAGE_SIZE = 5000;
const MAX_ROWS_PER_BUCKET = 10_000;
let memoryCache: { value: ReviewSnapshot; expiresAt: number } | null = null;
let pendingLoad: Promise<ReviewSnapshot> | null = null;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function number(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function schedule(now = Date.now()) {
  const beijingNow = new Date(now + BEIJING_OFFSET_MS);
  const year = beijingNow.getUTCFullYear();
  const month = beijingNow.getUTCMonth();
  const day = beijingNow.getUTCDate();
  const hour = beijingNow.getUTCHours();
  const dateKey = beijingNow.toISOString().slice(0, 10);
  const previousDateKey = new Date(Date.UTC(year, month, day - 1)).toISOString().slice(0, 10);
  const currentHour = [...AUTO_SYNC_HOURS].reverse().find((value) => hour >= value);
  const slot = currentHour === undefined ? `${previousDateKey}-23` : `${dateKey}-${String(currentHour).padStart(2, "0")}`;
  const nextHour = AUTO_SYNC_HOURS.find((value) => value > hour);
  const nextAt = nextHour === undefined
    ? Date.UTC(year, month, day + 1, AUTO_SYNC_HOURS[0]) - BEIJING_OFFSET_MS
    : Date.UTC(year, month, day, nextHour) - BEIJING_OFFSET_MS;
  return { slot, nextAt };
}

function wait(milliseconds = 360) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function wbRequest<T>(url: string, token: string, body?: unknown) {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const error = new Error(`WB feedback request failed: ${response.status}`) as WorkerError;
    error.status = response.status;
    throw error;
  }
  return response.json() as Promise<T>;
}

async function loadFeedbackBucket(token: string, path: string, isAnswered?: boolean) {
  const records: WbFeedback[] = [];
  for (let skip = 0; skip < MAX_ROWS_PER_BUCKET; skip += PAGE_SIZE) {
    const url = new URL(`${FEEDBACK_API}${path}`);
    if (isAnswered !== undefined) url.searchParams.set("isAnswered", String(isAnswered));
    url.searchParams.set("take", String(PAGE_SIZE));
    url.searchParams.set("skip", String(skip));
    url.searchParams.set("order", "dateDesc");
    const response = await wbRequest<{ data?: { feedbacks?: WbFeedback[] } }>(url.toString(), token);
    const batch = response.data?.feedbacks ?? [];
    records.push(...batch);
    if (batch.length < PAGE_SIZE) return { records, limitReached: false };
    await wait();
  }
  return { records, limitReached: records.length >= MAX_ROWS_PER_BUCKET };
}

async function loadQuestionBucket(token: string, isAnswered: boolean) {
  const records: WbQuestion[] = [];
  for (let skip = 0; skip < MAX_ROWS_PER_BUCKET; skip += PAGE_SIZE) {
    const url = new URL(`${FEEDBACK_API}/api/v1/questions`);
    url.searchParams.set("isAnswered", String(isAnswered));
    url.searchParams.set("take", String(PAGE_SIZE));
    url.searchParams.set("skip", String(skip));
    url.searchParams.set("order", "dateDesc");
    const response = await wbRequest<{ data?: { questions?: WbQuestion[] } }>(url.toString(), token);
    const batch = response.data?.questions ?? [];
    records.push(...batch);
    if (batch.length < PAGE_SIZE) return { records, limitReached: false };
    await wait();
  }
  return { records, limitReached: records.length >= MAX_ROWS_PER_BUCKET };
}

async function loadCards(token: string) {
  const cards: WbCard[] = [];
  let cursor: { updatedAt?: string; nmID?: number } = {};
  for (let page = 0; page < 50; page += 1) {
    const response = await wbRequest<{ cards?: WbCard[]; cursor?: { updatedAt?: string; nmID?: number } }>(
      "https://content-api.wildberries.ru/content/v2/get/cards/list",
      token,
      { settings: { sort: { ascending: true }, cursor: { limit: 100, ...cursor }, filter: { withPhoto: -1 } } },
    );
    const batch = response.cards ?? [];
    cards.push(...batch);
    if (batch.length < 100 || !response.cursor?.updatedAt || !response.cursor?.nmID) break;
    cursor = { updatedAt: response.cursor.updatedAt, nmID: response.cursor.nmID };
    await wait(650);
  }
  return cards;
}

async function readSnapshot() {
  try {
    const row = await env.DB.prepare("SELECT payload, sync_slot AS syncSlot, manual_bucket AS manualBucket FROM wb_sync_snapshots WHERE cache_key = ?")
      .bind(SNAPSHOT_KEY)
      .first<{ payload?: string; syncSlot?: string; manualBucket?: number }>();
    if (!row?.payload) return null;
    return { value: JSON.parse(row.payload) as ReviewSnapshot, syncSlot: row.syncSlot || "", manualBucket: Number(row.manualBucket || 0) } satisfies SnapshotRecord;
  } catch {
    return null;
  }
}

async function writeSnapshot(value: ReviewSnapshot, manual: boolean) {
  try {
    await env.DB.prepare(`
      INSERT INTO wb_sync_snapshots (cache_key, payload, sync_slot, manual_bucket, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(cache_key) DO UPDATE SET
        payload = excluded.payload,
        sync_slot = excluded.sync_slot,
        manual_bucket = CASE WHEN excluded.manual_bucket > 0 THEN excluded.manual_bucket ELSE wb_sync_snapshots.manual_bucket END,
        updated_at = CURRENT_TIMESTAMP
    `).bind(SNAPSHOT_KEY, JSON.stringify(value), schedule().slot, manual ? Math.floor(Date.now() / MANUAL_REFRESH_MS) : 0).run();
  } catch {
    // Fresh WB data stays usable even if the durable snapshot cannot be written.
  }
}

function normalizeFeedback(feedback: WbFeedback, archived: boolean) {
  const details = feedback.productDetails ?? {};
  return {
    id: text(feedback.id),
    nmId: Math.trunc(number(details.nmId)),
    sellerSku: text(details.supplierArticle, "—"),
    productName: text(details.productName, "WB 商品"),
    brand: text(details.brandName, "—"),
    size: text(details.size, "—"),
    createdAt: text(feedback.createdDate),
    rating: Math.trunc(number(feedback.productValuation)),
    text: text(feedback.text),
    pros: text(feedback.pros),
    cons: text(feedback.cons),
    answer: text(feedback.answer?.text),
    answered: Boolean(text(feedback.answer?.text)),
    answerEditable: Boolean(feedback.answer?.editable),
    viewed: Boolean(feedback.wasViewed),
    archived,
    orderStatus: text(feedback.orderStatus, "notSpecified"),
    photos: (feedback.photoLinks ?? []).map((photo) => text(photo.fullSize || photo.miniSize)).filter(Boolean),
    videoPreview: text(feedback.video?.previewImage),
    videoUrl: text(feedback.video?.link),
  };
}

function normalizeQuestion(question: WbQuestion) {
  const details = question.productDetails ?? {};
  return {
    id: text(question.id),
    nmId: Math.trunc(number(details.nmId)),
    sellerSku: text(details.supplierArticle, "—"),
    productName: text(details.productName, "WB 商品"),
    brand: text(details.brandName, "—"),
    createdAt: text(question.createdDate),
    text: text(question.text),
    answer: text(question.answer?.text),
    answered: Boolean(text(question.answer?.text)),
    answerEditable: Boolean(question.answer?.editable),
    answerCreatedAt: text(question.answer?.createDate),
    viewed: Boolean(question.wasViewed),
    warned: Boolean(question.isWarned),
  };
}

async function fetchSnapshot(token: string, manual: boolean) {
  const warnings: string[] = [];
  const cardsPromise = loadCards(token).catch(() => { warnings.push("WB 商品卡接口本次未返回图片，评价与提问数据不受影响"); return [] as WbCard[]; });
  const rating = await wbRequest<{ feedbackCount?: number; valuation?: number }>(`${FEEDBACK_API}/api/common/v1/rating`, token)
    .then((value) => ({ available: true, valuation: number(value.valuation) || null, feedbackCount: Number.isFinite(Number(value.feedbackCount)) ? Number(value.feedbackCount) : null }))
    .catch(() => { warnings.push("WB 店铺总评分接口本次未返回数据"); return { available: false, valuation: null, feedbackCount: null }; });
  await wait();
  const answeredFeedbacks = await loadFeedbackBucket(token, "/api/v1/feedbacks", true);
  await wait();
  const unansweredFeedbacks = await loadFeedbackBucket(token, "/api/v1/feedbacks", false);
  await wait();
  const archivedFeedbacks = await loadFeedbackBucket(token, "/api/v1/feedbacks/archive").catch(() => {
    warnings.push("WB 历史归档评价本次未返回，当前展示活跃评价");
    return { records: [] as WbFeedback[], limitReached: false };
  });
  await wait();
  const answeredQuestions = await loadQuestionBucket(token, true).catch(() => {
    warnings.push("WB 已回答提问本次未返回");
    return { records: [] as WbQuestion[], limitReached: false };
  });
  await wait();
  const unansweredQuestions = await loadQuestionBucket(token, false).catch(() => {
    warnings.push("WB 未回答提问本次未返回");
    return { records: [] as WbQuestion[], limitReached: false };
  });
  const cards = await cardsPromise;

  const feedbackById = new Map<string, ReturnType<typeof normalizeFeedback>>();
  for (const feedback of answeredFeedbacks.records) {
    const normalized = normalizeFeedback(feedback, false);
    if (normalized.id) feedbackById.set(normalized.id, normalized);
  }
  for (const feedback of unansweredFeedbacks.records) {
    const normalized = normalizeFeedback(feedback, false);
    if (normalized.id) feedbackById.set(normalized.id, normalized);
  }
  for (const feedback of archivedFeedbacks.records) {
    const normalized = normalizeFeedback(feedback, true);
    if (normalized.id && !feedbackById.has(normalized.id)) feedbackById.set(normalized.id, normalized);
  }
  const questionById = new Map<string, ReturnType<typeof normalizeQuestion>>();
  for (const question of [...answeredQuestions.records, ...unansweredQuestions.records]) {
    const normalized = normalizeQuestion(question);
    if (normalized.id) questionById.set(normalized.id, normalized);
  }

  const recordProducts = new Map<number, { nmId: number; sellerSku: string; name: string; brand: string; category: string; image: string }>();
  for (const record of [...feedbackById.values(), ...questionById.values()]) {
    if (!record.nmId) continue;
    recordProducts.set(record.nmId, { nmId: record.nmId, sellerSku: record.sellerSku, name: record.productName, brand: record.brand, category: "—", image: "" });
  }
  for (const card of cards) {
    const nmId = Math.trunc(number(card.nmID));
    if (!nmId) continue;
    const current = recordProducts.get(nmId);
    const photo = card.photos?.[0];
    recordProducts.set(nmId, {
      nmId,
      sellerSku: text(card.vendorCode, current?.sellerSku || `WB-${nmId}`),
      name: text(card.title, current?.name || `WB ${nmId}`),
      brand: text(card.brand, current?.brand || "—"),
      category: text(card.subjectName, "—"),
      image: text(photo?.c246x328 || photo?.c516x688 || photo?.big || photo?.square),
    });
  }
  const feedbackLimitReached = answeredFeedbacks.limitReached || unansweredFeedbacks.limitReached || archivedFeedbacks.limitReached;
  const questionLimitReached = answeredQuestions.limitReached || unansweredQuestions.limitReached;
  if (feedbackLimitReached) warnings.push("评价明细达到 WB 单次分析上限，页面已明确标记数据范围");
  if (questionLimitReached) warnings.push("提问明细达到 WB 单次分析上限，页面已明确标记数据范围");
  const current = schedule();
  return {
    source: "WB Feedbacks and Questions API" as const,
    syncedAt: new Date().toISOString(),
    syncSchedule: { timezone: "Asia/Shanghai" as const, hours: [...AUTO_SYNC_HOURS], currentSlot: current.slot, nextAt: new Date(current.nextAt).toISOString(), mode: manual ? "manual" as const : "scheduled" as const },
    sellerRating: rating,
    products: [...recordProducts.values()].sort((a, b) => a.sellerSku.localeCompare(b.sellerSku, "zh-CN")),
    feedbacks: [...feedbackById.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    questions: [...questionById.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    completeness: { feedbackLimitReached, questionLimitReached },
    stale: false,
    warning: warnings.join("；"),
  } satisfies ReviewSnapshot;
}

async function loadSnapshot(token: string, manual: boolean) {
  const current = schedule();
  const manualBucket = Math.floor(Date.now() / MANUAL_REFRESH_MS);
  if (!manual && memoryCache && memoryCache.expiresAt > Date.now()) return memoryCache.value;
  const durable = await readSnapshot();
  if (!manual && durable?.syncSlot === current.slot) {
    memoryCache = { value: durable.value, expiresAt: current.nextAt };
    return durable.value;
  }
  if (manual && durable?.manualBucket === manualBucket) return durable.value;
  if (pendingLoad) return pendingLoad;
  pendingLoad = fetchSnapshot(token, manual)
    .then(async (value) => {
      memoryCache = { value, expiresAt: current.nextAt };
      await writeSnapshot(value, manual);
      return value;
    })
    .catch((error) => {
      if (durable?.value) return { ...durable.value, stale: true, warning: "WB 评价与提问接口本次读取失败，当前展示上一次成功同步的数据" };
      throw error;
    })
    .finally(() => { pendingLoad = null; });
  return pendingLoad;
}

export async function GET(request: Request) {
  try {
    const token = env.WB_API_TOKEN;
    if (!token) return json({ error: "WB API 密钥尚未配置" }, 503);
    const manual = new URL(request.url).searchParams.get("refresh") === "manual";
    return json(await loadSnapshot(token, manual));
  } catch (error) {
    const status = Number((error as WorkerError).status || 0);
    if (status === 401) return json({ error: "WB API 密钥无效，无法读取评价与提问" }, 502);
    if (status === 403) return json({ error: "当前 WB 密钥没有评价与提问权限" }, 502);
    if (status === 429) return json({ error: "WB 评价与提问接口限流，请稍后重试" }, 429);
    return json({ error: "WB 评价与提问数据暂时无法读取" }, 502);
  }
}
