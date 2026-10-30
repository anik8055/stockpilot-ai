"use client";

import { ActionForm, SubmitButton } from "@/components/client";
import { weeklyEmailAction } from "./actions";

export function WeeklyEmailForm({ enabled }: { enabled: boolean }) {
  return (
    <ActionForm action={weeklyEmailAction} className="space-y-3">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={enabled} className="mt-0.5 h-4 w-4" />
        <span>Every Monday, create last week&apos;s report (Mon–Sun) and email a summary with a link to owners and administrators.</span>
      </label>
      <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
    </ActionForm>
  );
}
