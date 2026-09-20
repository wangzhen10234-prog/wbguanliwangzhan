import type { MarketCategoryMetric } from "./market-niche-types.ts";
import { strFromU8, unzipSync } from "fflate";

const ALIASES: Record<keyof MarketCategoryMetric, string[]> = {
  id: [],
  subjectId: ["subject id", "subjectid", "id предмета", "предмет id", "категория id", "wb id", "wb category/subject id", "品类id", "类目id"],
  nameRu: ["предмет", "категория", "название предмета", "название категории", "类目名称", "品类名称", "俄语品类名称"],
  nameZh: ["中文名称", "中文品类名称"],
  parentId: ["parent id", "родитель id", "父级id"],
  parentName: ["родительская категория", "родитель", "一级品类", "父级品类"],
  level: ["уровень", "层级", "level"],
  periodDays: ["period", "период", "周期", "天数"],
  metricDate: ["дата", "date", "统计日期", "日期"],
  revenueRub: ["выручка", "оборот", "продажи, ₽", "выручка, ₽", "销售额", "销售额 ₽", "оборот, руб"],
  salesUnits: ["заказы, шт", "продажи, шт", "количество заказов", "销量", "销售数量", "заказали товаров, шт"],
  revenueGrowth: ["динамика выручки", "рост выручки", "销售额增长率", "销售增长率"],
  salesGrowth: ["динамика заказов", "рост заказов", "销量增长率"],
  sellerCount: ["количество продавцов", "продавцы", "卖家数量"],
  productCount: ["количество карточек", "карточки товаров", "карточки", "商品卡数量", "商品数量"],
  averagePriceRub: ["средняя цена", "средний чек", "средняя цена, ₽", "平均成交价", "平均价格"],
  medianPriceRub: ["медианная цена", "中位成交价", "中位价格"],
  buyoutRate: ["процент выкупа", "выкуп, %", "выкуп %", "购买率", "выкуп"],
  cancelRate: ["отказы, %", "процент отказов", "取消率", "拒收率"],
  averageStock: ["средний остаток", "средние остатки", "平均库存"],
  turnoverDays: ["оборачиваемость", "оборачиваемость, дни", "库存周转天数", "周转天数"],
  concentration: ["монополизация", "монополизация, %", "市场集中度", "集中度"],
  top10ProductShare: ["доля top 10 товаров", "top10商品销售额占比"],
  top10SellerShare: ["доля top 10 продавцов", "top10卖家销售额占比"],
  seasonality: ["сезонность", "季节性"],
  supplyDemand: ["предложение", "供需", "供需情况", "дефицит"],
  source: [], confidence: [], updatedAt: [], opportunityScore: [], opportunityReasons: [],
};

function normalizedHeader(value: string) {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/[()]/g, "").replace(/\s+/g, " ");
}

