import { IMPORT_KINDS, type ImportKind } from "@/lib/domain/imports/fields";
import { toCsv } from "@/lib/domain/imports/values";
import { fileResponse, withRoute } from "@/lib/route";
import { templateFor } from "@/lib/services/imports";
import { buildXlsx } from "@/lib/services/spreadsheet";

export async function GET(req: Request) {
  return withRoute("view", "imports.template", async () => {
    const sp = new URL(req.url).searchParams;
    const kind = (sp.get("kind") ?? "products") as ImportKind;
    if (!(kind in IMPORT_KINDS)) return new Response("Unknown template", { status: 404 });
    const tpl = templateFor(kind);
    const name = `stockpilot-${kind.replace("_", "-")}-template`;
    if (sp.get("format") === "csv") return fileResponse(toCsv(tpl.headers, tpl.rows), `${name}.csv`, "text/csv; charset=utf-8");
    const buf = await buildXlsx([{ name: IMPORT_KINDS[kind].label, headers: tpl.headers, rows: tpl.rows, notes: tpl.notes }]);
    return fileResponse(buf, `${name}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });
}
