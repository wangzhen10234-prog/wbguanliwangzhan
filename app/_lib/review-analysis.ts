export type ReviewFeedbackRecord = {
  id: string;
  nmId: number;
  rating: number;
  text: string;
  pros: string;
  cons: string;
  answered: boolean;
  orderStatus: string;
};

export type ReviewQuestionRecord = {
  id: string;
  nmId: number;
  text: string;
  answered: boolean;
};

export type ReviewIssueKey = "quality" | "size" | "packaging" | "mismatch" | "usage" | "material";

export type ReviewIssue = {
  key: ReviewIssueKey;
  label: string;
  count: number;
  suggestion: string;
};

export type ReviewRecommendation = {
  level: "high" | "medium" | "low";
  title: string;
  detail: string;
};

const ISSUE_DEFINITIONS: Array<{ key: ReviewIssueKey; label: string; pattern: RegExp; suggestion: string }> = [
  {
    key: "quality",
    label: "质量/损坏",
    pattern: /брак|качест|слом|полом|дефект|порва|трещ|не работ|坏|破|质量|故障|broken|defect|quality/i,
    suggestion: "抽检最近批次，重点检查结构强度和易损部位；在详情页明确使用边界，并把质检项目固化到发货前检查表。",
  },
  {
    key: "size",
    label: "尺寸/规格",
    pattern: /размер|длин|корот|ширин|высот|малень|больш|尺寸|长度|大小|规格|size|length|small|large/i,
    suggestion: "将带单位的实测尺寸图前移到主图区域，标题、规格和详情保持一致，并标明允许误差和适用范围。",
  },
  {
    key: "packaging",
    label: "包装/运输",
    pattern: /упаков|короб|достав|помят|царап|разбит|транспорт|包装|物流|运输|压坏|划痕|package|delivery|scratch/i,
    suggestion: "加固外包装和易损部位，增加护角或缓冲；同步检查运输破损是否集中在某个 SKU 或批次。",
  },
  {
    key: "mismatch",
    label: "描述不符",
    pattern: /не соответств|описан|фото|цвет|комплект|другой|описание|描述不符|图片不符|颜色|配件|mismatch|different|photo/i,
    suggestion: "逐项核对实物、首图、颜色、数量和配件清单，删除无法稳定兑现的卖点，并补充真实场景图。",
  },
  {
    key: "usage",
    label: "使用/功能",
    pattern: /инструк|как |удоб|креп|механизм|собра|установ|使用|安装|说明|功能|不会用|instruction|install|use/i,
    suggestion: "增加俄语步骤图、短视频和常见故障排查；把高频操作问题整理到商品详情 FAQ。",
  },
  {
    key: "material",
    label: "材质/气味",
    pattern: /материал|пластик|запах|тонк|толст|мягк|тверд|材质|塑料|气味|薄|厚|material|plastic|smell/i,
    suggestion: "补充材质、厚度和气味散发说明；若低星集中在同一批次，优先复核原料与供应商。",
  },
];

function searchableText(...values: string[]) {
  return values.filter(Boolean).join(" ").toLocaleLowerCase();
}

export function classifyReviewIssues(text: string) {
  const haystack = searchableText(text);
  return ISSUE_DEFINITIONS.filter((definition) => definition.pattern.test(haystack)).map((definition) => definition.key);
}

export function reviewIssueLabel(key: ReviewIssueKey) {
  return ISSUE_DEFINITIONS.find((definition) => definition.key === key)?.label ?? key;
}

