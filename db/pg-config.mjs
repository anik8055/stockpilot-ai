// Builds node-postgres connection settings from a URL, with optional CA verification for managed databases.
//
// Why: recent node-postgres treats `sslmode=require` as full certificate verification, so providers whose certificate
// chains to their own root CA (e.g. Supabase) fail with "self-signed certificate in certificate chain" unless the CA is
// supplied. Set DATABASE_CA_CERT to the provider's CA certificate (PEM; "\n" escapes are accepted) to verify it
// properly. When a CA is given, SSL settings in the URL are replaced by { ca, rejectUnauthorized: true }.

/** @param {string} url @param {string | undefined} [caPem] */
export function pgConnectionConfig(url, caPem = process.env.DATABASE_CA_CERT) {
  const ca = caPem?.trim() ? caPem.replace(/\\n/g, "\n") : undefined;
  if (!ca) return { connectionString: url };
  const u = new URL(url);
  for (const k of ["sslmode", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) u.searchParams.delete(k);
  return { connectionString: u.toString(), ssl: { ca, rejectUnauthorized: true } };
}
