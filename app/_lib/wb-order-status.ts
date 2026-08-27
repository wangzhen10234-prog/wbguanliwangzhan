export type WbLogisticsStage = "new" | "preparing" | "carrier" | "sorted" | "pickup" | "delivered" | "canceled" | "unknown";

export const CANCELED_WB_STATUSES = new Set([
  "canceled",
  "canceled_by_client",
  "declined_by_client",
  "canceled_by_missed_call",
  "defect",
]);

export const WB_STATUS_FILTERS = [
  { value: "waiting", label: "处理中 / 运输中" },
  { value: "accepted_by_carrier", label: "承运商已接收" },
  { value: "sent_to_carrier", label: "运往承运商仓库" },
  { value: "sorted", label: "WB 已分拣" },
  { value: "ready_for_pickup", label: "到达取货点 / 待签收" },
  { value: "postponed_delivery", label: "配送已延期" },
  { value: "sold", label: "买家已签收" },
  { value: "__canceled__", label: "全部取消 / 异常" },
] as const;

export function supplierStatusLabel(value?: string) {
  return ({
    new: "新订单",
    confirm: "备货中",
    complete: "已交付配送",
    cancel: "卖家取消",
  } as Record<string, string>)[String(value || "").toLowerCase()] || "平台未说明";
}

export function wbStatusLabel(value?: string, supplierStatus?: string) {
  const status = String(value || "").toLowerCase();
  const supplier = String(supplierStatus || "").toLowerCase();
  if (status === "waiting") {
    if (supplier === "new") return "等待卖家处理";
    if (supplier === "confirm") return "备货 / 等待交接";
    if (supplier === "complete") return "运输处理中";
    return "处理中";
  }
  return ({
    sorted: "WB 已分拣",
    ready_for_pickup: "已到取货点，待签收",
    sold: "买家已签收",
    canceled: "订单已取消",
    canceled_by_client: "签收时拒收",
    declined_by_client: "客户取消",
    canceled_by_missed_call: "联系不上客户取消",
    defect: "商品瑕疵",
    postponed_delivery: "配送已延期",
    accepted_by_carrier: "承运商已接收",
    sent_to_carrier: "运往承运商仓库",
  } as Record<string, string>)[status] || (status ? "WB 其他状态" : "平台未返回");
}

export function wbLogisticsStage(value?: string, supplierStatus?: string): WbLogisticsStage {
  const status = String(value || "").toLowerCase();
  const supplier = String(supplierStatus || "").toLowerCase();
  if (CANCELED_WB_STATUSES.has(status) || supplier === "cancel") return "canceled";
  if (status === "sold") return "delivered";
  if (status === "ready_for_pickup") return "pickup";
  if (status === "sorted") return "sorted";
  if (["accepted_by_carrier", "sent_to_carrier", "postponed_delivery"].includes(status)) return "carrier";
  if (status === "waiting") {
    if (supplier === "new") return "new";
    if (supplier === "confirm") return "preparing";
    if (supplier === "complete") return "carrier";
  }
  return "unknown";
}

export function wbStageLabel(stage: WbLogisticsStage) {
  return ({
    new: "等待处理",
    preparing: "备货交接",
    carrier: "运输途中",
    sorted: "WB 已分拣",
    pickup: "待买家签收",
    delivered: "订单已签收",
    canceled: "订单已取消 / 异常",
    unknown: "平台状态待说明",
  } as Record<WbLogisticsStage, string>)[stage];
}

export function wbStatusDescription(value?: string, supplierStatus?: string) {
  const status = String(value || "").toLowerCase();
  const supplier = String(supplierStatus || "").toLowerCase();
  if (status === "waiting" && supplier === "new") return "WB 已生成订单，当前仍等待卖家处理，尚未进入分拣或运输环节。";
  if (status === "waiting" && supplier === "confirm") return "卖家已确认订单，当前处于备货或等待交给 WB 的阶段。";
  if (status === "waiting" && supplier === "complete") return "卖家已完成交接，WB 当前仍返回 waiting；系统按运输处理中展示。";
  return ({
    sorted: "WB 仓库已完成分拣，订单将继续进入后续配送环节。",
    ready_for_pickup: "订单已经到达买家取货点，正在等待买家领取并完成签收。",
    sold: "WB 当前确认买家已经收到商品，订单已正常签收。",
    canceled: "WB 当前确认订单已取消。",
    canceled_by_client: "买家在签收环节拒绝收货，订单未正常签收。",
    declined_by_client: "买家已经取消订单，订单未正常签收。",
    canceled_by_missed_call: "因无法联系买家，WB 将订单取消。",
    defect: "WB 将该订单标记为商品瑕疵。",
    postponed_delivery: "WB 当前标记配送延期，订单仍未完成签收。",
    accepted_by_carrier: "承运商已经接收订单，正在进入运输流程。",
    sent_to_carrier: "订单正在运往承运商仓库，尚未到达买家取货点。",
  } as Record<string, string>)[status] || "WB 当前只返回了状态代码，未提供更详细的通用 FBS 物流轨迹。";
}

export function matchesWbStatusFilter(wbStatus: string | undefined, filter: string) {
  const status = String(wbStatus || "").toLowerCase();
  if (filter === "all") return true;
  if (filter === "__canceled__") return CANCELED_WB_STATUSES.has(status);
  return status === filter;
}