function separatorFor(line: string) {
  const counts = [["\t", (line.match(/\t/g) || []).length], [";", (line.match(/;/g) || []).length], [",", (line.match(/,/g) || []).length]] as const;
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

function splitLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') { current += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === delimiter && !quoted) { cells.push(current.trim()); current = ""; continue; }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function numeric(value: string) {
  const cleaned = value.replace(/\u00a0/g, " ").replace(/[₽руб.%]/gi, "").replace(/\s+/g, "").replace(/,(?=\d{1,4}$)/, ".").replace(/[^\d.+-]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function fieldFor(header: string) {
  const normalized = normalizedHeader(header);
  return (Object.entries(ALIASES) as Array<[keyof MarketCategoryMetric, string[]]>).find(([, aliases]) => aliases.some((alias) => normalized === normalizedHeader(alias)))?.[0];
}

export function parseMarketCsv(text: string, fileName: string, periodDays = 30) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("报表没有可读取的数据行");
  const delimiter = separatorFor(lines[0]);
  const headers = splitLine(lines[0], delimiter);
  const fields = headers.map(fieldFor);
  const recognized = fields.filter(Boolean).length;
  if (recognized < 3 || !fields.includes("nameRu")) throw new Error("未识别为 WB《Анализ ниш》报表，请检查表头或另存为 CSV/TSV");
  const now = new Date().toISOString();
  const rows = lines.slice(1).flatMap((line, rowIndex) => {
    const cells = splitLine(line, delimiter);
    const raw = new Map<keyof MarketCategoryMetric, string>();
    fields.forEach((field, index) => { if (field) raw.set(field, cells[index] || ""); });
    const nameRu = raw.get("nameRu")?.trim() || "";
    if (!nameRu) return [];
    const subjectId = raw.get("subjectId")?.trim() || `import-${nameRu.toLocaleLowerCase("ru-RU").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "")}`;
    const metricDateRaw = raw.get("metricDate")?.trim();
    const metricDate = metricDateRaw && /^\d{4}-\d{2}-\d{2}/.test(metricDateRaw) ? metricDateRaw.slice(0, 10) : now.slice(0, 10);
    const item: MarketCategoryMetric = {
      id: `${subjectId}:${periodDays}:${metricDate}:${rowIndex}`,
      subjectId,
      nameRu,
      nameZh: raw.get("nameZh")?.trim() || "",
      parentId: raw.get("parentId")?.trim() || "",
      parentName: raw.get("parentName")?.trim() || "",
      level: numeric(raw.get("level") || "") || (raw.get("parentName") ? 2 : 1),
      periodDays: numeric(raw.get("periodDays") || "") || periodDays,
      metricDate,
      revenueRub: numeric(raw.get("revenueRub") || ""),
      salesUnits: numeric(raw.get("salesUnits") || ""),
      revenueGrowth: numeric(raw.get("revenueGrowth") || ""),
      salesGrowth: numeric(raw.get("salesGrowth") || ""),
      sellerCount: numeric(raw.get("sellerCount") || ""),
      productCount: numeric(raw.get("productCount") || ""),
      averagePriceRub: numeric(raw.get("averagePriceRub") || ""),
      medianPriceRub: numeric(raw.get("medianPriceRub") || ""),
      buyoutRate: numeric(raw.get("buyoutRate") || ""),
      cancelRate: numeric(raw.get("cancelRate") || ""),
      averageStock: numeric(raw.get("averageStock") || ""),
      turnoverDays: numeric(raw.get("turnoverDays") || ""),
      concentration: numeric(raw.get("concentration") || ""),
      top10ProductShare: numeric(raw.get("top10ProductShare") || ""),
      top10SellerShare: numeric(raw.get("top10SellerShare") || ""),
      seasonality: numeric(raw.get("seasonality") || ""),
      supplyDemand: numeric(raw.get("supplyDemand") || ""),
      source: "WB_EXPORT",
      confidence: "OFFICIAL_EXPORT",
      updatedAt: now,
    };
    return [item];
  });
  if (!rows.length) throw new Error("报表中没有识别到品类数据");
  return { rows, fileName, recognizedHeaders: recognized, totalHeaders: headers.length };
}

function decodeXml(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function columnIndex(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0].toUpperCase() || "A";
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

/** Reads the first worksheet of a standards-compliant XLSX without evaluating formulas or macros. */
export function parseMarketXlsx(buffer: ArrayBuffer, fileName: string, periodDays = 30) {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(new Uint8Array(buffer)); } catch { throw new Error("Excel 文件结构损坏或不是有效的 XLSX"); }
  const sharedXml = files["xl/sharedStrings.xml"] ? strFromU8(files["xl/sharedStrings.xml"]) : "";
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => decodeXml([...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((text) => text[1]).join("")));
  const sheetName = Object.keys(files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)).sort()[0];
  if (!sheetName) throw new Error("Excel 文件中没有可读取的工作表");
  const sheetXml = strFromU8(files[sheetName]);
  const rows = [...sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1];
      const body = cellMatch[2];
      const reference = attributes.match(/\br="([A-Z]+\d+)"/i)?.[1] || `A${cells.length + 1}`;
      const type = attributes.match(/\bt="([^"]+)"/)?.[1] || "";
      const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "";
      const inline = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((text) => text[1]).join("");
      const value = type === "s" ? shared[Number(raw)] || "" : type === "inlineStr" ? decodeXml(inline) : decodeXml(raw);
      cells[columnIndex(reference)] = value.replace(/[\t\r\n]+/g, " ").trim();
    }
    return cells.map((value) => value || "").join("\t");
  }).filter((row) => row.trim());
  if (rows.length < 2) throw new Error("Excel 工作表中没有可读取的数据行");
  return parseMarketCsv(rows.join("\n"), fileName, periodDays);
}
