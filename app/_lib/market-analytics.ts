export type FunnelMetrics = {
  openCount: number;
  cartCount: number;
  orderCount: number;
  orderSum: number;
  buyoutCount: number;
  buyoutSum: number;
  cancelCount: number;
  cancelSum: number;
  addToWishlist: number;
};

export type FunnelConversions = {
  addToCartPercent: number;
  cartToOrderPercent: number;
  orderFromOpenPercent: number;
  buyoutPercent: number;
};

export type MarketProduct = FunnelMetrics & FunnelConversions & {
  nmId: number;
  sku: string;
  title: string;
  brand: string;
  subjectId: number;
  subjectName: string;
  stock: number;
  productRating: number;
  feedbackRating: number;
  openDynamic: number | null;
  cartDynamic: number | null;
  orderDynamic: number | null;
  orderSumDynamic: number | null;
};

export type MarketCategory = FunnelMetrics & FunnelConversions & {
  subjectId: number;
  subjectName: string;
  products: number;
  stock: number;
};

function numeric(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rounded(value: number, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function conversionsFor(metrics: FunnelMetrics): FunnelConversions {
  return {
    addToCartPercent: rounded(metrics.openCount ? metrics.cartCount / metrics.openCount * 100 : 0),
    cartToOrderPercent: rounded(metrics.cartCount ? metrics.orderCount / metrics.cartCount * 100 : 0),
    orderFromOpenPercent: rounded(metrics.openCount ? metrics.orderCount / metrics.openCount * 100 : 0),
    buyoutPercent: rounded(metrics.buyoutCount + metrics.cancelCount ? metrics.buyoutCount / (metrics.buyoutCount + metrics.cancelCount) * 100 : 0),
  };
}

export function emptyMetrics(): FunnelMetrics {
  return { openCount: 0, cartCount: 0, orderCount: 0, orderSum: 0, buyoutCount: 0, buyoutSum: 0, cancelCount: 0, cancelSum: 0, addToWishlist: 0 };
}

export function addMetrics(target: FunnelMetrics, source: Partial<FunnelMetrics>) {
  target.openCount += numeric(source.openCount);
  target.cartCount += numeric(source.cartCount);
  target.orderCount += numeric(source.orderCount);
  target.orderSum += numeric(source.orderSum);
  target.buyoutCount += numeric(source.buyoutCount);
  target.buyoutSum += numeric(source.buyoutSum);
  target.cancelCount += numeric(source.cancelCount);
  target.cancelSum += numeric(source.cancelSum);
  target.addToWishlist += numeric(source.addToWishlist);
  return target;
}

export function summarizeMarketProducts(products: MarketProduct[]) {
  const metrics = products.reduce((sum, item) => addMetrics(sum, item), emptyMetrics());
  return { ...metrics, ...conversionsFor(metrics), products: products.length, stock: products.reduce((sum, item) => sum + numeric(item.stock), 0) };
}

export function groupMarketProducts(products: MarketProduct[]) {
  const groups = new Map<number, { name: string; products: number; stock: number; metrics: FunnelMetrics }>();
  for (const product of products) {
    const subjectId = product.subjectId || 0;
    const current = groups.get(subjectId) ?? { name: product.subjectName || "未分类", products: 0, stock: 0, metrics: emptyMetrics() };
    current.products += 1;
    current.stock += numeric(product.stock);
    addMetrics(current.metrics, product);
    groups.set(subjectId, current);
  }
  return [...groups.entries()].map(([subjectId, value]) => ({
    subjectId,
    subjectName: value.name,
    products: value.products,
    stock: value.stock,
    ...value.metrics,
    ...conversionsFor(value.metrics),
  } satisfies MarketCategory)).sort((a, b) => b.orderSum - a.orderSum || b.openCount - a.openCount);
}

export function marketRecommendations(summary: ReturnType<typeof summarizeMarketProducts>, categories: MarketCategory[]) {
  const recommendations: Array<{ level: "high" | "medium" | "good"; title: string; detail: string }> = [];
  if (summary.openCount >= 100 && summary.addToCartPercent < 8) recommendations.push({ level: "high", title: "进卡后加购偏低", detail: `当前进卡→加购 ${summary.addToCartPercent.toFixed(1)}%，优先检查首图、价格和前两屏卖点是否匹配搜索意图。` });
  if (summary.cartCount >= 20 && summary.cartToOrderPercent < 12) recommendations.push({ level: "high", title: "加购后下单流失明显", detail: `当前加购→下单 ${summary.cartToOrderPercent.toFixed(1)}%，重点核对到手价、配送时效、评价与促销门槛。` });
  if (summary.orderCount >= 10 && summary.buyoutPercent < 70) recommendations.push({ level: "high", title: "购买完成率需关注", detail: `当前购买完成率 ${summary.buyoutPercent.toFixed(1)}%，建议结合退货原因排查尺寸、材质、功能描述和实物差异。` });
  const weakCategory = [...categories].filter((item) => item.openCount >= 50).sort((a, b) => a.orderFromOpenPercent - b.orderFromOpenPercent)[0];
  if (weakCategory && weakCategory.orderFromOpenPercent < 2) recommendations.push({ level: "medium", title: `${weakCategory.subjectName} 流量转化偏弱`, detail: `${weakCategory.openCount} 次浏览仅形成 ${weakCategory.orderCount} 单，建议单独筛选该分类并按流量排序检查低转化商品。` });
  const noStock = categories.filter((item) => item.stock <= 0 && item.orderCount > 0);
  if (noStock.length) recommendations.push({ level: "medium", title: "有订单分类出现零库存", detail: `${noStock.map((item) => item.subjectName).slice(0, 3).join("、")} 有订单但当前无可售库存，补货前会继续损失自然流量。` });
  if (!recommendations.length) recommendations.push({ level: "good", title: "整体漏斗暂未发现明显断层", detail: "继续观察分类与单品环比，修改价格、主图或标题后至少保留 7 天对照窗口。" });
  return recommendations.slice(0, 5);
}
