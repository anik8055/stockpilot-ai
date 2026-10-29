import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { env } from "@/lib/env";

const run = promisify(execFile);

export type FileKind = "pdf" | "png" | "jpeg" | "webp";

/** Decides the type from magic bytes. Anything else is rejected before storage. */
export function sniffInvoiceFile(buf: Buffer): FileKind | null {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return "png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length > 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
}

export const MIME: Record<FileKind, string> = { pdf: "application/pdf", png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };

export type TextResult =
  | { ok: true; text: string; method: "pdf_text" | "ocr_tesseract"; pages: number }
  | { ok: false; reason: "scanned_pdf_no_ocr" | "image_no_ocr" | "unreadable" | "too_many_pages" | "ocr_failed"; message: string };

const MAX_PAGES = 10;

/**
 * Extracts text. PDFs use their text layer (pdf.js with eval disabled — embedded scripts never run).
 * Scanned PDFs and photos need OCR; when no OCR provider is configured we say so instead of guessing.
 */
export async function extractInvoiceText(buf: Buffer, kind: FileKind): Promise<TextResult> {
  if (kind === "pdf") {
    let text = "";
    let pages = 0;
    try {
      const { getDocumentProxy, extractText } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf), { isEvalSupported: false, disableFontFace: true } as never);
      pages = pdf.numPages;
      if (pages > MAX_PAGES) return { ok: false, reason: "too_many_pages", message: `Invoices longer than ${MAX_PAGES} pages are not supported.` };
      const res = await extractText(pdf, { mergePages: true });
      text = String(res.text ?? "");
    } catch {
      return { ok: false, reason: "unreadable", message: "This PDF could not be read. It may be damaged or password-protected." };
    }
    if (text.replace(/\s+/g, "").length >= 40) return { ok: true, text, method: "pdf_text", pages };
    if (env().OCR_PROVIDER === "tesseract_cli") return ocrPdf(buf, pages);
    return { ok: false, reason: "scanned_pdf_no_ocr", message: "This PDF is a scanned image with no text layer. OCR is not configured, so it cannot be read automatically — enter the lines manually or upload a text PDF." };
  }
  if (env().OCR_PROVIDER === "tesseract_cli") return ocrImage(buf, kind);
  return { ok: false, reason: "image_no_ocr", message: "Photos and scans need OCR, which is not configured for this workspace. Enter the lines manually, or upload the supplier's PDF invoice." };
}

async function withTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sp-ocr-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function tesseract(file: string): Promise<string> {
  const { stdout } = await run(env().TESSERACT_PATH, [file, "stdout", "-l", "eng", "--psm", "6"], { timeout: 45_000, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

async function ocrImage(buf: Buffer, kind: FileKind): Promise<TextResult> {
  try {
    return await withTemp(async (dir) => {
      const f = path.join(dir, `in.${kind === "jpeg" ? "jpg" : kind}`);
      await writeFile(f, buf);
      const text = await tesseract(f);
      return text.trim() ? { ok: true as const, text, method: "ocr_tesseract" as const, pages: 1 } : { ok: false as const, reason: "ocr_failed" as const, message: "No text could be recognised in this image." };
    });
  } catch {
    return { ok: false, reason: "ocr_failed", message: "OCR failed for this image." };
  }
}

async function ocrPdf(buf: Buffer, pages: number): Promise<TextResult> {
  if (pages > MAX_PAGES) return { ok: false, reason: "too_many_pages", message: `Invoices longer than ${MAX_PAGES} pages are not supported.` };
  try {
    return await withTemp(async (dir) => {
      const f = path.join(dir, "in.pdf");
      await writeFile(f, buf);
      await run("pdftoppm", ["-r", "200", "-gray", "-png", f, path.join(dir, "p")], { timeout: 60_000 });
      const imgs = (await readdir(dir)).filter((x) => x.startsWith("p") && x.endsWith(".png")).sort();
      let text = "";
      for (const img of imgs) text += (await tesseract(path.join(dir, img))) + "\n";
      return text.trim() ? { ok: true as const, text, method: "ocr_tesseract" as const, pages } : { ok: false as const, reason: "ocr_failed" as const, message: "No text could be recognised." };
    });
  } catch {
    return { ok: false, reason: "ocr_failed", message: "OCR failed for this scanned PDF (pdftoppm and tesseract are required on the server)." };
  }
}
