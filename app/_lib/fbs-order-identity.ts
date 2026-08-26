export type FbsOrderIdentity = {
  id?: number | string | null;
  rid?: string | null;
  orderUid?: string | null;
};

export function fbsOrderKey(order: FbsOrderIdentity) {
  const numericId = Number(order.id || 0);
  if (Number.isFinite(numericId) && numericId > 0) return `id:${Math.trunc(numericId)}`;

  const rid = String(order.rid || "").trim();
  if (rid) return `rid:${rid.toLocaleLowerCase()}`;

  const orderUid = String(order.orderUid || "").trim();
  if (orderUid) return `order:${orderUid.toLocaleLowerCase()}`;

  return "";
}
