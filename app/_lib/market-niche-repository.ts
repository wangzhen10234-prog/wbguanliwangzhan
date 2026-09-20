import { readSyncSnapshot, writeSyncSnapshot } from "./server-persistence";
import { appendHistory } from "./market-analytics-provider";
import { EMPTY_MARKET_DATASET, type MarketCategoryMetric, type MarketDataset } from "./market-niche-types";

const DATASET_KEY = "market-niche:dataset:v1";

export async function readMarketDataset(): Promise<MarketDataset> {
  const snapshot = await readSyncSnapshot(DATASET_KEY);
  if (!snapshot?.payload) return { ...EMPTY_MARKET_DATASET, categories: [], history: [], watchedIds: [] };
  try {
    const parsed = JSON.parse(snapshot.payload) as Partial<MarketDataset>;
    return {
      version: 1,
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
      watchedIds: Array.isArray(parsed.watchedIds) ? parsed.watchedIds.filter((value): value is string => typeof value === "string") : [],
      importedAt: typeof parsed.importedAt === "string" ? parsed.importedAt : "",
      sourceFile: typeof parsed.sourceFile === "string" ? parsed.sourceFile : "",
    };
  } catch {
    return { ...EMPTY_MARKET_DATASET, categories: [], history: [], watchedIds: [] };
  }
}

async function saveMarketDataset(dataset: MarketDataset) {
  await writeSyncSnapshot(DATASET_KEY, JSON.stringify(dataset), `market:${new Date().toISOString().slice(0, 13)}`, 0, { preserveManualBucket: true });
  return dataset;
}

export async function importMarketRows(rows: MarketCategoryMetric[], sourceFile: string) {
  const current = await readMarketDataset();
  const byKey = new Map(current.categories.map((item) => [`${item.subjectId}:${item.periodDays}`, item]));
  for (const item of rows) byKey.set(`${item.subjectId}:${item.periodDays}`, item);
  return saveMarketDataset({
    ...current,
    categories: [...byKey.values()],
    history: appendHistory(current.history, rows),
    importedAt: new Date().toISOString(),
    sourceFile,
  });
}

export async function mergeOfficialMarketCatalog(rows: MarketCategoryMetric[], sourceFile: string, importedAt: string) {
  const current = await readMarketDataset();
  const metadata = new Map(rows.map((item) => [item.subjectId, item]));
  const existingSubjects = new Set(current.categories.map((item) => item.subjectId));
  const categories = current.categories.map((item) => {
    const official = metadata.get(item.subjectId);
    return official ? { ...item, nameRu: official.nameRu, parentId: official.parentId, parentName: official.parentName, level: official.level } : item;
  });
  for (const item of rows) if (!existingSubjects.has(item.subjectId)) categories.push(item);
  return saveMarketDataset({ ...current, categories, importedAt, sourceFile });
}

export async function setMarketWatch(subjectId: string, watched: boolean) {
  const current = await readMarketDataset();
  const ids = new Set(current.watchedIds);
  if (watched) ids.add(subjectId); else ids.delete(subjectId);
  return saveMarketDataset({ ...current, watchedIds: [...ids] });
}
