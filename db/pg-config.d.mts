export function pgConnectionConfig(url: string, caPem?: string): { connectionString: string; ssl?: { ca: string; rejectUnauthorized: boolean } };
