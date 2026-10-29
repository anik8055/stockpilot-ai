/** Date helpers that work on calendar dates ('YYYY-MM-DD') without timezone drift. */

export type ISODate = string;

const DAY = 86_400_000;

export function toISODate(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function parseISODate(s: ISODate): Date {
  return new Date(`${s}T00:00:00Z`);
}

export function addDays(s: ISODate, n: number): ISODate {
  return toISODate(new Date(parseISODate(s).getTime() + n * DAY));
}

/** Inclusive number of days between two dates (a ≤ b). */
export function daysBetweenInclusive(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / DAY) + 1;
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / DAY);
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Today's date in a given IANA timezone (businesses default to Asia/Kolkata). */
export function todayIn(timezone = "Asia/Kolkata", now = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts; // en-CA formats as YYYY-MM-DD
}

const displayFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
export function formatDate(s: ISODate | Date | null | undefined): string {
  if (!s) return "—";
  const d = typeof s === "string" ? parseISODate(s.slice(0, 10)) : s;
  return displayFmt.format(d);
}
