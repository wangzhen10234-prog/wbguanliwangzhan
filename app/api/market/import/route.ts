import { parseMarketCsv } from "../../../_lib/market-import";
import { importMarketRows } from "../../../_lib/market-niche-repository";

const HEADERS = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const periodDays = Math.max(7, Math.min(365, Number(form.get("periodDays") || 30)));
    if (!(file instanceof File)) return json({ error: "请选择 WB 官方导出的 CSV/TSV 报表" }, 400);
    if (file.size > 8 * 1024 * 1024) return json({ error: "文件不能超过 8MB" }, 413);
    const lowerName = file.name.toLocaleLowerCase();
    if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
      return json({ error: "当前请先在 Excel 中将官方报表另存为 UTF-8 CSV 后上传；系统不会在无法验证表头时猜测数据" }, 415);
    }
    if (!lowerName.endsWith(".csv") && !lowerName.endsWith(".tsv") && !lowerName.endsWith(".txt")) return json({ error: "仅支持 CSV、TSV 或制表符文本" }, 415);
    const parsed = parseMarketCsv(await file.text(), file.name, periodDays);
    const dataset = await importMarketRows(parsed.rows, parsed.fileName);
    return json({ imported: parsed.rows.length, recognizedHeaders: parsed.recognizedHeaders, totalHeaders: parsed.totalHeaders, importedAt: dataset.importedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "报表导入失败";
    return json({ error: message }, 400);
  }
}
