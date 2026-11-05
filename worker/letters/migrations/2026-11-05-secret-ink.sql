-- Secret Ink stores only a per-letter display preference. The original text stays
-- in letters.body; masking happens in the reader, never in storage.
ALTER TABLE letters ADD COLUMN secret_ink INTEGER NOT NULL DEFAULT 0;
