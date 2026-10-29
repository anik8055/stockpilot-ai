import { fieldsFor, normalizeHeader, type ImportKind } from "./fields";

export type Mapping = Record<string, number | null>; // fieldKey → column index

export type MappingSuggestion = {
  mapping: Mapping;
  confidence: Record<string, "exact" | "partial" | "none">;
  /** Fields where more than one column could fit, or one column fits several fields. The user must confirm. */
  ambiguities: { field: string; candidates: number[]; message: string }[];
  missingRequired: string[];
  needsConfirmation: boolean;
  kindHints: string[];
};

/** Finds the header row in the first rows of a sheet (billing exports often start with company name rows). */
export function detectHeaderRow(rows: string[][], kind: ImportKind, maxScan = 25): number {
  const fields = fieldsFor(kind);
  const all = new Set(fields.flatMap((f) => f.synonyms));
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    const cells = rows[i].map(normalizeHeader).filter(Boolean);
    if (cells.length < 2) continue;
    const matches = cells.filter((c) => all.has(c)).length;
    const partial = cells.filter((c) => !all.has(c) && [...all].some((s) => s.length > 3 && c.includes(s))).length;
    const numeric = cells.filter((c) => /^[\d.,\s-]+$/.test(c)).length;
    const score = matches * 3 + partial - numeric * 2;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore > 0 ? best : 0;
}

export function suggestMapping(headers: string[], kind: ImportKind): MappingSuggestion {
  const fields = fieldsFor(kind);
  const norm = headers.map(normalizeHeader);
  const mapping: Mapping = {};
  const confidence: MappingSuggestion["confidence"] = {};
  const ambiguities: MappingSuggestion["ambiguities"] = [];
  const claimed = new Map<number, string>();

  // Pass 1: exact synonym matches, in field priority order; earlier synonyms win.
  const exactCandidates = new Map<string, number[]>();
  for (const f of fields) {
    const cands: number[] = [];
    norm.forEach((h, idx) => {
      if (h && f.synonyms.includes(h)) cands.push(idx);
    });
    exactCandidates.set(f.key, cands);
  }

  for (const f of fields) {
    const cands = (exactCandidates.get(f.key) ?? []).filter((c) => !claimed.has(c));
    if (cands.length === 0) continue;
    // Prefer the candidate whose header appears earliest in the synonym list (more specific spellings first).
    cands.sort((a, b) => f.synonyms.indexOf(norm[a]) - f.synonyms.indexOf(norm[b]));
    const pick = cands[0];
    mapping[f.key] = pick;
    confidence[f.key] = "exact";
    claimed.set(pick, f.key);
    const sameRank = cands.filter((c) => f.synonyms.indexOf(norm[c]) === f.synonyms.indexOf(norm[pick]));
    if (cands.length > 1) {
      ambiguities.push({
        field: f.key,
        candidates: cands,
        message: `Several columns could be "${f.label}": ${cands.map((c) => `"${headers[c]}"`).join(", ")}. ${sameRank.length > 1 ? "Please choose one." : `We picked "${headers[pick]}" — please confirm.`}`,
      });
    }
  }

  // Pass 2: partial matches for unmapped fields (header contains a synonym of length ≥ 4).
  for (const f of fields) {
    if (mapping[f.key] !== undefined) continue;
    const cands: number[] = [];
    norm.forEach((h, idx) => {
      if (!h || claimed.has(idx)) return;
      if (f.synonyms.some((s) => s.length >= 4 && (h.includes(s) || (h.length >= 4 && s.includes(h))))) cands.push(idx);
    });
    if (cands.length === 0) {
      mapping[f.key] = null;
      confidence[f.key] = "none";
      continue;
    }
    mapping[f.key] = cands[0];
    confidence[f.key] = "partial";
    claimed.set(cands[0], f.key);
    ambiguities.push({
      field: f.key,
      candidates: cands,
      message: `"${headers[cands[0]]}" looks like "${f.label}" but is not an exact match — please confirm.`,
    });
  }

  const missingRequired = fields.filter((f) => f.required && mapping[f.key] === null).map((f) => f.label);
  const kindHints = detectKindMismatch(norm, kind);

  return {
    mapping,
    confidence,
    ambiguities,
    missingRequired,
    needsConfirmation: ambiguities.length > 0 || missingRequired.length > 0,
    kindHints,
  };
}

function detectKindMismatch(norm: string[], kind: ImportKind): string[] {
  const has = (...names: string[]) => names.some((n) => norm.includes(n));
  const hints: string[] = [];
  const looksTransactional = has("date", "invoice date", "bill date", "voucher date") && has("invoice no", "bill no", "voucher no", "invoice number");
  if (kind === "stock_snapshot" && looksTransactional) {
    hints.push("This file has dates and invoice numbers — it may be a sales or purchase report rather than stock balances. Importing sales as stock would overwrite your stock levels.");
  }
  if (kind === "sales" && !has("date", "invoice date", "bill date", "sale date", "voucher date", "transaction date", "txn date")) {
    hints.push("No date column was found. Sales history needs a date for every row — is this a stock balance file instead?");
  }
  if (kind === "sales" && has("closing stock", "closing qty", "closing balance")) {
    hints.push('The file has a "closing stock" column, which is typical of stock balance reports, not sales.');
  }
  return hints;
}

/** Signature of a header row, used to offer saved mappings for files with the same layout. */
export function headerSignature(headers: string[]): string {
  return headers.map(normalizeHeader).filter(Boolean).join("|");
}

/** Applies a saved mapping (by header name) to a new file's headers. Unknown headers become unmapped. */
export function applySavedMapping(saved: Record<string, string | null>, headers: string[]): Mapping {
  const norm = headers.map(normalizeHeader);
  const out: Mapping = {};
  for (const [field, headerName] of Object.entries(saved)) {
    if (headerName === null) {
      out[field] = null;
      continue;
    }
    const idx = norm.indexOf(normalizeHeader(headerName));
    out[field] = idx >= 0 ? idx : null;
  }
  return out;
}

export function mappingToHeaderNames(mapping: Mapping, headers: string[]): Record<string, string | null> {
  return Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, v === null || v === undefined ? null : headers[v] ?? null]));
}
