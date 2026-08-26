export type AuditPhoto = {
  big?: string;
  hq?: string;
  c516x688?: string;
  c246x328?: string;
  square?: string;
};

export type AuditCharacteristic = {
  id?: number;
  name?: string;
  value?: unknown;
};

export type AuditCard = {
  nmID?: number;
  subjectID?: number;
  subjectName?: string;
  vendorCode?: string;
  brand?: string;
  title?: string;
  description?: string;
  dimensions?: { width?: number; height?: number; length?: number; weightBrutto?: number; isValid?: boolean };
  photos?: AuditPhoto[];
  characteristics?: AuditCharacteristic[];
  createdAt?: string;
  updatedAt?: string;
};

export type AuditFunnelMetrics = {
  openCount?: number;
  cartCount?: number;
  orderCount?: number;
  orderSum?: number;
  buyoutCount?: number;
  buyoutSum?: number;
  cancelCount?: number;
  cancelSum?: number;
  avgPrice?: number;
  avgOrdersCountPerDay?: number;
  shareOrderPercent?: number;
  addToWishlist?: number;
  localizationPercent?: number;
  conversions?: {
    addToCartPercent?: number;
    cartToOrderPercent?: number;
    buyoutPercent?: number;
  };
};

export type AuditFunnel = {
  selected?: AuditFunnelMetrics;
  past?: AuditFunnelMetrics;
  comparison?: {
    openCountDynamic?: number;
    cartCountDynamic?: number;
    orderCountDynamic?: number;
    buyoutCountDynamic?: number;
    conversions?: {
      addToCartPercent?: number;
      cartToOrderPercent?: number;
      buyoutPercent?: number;
    };
  };
};

export type AuditSeverity = "critical" | "high" | "medium" | "healthy";

export type AuditIssue = {
  area: "image" | "title" | "description" | "attributes" | "funnel";
  severity: "high" | "medium" | "low";
  title: string;
  evidence: string;
  action: string;
};

