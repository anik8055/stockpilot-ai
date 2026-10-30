import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pgConnectionConfig } from "../../db/pg-config.mjs";
import { classifyDbError, LATEST_MIGRATION } from "@/lib/db";

describe("database setup diagnostics", () => {
  it("LATEST_MIGRATION matches the newest migration file", () => {
    const files = readdirSync(path.join(process.cwd(), "db", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(LATEST_MIGRATION).toBe(files.at(-1));
  });

  it("turns common hosting errors into fix hints without echoing secrets", () => {
    const tls = Object.assign(new Error("self-signed certificate in certificate chain"), { code: "SELF_SIGNED_CERT_IN_CHAIN" });
    expect(classifyDbError(tls).problem).toBe("tls_certificate_not_trusted");
    expect(classifyDbError(new Error("Tenant or user not found")).problem).toBe("pooler_user_not_found");
    expect(classifyDbError(Object.assign(new Error('password authentication failed for user "x"'), { code: "28P01" }))).toMatchObject({ problem: "wrong_password" });
    expect(classifyDbError(Object.assign(new Error('relation "users" does not exist'), { code: "42P01" })).problem).toBe("tables_missing");
    expect(classifyDbError(Object.assign(new Error("getaddrinfo ENOTFOUND db.x"), { code: "ENOTFOUND" })).problem).toBe("host_not_found");
    const secret = Object.assign(new Error("boom postgres://u:supersecret@h/db"), { code: "XX999" });
    expect(JSON.stringify(classifyDbError(secret))).not.toContain("supersecret");
  });

  it("uses the CA certificate for verified TLS and drops URL ssl settings", () => {
    expect(pgConnectionConfig("postgres://u:p@h:5432/db?sslmode=require", "")).toEqual({ connectionString: "postgres://u:p@h:5432/db?sslmode=require" });
    const cfg = pgConnectionConfig("postgres://u:p@h:6543/postgres?sslmode=require&application_name=sp", "-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----");
    expect(cfg.connectionString).toBe("postgres://u:p@h:6543/postgres?application_name=sp");
    expect(cfg.ssl).toEqual({ ca: "-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----", rejectUnauthorized: true });
  });
});