export function analyzeProductReviews(feedbacks: ReviewFeedbackRecord[], questions: ReviewQuestionRecord[]) {
  const validFeedbacks = feedbacks.filter((feedback) => feedback.rating >= 1 && feedback.rating <= 5);
  const starCounts: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const feedback of validFeedbacks) starCounts[feedback.rating as 1 | 2 | 3 | 4 | 5] += 1;
  const total = validFeedbacks.length;
  const averageRating = total ? validFeedbacks.reduce((sum, feedback) => sum + feedback.rating, 0) / total : null;
  const positive = starCounts[4] + starCounts[5];
  const low = starCounts[1] + starCounts[2] + starCounts[3];
  const critical = starCounts[1] + starCounts[2];
  const unansweredFeedbacks = validFeedbacks.filter((feedback) => !feedback.answered).length;
  const unansweredQuestions = questions.filter((question) => !question.answered).length;
  const returnedFeedbacks = validFeedbacks.filter((feedback) => feedback.orderStatus === "returned" || feedback.orderStatus === "rejected").length;
  const issueCounts = new Map<ReviewIssueKey, number>();
  for (const feedback of validFeedbacks.filter((item) => item.rating <= 3)) {
    for (const key of classifyReviewIssues(searchableText(feedback.text, feedback.pros, feedback.cons))) issueCounts.set(key, (issueCounts.get(key) ?? 0) + 1);
  }
  for (const question of questions) {
    for (const key of classifyReviewIssues(question.text)) issueCounts.set(key, (issueCounts.get(key) ?? 0) + 1);
  }
  const issues: ReviewIssue[] = ISSUE_DEFINITIONS
    .map((definition) => ({ key: definition.key, label: definition.label, count: issueCounts.get(definition.key) ?? 0, suggestion: definition.suggestion }))
    .filter((issue) => issue.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-CN"));
  const interactions = total + questions.length;
  const answeredInteractions = validFeedbacks.filter((feedback) => feedback.answered).length + questions.filter((question) => question.answered).length;
  const responseRate = interactions ? answeredInteractions / interactions * 100 : null;
  const positiveRate = total ? positive / total * 100 : null;
  const lowRate = total ? low / total * 100 : null;
  const recommendations: ReviewRecommendation[] = [];

  if (critical > 0) recommendations.push({ level: "high", title: `优先处理 ${critical} 条一至二星评价`, detail: "先核对评价关联的 SKU、批次和订单状态；对可复现问题立即调整质检、包装或详情承诺。" });
  if (unansweredQuestions > 0) recommendations.push({ level: "high", title: `回复 ${unansweredQuestions} 条未回答提问`, detail: "优先回答购买决策相关问题，并把重复出现的问题补充到俄语详情页 FAQ，减少重复咨询。" });
  if (unansweredFeedbacks > 0) recommendations.push({ level: "medium", title: `处理 ${unansweredFeedbacks} 条未回复评价`, detail: "低星先解释解决路径，高星表达感谢；回复前核对商品事实，不要承诺无法兑现的补偿或参数。" });
  for (const issue of issues.slice(0, 3)) recommendations.push({ level: issue.count >= 3 ? "high" : "medium", title: `${issue.label}出现 ${issue.count} 次`, detail: issue.suggestion });
  if (returnedFeedbacks > 0) recommendations.push({ level: "high", title: `${returnedFeedbacks} 条评价关联拒收或退货`, detail: "与退货模块的原因和物流记录交叉核对，先区分商品问题、描述问题和运输损坏，再决定修改商品或包装。" });
  if (!total) recommendations.push({ level: "low", title: "评价样本不足", detail: "当前周期没有有效星级评价，暂不下质量结论；继续观察提问、退货原因和后续评价。" });
  else if (positiveRate !== null && positiveRate >= 90 && low === 0) recommendations.push({ level: "low", title: "当前口碑稳定", detail: "保留现有商品与包装方案，可从四至五星评价的优点中提炼真实卖点用于主图和详情页。" });
  if (!recommendations.length) recommendations.push({ level: "low", title: "保持监控", detail: "当前未发现明显集中问题，继续关注新评价、未回答问题和星级变化。" });

  const priority: "high" | "medium" | "stable" = critical > 0 || unansweredQuestions > 0 || (averageRating !== null && averageRating < 4)
    ? "high"
    : low > 0 || unansweredFeedbacks > 0 || (averageRating !== null && averageRating < 4.6)
      ? "medium"
      : "stable";

  return {
    total,
    averageRating,
    positiveRate,
    lowRate,
    low,
    critical,
    unansweredFeedbacks,
    questions: questions.length,
    unansweredQuestions,
    returnedFeedbacks,
    responseRate,
    starCounts,
    issues,
    recommendations,
    priority,
  };
}

export function orderStatusLabel(status: string) {
  if (status === "buyout") return "已购买";
  if (status === "returned") return "已退货";
  if (status === "rejected") return "已拒收";
  return "平台未标记";
}
