import { env } from "cloudflare:workers";
import {
  supplierStatusLabel,
  wbHistoryStatusLabel,
  wbLogisticsStage,
  wbStageLabel,
  wbStatusDescription,
  wbStatusLabel,
} from "../../../_lib/wb-order-status";
import { resolveWbStore } from "../../../_lib/server-storefront";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

type WbStatusResponse = {
  orders?: Array<{ id?: number; supplierStatus?: string; wbStatus?: string }>;
};
type WbHistoryStatus = {
  date?: string | null;
  code?: string;
  place?: string;
  officeName?: string;
  warehouseName?: string;
  address?: string;
};
type WbHistoryResponse = {
  orders?: Array<{
    orderID?: number;
    orderId?: number;
    deliveryDate?: string | null;
    statuses?: WbHistoryStatus[];
  }>;
};

async function readCrossBorderHistory(orderId: number, token: string) {
  try {
    const response = await fetch("https://marketplace-api.wildberries.ru/api/v3/orders/status/history", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ orders: [orderId] }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return {
      available: false,
      source: "WB Marketplace API /api/v3/orders/status/history",
      deliveryDate: null,
      events: [],
      reason: "WB 完整状态历史目前只对跨境订单开放，该订单未返回历史轨迹。",
    };
    const payload = await response.json() as WbHistoryResponse;
    const order = payload.orders?.find((item) => Number(item.orderID ?? item.orderId) === orderId);
    if (!order) return {
      available: false,
      source: "WB Marketplace API /api/v3/orders/status/history",
      deliveryDate: null,
      events: [],
      reason: "WB 未返回该订单的历史物流节点。",
    };
    const events = (order.statuses ?? []).map((event) => ({
      code: String(event.code || ""),
      label: wbHistoryStatusLabel(event.code),
      date: event.date || null,
      location: event.place || event.officeName || event.warehouseName || event.address || null,
    })).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    return {
      available: true,
      source: "WB Marketplace API /api/v3/orders/status/history",
      deliveryDate: order.deliveryDate || null,
      events,
      reason: events.length ? null : "WB 已识别跨境订单，但暂未返回历史节点。",
    };
  } catch {
    return {
      available: false,
      source: "WB Marketplace API /api/v3/orders/status/history",
      deliveryDate: null,
      events: [],
      reason: "WB 历史轨迹接口本次未响应，当前状态仍以实时状态接口为准。",
    };
  }
}

export async function POST(request: Request) {
  const token = (await resolveWbStore(request, env)).token;
  if (!token) return json({ error: "当前店铺的 WB API 尚未配置" }, 503);

  const body = await request.json().catch(() => null) as { orderId?: unknown } | null;
  const orderId = typeof body?.orderId === "number" ? body.orderId : Number(body?.orderId);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) return json({ error: "订单号格式无效" }, 400);

  try {
    const historyPromise = readCrossBorderHistory(orderId, token);
    const response = await fetch("https://marketplace-api.wildberries.ru/api/v3/orders/status", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ orders: [orderId] }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      if (response.status === 429) return json({ error: "WB 接口请求较频繁，请稍后重新读取" }, 503);
      if (response.status === 401 || response.status === 403) return json({ error: "WB API 权限校验失败" }, 502);
      return json({ error: "WB 当前物流状态读取失败，请稍后重试" }, 502);
    }

    const payload = await response.json() as WbStatusResponse;
    const order = payload.orders?.find((item) => Number(item.id) === orderId);
    if (!order) return json({ error: "WB 未返回该订单的当前状态" }, 404);

    const supplierStatus = String(order.supplierStatus || "");
    const wbStatus = String(order.wbStatus || "");
    const stage = wbLogisticsStage(wbStatus, supplierStatus);
    const history = await historyPromise;
    return json({
      source: "WB Marketplace API /api/v3/orders/status",
      checkedAt: new Date().toISOString(),
      orderId: String(orderId),
      supplierStatus,
      supplierLabel: supplierStatusLabel(supplierStatus),
      wbStatus,
      wbLabel: wbStatusLabel(wbStatus, supplierStatus),
      stage,
      stageLabel: wbStageLabel(stage),
      description: wbStatusDescription(wbStatus, supplierStatus),
      history,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") return json({ error: "WB 接口响应超时，请重新读取" }, 504);
    return json({ error: "WB 当前物流状态读取失败，请稍后重试" }, 502);
  }
}
