export type ReturnTrackingStage = "transit" | "ready" | "completed" | "unknown";

export function classifyReturnTracking(status: string, isStatusActive: boolean, completedAt?: string | null): ReturnTrackingStage {
  const normalized = status.trim().toLocaleLowerCase("ru");
  if (normalized.includes("выдано")) return "completed";
  if (normalized.includes("готов к выдаче")) return "ready";
  if (normalized.includes("в пути")) return "transit";
  if (isStatusActive) return "unknown";
  return completedAt ? "completed" : "unknown";
}

export function returnStatusLabel(status: string, stage: ReturnTrackingStage) {
  const known: Record<string, string> = {
    "В пути в пвз": "运输至取货点",
    "Готов к выдаче": "已到达，可取回",
    "Выдано": "已取回",
    "Статус не определен": "平台状态未明确",
  };
  return known[status] || ({ transit: "运输中", ready: "可取回", completed: "已完成", unknown: "状态待确认" } as const)[stage];
}