export type ProductAuditResult = {
  nmId: number;
  sku: string;
  title: string;
  subjectName: string;
  brand: string;
  description: string;
  descriptionLength: number;
  photoCount: number;
  photos: AuditPhoto[];
  characteristicCount: number;
  characteristics: Array<{ name: string; value: string }>;
  dimensions: { width: number; height: number; length: number; weightBrutto: number; valid: boolean };
  updatedAt: string;
  scores: {
    overall: number;
    image: number;
    title: number;
    description: number;
    attributes: number;
    funnel: number;
  };
  priority: AuditSeverity;
  issues: AuditIssue[];
  recommendations: string[];
  titleEvidence: string[];
  descriptionEvidence: string[];
  imageEvidence: string[];
  attributeEvidence: string[];
  funnel: Required<Pick<AuditFunnelMetrics, "openCount" | "cartCount" | "orderCount" | "orderSum" | "buyoutCount" | "buyoutSum" | "cancelCount" | "cancelSum" | "avgPrice" | "addToWishlist" | "localizationPercent">> & {
    addToCartPercent: number;
    cartToOrderPercent: number;
    buyoutPercent: number;
    openDynamic: number | null;
    cartDynamic: number | null;
    orderDynamic: number | null;
  };
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function number(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringifyCharacteristic(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => text(item) || String(item ?? "")).filter(Boolean).join("、");
  if (value && typeof value === "object") return Object.values(value).map((item) => text(item) || String(item ?? "")).filter(Boolean).join("、");
  return text(value) || String(value ?? "").trim();
}

function wordTokens(value: string) {
  return value.toLocaleLowerCase("ru").match(/[\p{L}\p{N}]+/gu) ?? [];
}

function uniqueRatio(tokens: string[]) {
  return tokens.length ? new Set(tokens).size / tokens.length : 0;
}

function russianRatio(value: string) {
  const letters = value.match(/\p{L}/gu) ?? [];
  if (!letters.length) return 0;
  return (value.match(/[А-Яа-яЁё]/g) ?? []).length / letters.length;
}

function imageScore(card: AuditCard, evidence: string[], issues: AuditIssue[]) {
  const photos = card.photos ?? [];
  let score = photos.length >= 8 ? 100 : photos.length >= 6 ? 92 : photos.length >= 4 ? 76 : photos.length >= 2 ? 55 : photos.length === 1 ? 35 : 0;
  const main = photos[0];
  if (main?.big || main?.hq) score += 5;
  if (!photos.length) {
    issues.push({ area: "image", severity: "high", title: "缺少商品图片", evidence: "WB 商品卡未返回任何图片", action: "先补充清晰主图，再增加尺寸、细节、使用场景和包装图。" });
  } else if (photos.length < 5) {
    issues.push({ area: "image", severity: photos.length < 3 ? "high" : "medium", title: "图片信息量不足", evidence: `当前仅 ${photos.length} 张图`, action: "建议至少覆盖主图、核心卖点、尺寸、细节、使用场景和包装清单。" });
  }
  evidence.push(`${photos.length} 张 WB 商品图`);
  evidence.push(main?.big || main?.hq ? "首图含 WB 高清源" : "首图未返回高清源");
  evidence.push("图片审美与构图需结合页面预览人工复核");
  return clamp(score);
}

function titleScore(card: AuditCard, evidence: string[], issues: AuditIssue[]) {
  const title = text(card.title);
  const tokens = wordTokens(title);
  const ratio = russianRatio(title);
  let score = title ? 20 : 0;
  if (title.length >= 40 && title.length <= 100) score += 30;
  else if (title.length >= 25 && title.length <= 120) score += 20;
  else if (title.length > 0) score += 8;
  if (ratio >= 0.75) score += 20;
  else if (ratio >= 0.45) score += 12;
  if (uniqueRatio(tokens) >= 0.8) score += 20;
  else if (uniqueRatio(tokens) >= 0.65) score += 10;
  const subjectTokens = wordTokens(text(card.subjectName)).filter((token) => token.length >= 3);
  if (!subjectTokens.length || subjectTokens.some((token) => title.toLocaleLowerCase("ru").includes(token))) score += 10;
  evidence.push(`标题 ${title.length} 个字符`);
  evidence.push(`俄文字母占比 ${Math.round(ratio * 100)}%`);
  evidence.push(`词语去重率 ${Math.round(uniqueRatio(tokens) * 100)}%`);
  if (!title) {
    issues.push({ area: "title", severity: "high", title: "缺少标题", evidence: "WB 商品卡标题为空", action: "用俄语写明品类＋核心规格＋主要用途，不要堆叠同义词。" });
  } else {
    if (title.length < 25) issues.push({ area: "title", severity: "high", title: "标题信息过少", evidence: `仅 ${title.length} 个字符`, action: "补充品类、关键规格、核心功能和适用对象。" });
    if (title.length > 120) issues.push({ area: "title", severity: "medium", title: "标题过长", evidence: `${title.length} 个字符`, action: "删除重复词和低价值修饰词，把核心关键词前置。" });
    if (tokens.length >= 5 && uniqueRatio(tokens) < 0.7) issues.push({ area: "title", severity: "medium", title: "标题存在重复堆词", evidence: `词语去重率仅 ${Math.round(uniqueRatio(tokens) * 100)}%`, action: "每个关键词保留一次，优先可读性和准确规格。" });
    if (ratio < 0.45) issues.push({ area: "title", severity: "high", title: "俄语可读性不足", evidence: `俄文字母占比 ${Math.round(ratio * 100)}%`, action: "使用自然俄语标题，SKU 编码放在卖家商品编号中，不要占用标题。" });
  }
  return clamp(score);
}

function descriptionScore(card: AuditCard, evidence: string[], issues: AuditIssue[]) {
  const description = text(card.description);
  const ratio = russianRatio(description);
  let score = description ? 10 : 0;
  if (description.length >= 800) score += 35;
  else if (description.length >= 400) score += 28;
  else if (description.length >= 180) score += 18;
  else if (description.length > 0) score += 7;
  if (ratio >= 0.7) score += 20;
  else if (ratio >= 0.4) score += 10;
  if (/\d/.test(description) && /(см|мм|м|кг|г|л|шт|mah|w|вт)/i.test(description)) score += 15;
  if (/\n|[•▪—-]/.test(description)) score += 10;
  if (/(подходит|удобн|преимуществ|использ|комплект|материал|размер|характерист)/i.test(description)) score += 10;
  evidence.push(`描述 ${description.length} 个字符`);
  evidence.push(`俄文字母占比 ${Math.round(ratio * 100)}%`);
  evidence.push(/\d/.test(description) ? "包含数字规格" : "未发现数字规格");
  if (!description) {
    issues.push({ area: "description", severity: "high", title: "缺少商品描述", evidence: "WB 商品卡描述为空", action: "按用途、核心卖点、尺寸材质、使用方法、包装清单和注意事项补齐俄语描述。" });
  } else {
    if (description.length < 180) issues.push({ area: "description", severity: "high", title: "描述过短", evidence: `仅 ${description.length} 个字符`, action: "补充实际规格、使用场景、差异化卖点和注意事项。" });
    if (!/\d/.test(description)) issues.push({ area: "description", severity: "medium", title: "描述缺少可核验规格", evidence: "未发现数字信息", action: "加入尺寸、数量、容量、重量或适用范围等真实参数。" });
    if (ratio < 0.4) issues.push({ area: "description", severity: "high", title: "俄语描述不足", evidence: `俄文字母占比 ${Math.round(ratio * 100)}%`, action: "改为自然俄语表达，避免机器堆词和无意义重复。" });
  }
  return clamp(score);
}

function attributeScore(card: AuditCard, evidence: string[], issues: AuditIssue[]) {
  const characteristics = (card.characteristics ?? []).filter((item) => text(item.name) && stringifyCharacteristic(item.value));
  const dimensions = card.dimensions ?? {};
  const dimensionsValid = number(dimensions.width) > 0 && number(dimensions.height) > 0 && number(dimensions.length) > 0 && number(dimensions.weightBrutto) > 0;
  let score = characteristics.length >= 12 ? 65 : characteristics.length >= 8 ? 56 : characteristics.length >= 5 ? 44 : characteristics.length >= 3 ? 32 : characteristics.length >= 1 ? 17 : 0;
  if (dimensionsValid) score += 20;
  if (text(card.brand)) score += 8;
  if (text(card.subjectName) && number(card.subjectID) > 0) score += 7;
  evidence.push(`${characteristics.length} 项有效特征`);
  evidence.push(dimensionsValid ? "包装尺寸与重量完整" : "包装尺寸或重量不完整");
  evidence.push(text(card.brand) ? `品牌：${text(card.brand)}` : "品牌为空");
  if (characteristics.length < 5) issues.push({ area: "attributes", severity: characteristics.length < 2 ? "high" : "medium", title: "商品特征不完整", evidence: `仅 ${characteristics.length} 项有效特征`, action: "按当前品类补齐材质、颜色、尺寸、用途、配置和适用对象等可筛选特征。" });
  if (!dimensionsValid) issues.push({ area: "attributes", severity: "high", title: "包装参数不完整", evidence: "长、宽、高或毛重存在空值/0", action: "核对实物包装并补齐长宽高和毛重，避免物流费用与搜索筛选异常。" });
  return clamp(score);
}

function funnelScore(funnel: AuditFunnel | undefined, evidence: string[], issues: AuditIssue[]) {
  const selected = funnel?.selected ?? {};
  const openCount = number(selected.openCount);
  const addToCart = number(selected.conversions?.addToCartPercent);
  const cartToOrder = number(selected.conversions?.cartToOrderPercent);
  const buyout = number(selected.conversions?.buyoutPercent);
  if (openCount < 20) {
    evidence.push(`访客打开 ${openCount} 次，样本不足`);
    evidence.push("经营评分暂按中性值计算");
    return 50;
  }
  let score = 0;
  score += addToCart >= 15 ? 35 : addToCart >= 10 ? 28 : addToCart >= 7 ? 20 : addToCart >= 4 ? 12 : 4;
  score += cartToOrder >= 20 ? 30 : cartToOrder >= 14 ? 24 : cartToOrder >= 9 ? 17 : cartToOrder >= 5 ? 10 : 3;
  score += buyout >= 90 ? 25 : buyout >= 80 ? 21 : buyout >= 70 ? 16 : buyout >= 55 ? 9 : 3;
  score += number(funnel?.comparison?.orderCountDynamic) >= 0 ? 10 : 3;
  evidence.push(`进卡 ${openCount} · 加购 ${number(selected.cartCount)} · 下单 ${number(selected.orderCount)}`);
  evidence.push(`进卡→加购 ${addToCart.toFixed(1)}% · 加购→下单 ${cartToOrder.toFixed(1)}%`);
  evidence.push(`买断率 ${buyout.toFixed(1)}% · 订单同比 ${number(funnel?.comparison?.orderCountDynamic).toFixed(0)}%`);
  if (openCount >= 100 && addToCart < 7) issues.push({ area: "funnel", severity: "high", title: "进卡后加购偏低", evidence: `${openCount} 次进卡，加购率 ${addToCart.toFixed(1)}%`, action: "优先检查首图、价格、标题承诺和前两屏卖点是否匹配搜索意图。" });
  if (number(selected.cartCount) >= 10 && cartToOrder < 9) issues.push({ area: "funnel", severity: "high", title: "加购后下单偏低", evidence: `${number(selected.cartCount)} 次加购，下单转化 ${cartToOrder.toFixed(1)}%`, action: "检查到手价、促销、配送时效、评价和详情页信任信息。" });
  if (number(selected.orderCount) >= 5 && buyout < 70) issues.push({ area: "funnel", severity: "high", title: "买断率偏低", evidence: `${number(selected.orderCount)} 单，买断率 ${buyout.toFixed(1)}%`, action: "对照退货原因检查尺寸、颜色、材质、功能描述是否与实物一致。" });
  if (number(funnel?.comparison?.orderCountDynamic) < -20) issues.push({ area: "funnel", severity: "medium", title: "订单趋势下降", evidence: `较上一周期 ${number(funnel?.comparison?.orderCountDynamic).toFixed(0)}%`, action: "对比价格、库存、广告和搜索位置变化，优先修复下降最大的流量入口。" });
  return clamp(score);
}

function priorityFor(scores: ProductAuditResult["scores"], issues: AuditIssue[], metrics: AuditFunnelMetrics) {
  const highIssues = issues.filter((issue) => issue.severity === "high").length;
  if (highIssues >= 3 || scores.overall < 45 || (number(metrics.openCount) >= 100 && scores.funnel < 35)) return "critical" as const;
  if (highIssues >= 1 || scores.overall < 60) return "high" as const;
  if (issues.length || scores.overall < 78) return "medium" as const;
  return "healthy" as const;
}

export function evaluateProductAudit(card: AuditCard, funnel?: AuditFunnel): ProductAuditResult {
  const issues: AuditIssue[] = [];
  const imageEvidence: string[] = [];
  const titleEvidence: string[] = [];
  const descriptionEvidence: string[] = [];
  const attributeEvidence: string[] = [];
  const funnelEvidence: string[] = [];
  const image = imageScore(card, imageEvidence, issues);
  const title = titleScore(card, titleEvidence, issues);
  const description = descriptionScore(card, descriptionEvidence, issues);
  const attributes = attributeScore(card, attributeEvidence, issues);
  const funnelValue = funnelScore(funnel, funnelEvidence, issues);
  const overall = clamp(image * 0.2 + title * 0.15 + description * 0.15 + attributes * 0.15 + funnelValue * 0.35);
  const scores = { overall, image, title, description, attributes, funnel: funnelValue };
  const selected = funnel?.selected ?? {};
  const priority = priorityFor(scores, issues, selected);
  const recommendations = issues
    .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - ({ high: 0, medium: 1, low: 2 }[b.severity])))
    .map((issue) => issue.action)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 6);
  if (!recommendations.length) recommendations.push("当前基础信息和转化表现较完整，建议保持价格与库存稳定，并每周观察转化趋势。", "继续补充真实使用场景图和最新买家反馈，防止竞争商品追平。", "修改标题或首图后保留至少 7 天观察窗口，再比较转化变化。");
  const characteristics = (card.characteristics ?? [])
    .map((item) => ({ name: text(item.name), value: stringifyCharacteristic(item.value) }))
    .filter((item) => item.name && item.value);
  const dimensions = card.dimensions ?? {};
  return {
    nmId: number(card.nmID),
    sku: text(card.vendorCode) || String(number(card.nmID)),
    title: text(card.title) || text(card.subjectName) || `WB ${number(card.nmID)}`,
    subjectName: text(card.subjectName) || "未分类",
    brand: text(card.brand) || "—",
    description: text(card.description),
    descriptionLength: text(card.description).length,
    photoCount: (card.photos ?? []).length,
    photos: card.photos ?? [],
    characteristicCount: characteristics.length,
    characteristics,
    dimensions: {
      width: number(dimensions.width),
      height: number(dimensions.height),
      length: number(dimensions.length),
      weightBrutto: number(dimensions.weightBrutto),
      valid: number(dimensions.width) > 0 && number(dimensions.height) > 0 && number(dimensions.length) > 0 && number(dimensions.weightBrutto) > 0,
    },
    updatedAt: text(card.updatedAt),
    scores,
    priority,
    issues,
    recommendations,
    titleEvidence,
    descriptionEvidence,
    imageEvidence,
    attributeEvidence,
    funnel: {
      openCount: number(selected.openCount),
      cartCount: number(selected.cartCount),
      orderCount: number(selected.orderCount),
      orderSum: number(selected.orderSum),
      buyoutCount: number(selected.buyoutCount),
      buyoutSum: number(selected.buyoutSum),
      cancelCount: number(selected.cancelCount),
      cancelSum: number(selected.cancelSum),
      avgPrice: number(selected.avgPrice),
      addToWishlist: number(selected.addToWishlist),
      localizationPercent: number(selected.localizationPercent),
      addToCartPercent: number(selected.conversions?.addToCartPercent),
      cartToOrderPercent: number(selected.conversions?.cartToOrderPercent),
      buyoutPercent: number(selected.conversions?.buyoutPercent),
      openDynamic: funnel?.comparison?.openCountDynamic === undefined ? null : number(funnel.comparison.openCountDynamic),
      cartDynamic: funnel?.comparison?.cartCountDynamic === undefined ? null : number(funnel.comparison.cartCountDynamic),
      orderDynamic: funnel?.comparison?.orderCountDynamic === undefined ? null : number(funnel.comparison.orderCountDynamic),
    },
  };
}
