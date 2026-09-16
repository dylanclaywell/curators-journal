-- The RuneLite sync store: one snapshot per account, replaced wholesale.
--
-- The payload is JSON text rather than a row per quest because nothing ever
-- queries *into* a snapshot. The plugin replaces the whole thing and the client
-- reads the whole thing, so a normalised table would mean ~200 row writes per
-- sync to answer a question nobody asks.
--
-- Two of the abuse caps from ROADMAP.md Phase 5 are enforced here rather than
-- in the handler, so they hold even if a future route forgets them:
--
--   * PRIMARY KEY on the account hash is "one row per key" — a writer can
--     replace their own row and can never accumulate rows.
--   * The length CHECK bounds what one row can cost. 64 KiB is roughly eight
--     times a full 214-quest snapshot, so it constrains only abuse.
--
-- STRICT rejects values of the wrong type instead of coercing them, which is
-- the same posture src/lib/sync.ts takes: refuse rather than repair.
CREATE TABLE snapshot (
  -- RuneLite's getAccountHash(), a decimal string. Unauthenticated: holding it
  -- is all it takes to read or write this row, which is a considered trade —
  -- see ROADMAP.md Phase 5, "No auth, deliberately".
  account_hash TEXT NOT NULL PRIMARY KEY,

  -- Mirrors the payload's own schemaVersion. Stored separately so a future
  -- migration can find rows in an old format without parsing every payload.
  schema_version INTEGER NOT NULL,

  -- The validated snapshot as JSON.
  payload TEXT NOT NULL CHECK (length(payload) <= 65536),

  -- Server-assigned ISO timestamp. The plugin's clock is not trusted, so this
  -- is written by the Worker on accept, never taken from the request body.
  received_at TEXT NOT NULL
) STRICT;
