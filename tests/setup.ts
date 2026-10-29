// Integration tests use a dedicated database. Never point these at a real customer database.
process.env.DATABASE_URL ??= "postgres://stockpilot_app:stockpilot_app@localhost:5432/stockpilot_test";
process.env.DATABASE_ADMIN_URL ??= "postgres://stockpilot:stockpilot@localhost:5432/stockpilot_test";
process.env.STORAGE_DRIVER ??= "local";
process.env.STORAGE_DIR ??= "./.data/test-storage";
process.env.AI_PROVIDER ??= "none";
(process.env as Record<string, string>).NODE_ENV ??= "test";
