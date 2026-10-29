-- One user question can make several model calls (routing + explanation). Quotas count questions, not calls.
ALTER TABLE ai_usage ADD COLUMN request_id uuid;
CREATE INDEX ai_usage_request_idx ON ai_usage (business_id, feature, created_at, request_id);
