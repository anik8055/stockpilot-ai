import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, PageHeader, Panel } from "@/components/ui";
import { aiStatus } from "@/lib/ai/provider";
import { formatDate } from "@/lib/domain/dates";
import { formatINR, formatQty } from "@/lib/domain/money";
import { loadEntitlements } from "@/lib/queries";
import { history, type AssistantAnswer } from "@/lib/services/assistant/assistant";
import type { Column } from "@/lib/services/assistant/tools";
import { monthlyUsage } from "@/lib/services/entitlements";
import { requireTenant, tx } from "@/lib/tenant";
import { AskForm } from "./ask-form";

export const metadata: Metadata = { title: "Ask StockPilot" };

export default async function AssistantPage() {
  const t = await requireTenant("assistant.use");
  const ent = await loadEntitlements(t);
  const ai = await aiStatus(false);
  const usage = await tx(t, (db) => monthlyUsage(db, t.businessId));
  const past = ent.features.assistant ? await tx(t, (db) => history(db, t, 10)) : [];
  return (
    <>
      <PageHeader
        title="Ask StockPilot"
        description={
          ai.configured
            ? `Answers are calculated from your data; the AI only explains them. ${usage.ai} of ${ent.limits.ai_requests_per_month} AI questions used this month.`
            : "AI explanations are off — answers show the calculated figures from your data."
        }
      />
      {!ent.features.assistant ? (
        <Alert tone="info" title="Ask StockPilot is part of the Growth plan"><Link href="/app/settings?tab=plan" className="underline">See plans</Link></Alert>
      ) : (
        <div className="space-y-6">
          {past.length === 0 && (
            <Panel title="What you can ask">
              <p className="text-sm text-muted">Questions about reordering, items that are not selling, money tied up in stock, supplier shares, why an item is flagged, recent stock changes and rising demand.</p>
            </Panel>
          )}
          {past.map((a, i) => (
            <AnswerCard key={`${a.at}-${i}`} a={a} />
          ))}
          <Panel>
            <AskForm />
          </Panel>
        </div>
      )}
    </>
  );
}

function fmt(v: string | number | null, c: Column) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") {
    if (c.kind === "money") return formatINR(v, { whole: Math.abs(v) >= 1000 });
    if (c.kind === "pct") return `${v}%`;
    if (c.kind === "days") return `${v}`;
    return formatQty(v);
  }
  if (c.kind === "date") return formatDate(v);
  return v;
}

function AnswerCard({ a }: { a: AssistantAnswer }) {
  const r = a.result;
  return (
    <article className="space-y-3">
      <p className="ml-auto w-fit max-w-[85%] rounded-lg bg-ink px-4 py-2 text-sm text-white">{a.question}</p>
      <div className="rounded-lg border border-line bg-surface">
        {a.fallbackMessage && <p className="p-4 text-sm text-muted">{a.fallbackMessage}</p>}
        {r && (
          <>
            <div className="border-b border-line px-4 py-3">
              <p className="font-semibold text-ink">{r.title}</p>
              {r.period && <p className="text-xs text-muted">Data period: {r.period}</p>}
            </div>
            {a.interpretation && (
              <section className="border-b border-line bg-signal-soft/50 px-4 py-3" aria-label="AI interpretation">
                <p className="mb-1 flex items-center gap-2 text-xs font-medium text-signal-strong">
                  <Badge tone="info">AI interpretation</Badge> {a.interpretation.model} · checked against the figures below
                </p>
                <p className="text-sm">{a.interpretation.summary}</p>
                {a.interpretation.points.length > 0 && (
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm">
                    {a.interpretation.points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            {!a.interpretation && <p className="border-b border-line px-4 py-3 text-sm">{r.summary}</p>}
            {a.aiNote && <p className="border-b border-line px-4 py-2 text-xs text-muted">{a.aiNote}</p>}
            {r.rows.length > 0 && (
              <section aria-label="From your data" className="overflow-x-auto">
                <p className="px-4 pt-3 text-xs font-medium text-muted">
                  From your data{r.columns.some((c) => c.estimate) ? " · columns marked * are calculated estimates" : ""}
                </p>
                <table className="mt-1 w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-muted">
                      {r.columns.map((c) => (
                        <th key={c.key} scope="col" className={`px-4 py-1.5 font-semibold ${["qty", "money", "days", "pct"].includes(c.kind) ? "text-right" : ""}`}>
                          {c.label}
                          {c.estimate ? " *" : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {r.rows.map((row, i) => (
                      <tr key={i} className="border-b border-line last:border-0">
                        {r.columns.map((c, j) => (
                          <td key={c.key} className={`px-4 py-1.5 ${["qty", "money", "days", "pct"].includes(c.kind) ? "num text-right" : ""}`}>
                            {j === 1 && r.productIds[i] ? (
                              <Link href={`/app/inventory/${r.productIds[i]}`} className="text-ink hover:text-signal">{fmt(row[c.key], c)}</Link>
                            ) : (
                              fmt(row[c.key], c)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
            {r.notes.length > 0 && (
              <ul className="space-y-0.5 border-t border-line px-4 py-3 text-xs text-muted">
                {r.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            {r.tool === "reorder_candidates" && !r.empty && (
              <div className="border-t border-line px-4 py-3 text-sm">
                <Link href="/app/purchasing" className="font-medium text-signal hover:underline">Review these in the purchase list</Link> — orders are only created when you do it there.
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}
