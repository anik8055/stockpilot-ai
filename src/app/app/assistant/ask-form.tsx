"use client";

import { useRef } from "react";
import { ActionForm, SubmitButton } from "@/components/client";
import { askAction } from "./actions";

const SUGGESTIONS = [
  "Which 20 products should I consider ordering this week?",
  "Which products have not sold in 90 days?",
  "How much money is tied up in slow-moving stock?",
  "Which suppliers account for the largest share of my purchases?",
  "What changed in my stock position this month?",
  "Show me items with rising demand and low remaining stock.",
];

export function AskForm() {
  const input = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLDivElement>(null);
  return (
    <div ref={form}>
      <ActionForm action={askAction} className="space-y-3" resetOnSuccess>
        <label htmlFor="question" className="sr-only">Your question</label>
        <textarea
          ref={input}
          id="question"
          name="question"
          rows={2}
          maxLength={500}
          required
          placeholder="Ask about your stock, e.g. which items should I order this week?"
          className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/20"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">Answers use your workspace data only. The assistant cannot place orders or change stock.</p>
          <SubmitButton pendingLabel="Looking at your data…">Ask</SubmitButton>
        </div>
      </ActionForm>
      <div className="mt-3 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className="rounded-full border border-line bg-surface px-3 py-1 text-left text-xs text-ink hover:border-signal hover:bg-signal-soft"
            onClick={() => {
              if (!input.current) return;
              input.current.value = s;
              input.current.form?.requestSubmit();
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
