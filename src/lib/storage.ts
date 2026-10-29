import "server-only";
import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

/**
 * Private object storage. Keys are always `<businessId>/<area>/<uuid>`; nothing is ever served publicly —
 * files are streamed back only through route handlers that check tenant membership first.
 *
 *  - local: files under STORAGE_DIR (development / single-server self-hosting)
 *  - s3:    any S3-compatible bucket (Supabase Storage S3 endpoint, Cloudflare R2, AWS S3), signed with SigV4
 */
export interface ObjectStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  removePrefix(prefix: string): Promise<void>;
}

export function objectKey(businessId: string, area: "imports" | "invoices" | "reports", id: string) {
  if (!/^[0-9a-f-]{36}$/.test(businessId) || !/^[0-9a-zA-Z._-]{1,80}$/.test(id)) throw new Error("invalid storage key part");
  return `${businessId}/${area}/${id}`;
}

class LocalStore implements ObjectStore {
  constructor(private root: string) {}
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error("path traversal blocked");
    return p;
  }
  async put(key: string, body: Buffer) {
    const p = this.resolve(key);
    await mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
    await writeFile(p, body, { mode: 0o600 });
  }
  async get(key: string) {
    return readFile(this.resolve(key));
  }
  async remove(key: string) {
    await rm(this.resolve(key), { force: true });
  }
  async removePrefix(prefix: string) {
    await rm(this.resolve(prefix.replace(/\/$/, "")), { recursive: true, force: true });
  }
}

class S3Store implements ObjectStore {
  constructor(
    private endpoint: string,
    private region: string,
    private bucket: string,
    private accessKey: string,
    private secretKey: string,
  ) {}

  private async request(method: string, key: string, body?: Buffer, contentType?: string, query = "") {
    const url = new URL(`${this.endpoint.replace(/\/$/, "")}/${this.bucket}/${key.split("/").map(encodeURIComponent).join("/")}${query}`);
    const payloadHash = createHash("sha256").update(body ?? Buffer.alloc(0)).digest("hex");
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
    if (contentType) headers["content-type"] = contentType;
    const signedHeaders = Object.keys(headers).sort().join(";");
    const canonicalQuery = [...url.searchParams.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    const canonical = [method, url.pathname, canonicalQuery, Object.keys(headers).sort().map((h) => `${h}:${headers[h]}\n`).join(""), signedHeaders, payloadHash].join("\n");
    const scope = `${date}/${this.region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
    const kDate = createHmac("sha256", `AWS4${this.secretKey}`).update(date).digest();
    const kRegion = createHmac("sha256", kDate).update(this.region).digest();
    const kService = createHmac("sha256", kRegion).update("s3").digest();
    const kSigning = createHmac("sha256", kService).update("aws4_request").digest();
    const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const res = await fetch(url, { method, headers, body: body ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(30_000) });
    if (!res.ok && !(method === "DELETE" && res.status === 404)) throw new Error(`Storage ${method} failed with HTTP ${res.status}`);
    return res;
  }
  async put(key: string, body: Buffer, contentType: string) {
    await this.request("PUT", key, body, contentType);
  }
  async get(key: string) {
    return Buffer.from(await (await this.request("GET", key)).arrayBuffer());
  }
  async remove(key: string) {
    await this.request("DELETE", key);
  }
  async removePrefix(prefix: string) {
    const res = await this.request("GET", "", undefined, undefined, `?list-type=2&prefix=${encodeURIComponent(prefix)}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) await this.remove(m[1]);
  }
}

let store: ObjectStore | undefined;
export function storage(): ObjectStore {
  if (store) return store;
  const e = env();
  if (e.STORAGE_DRIVER === "s3") {
    if (!e.S3_ENDPOINT || !e.S3_BUCKET || !e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY) {
      throw new Error("STORAGE_DRIVER=s3 requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY");
    }
    store = new S3Store(e.S3_ENDPOINT, e.S3_REGION, e.S3_BUCKET, e.S3_ACCESS_KEY_ID, e.S3_SECRET_ACCESS_KEY);
  } else {
    store = new LocalStore(path.resolve(e.STORAGE_DIR));
  }
  return store;
}

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
