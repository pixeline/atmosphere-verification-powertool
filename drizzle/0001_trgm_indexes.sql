-- Custom SQL migration file, put your code below! --
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS accounts_handle_trgm ON accounts USING gin (handle gin_trgm_ops);
CREATE INDEX IF NOT EXISTS accounts_desc_trgm ON accounts USING gin (description gin_trgm_ops);
