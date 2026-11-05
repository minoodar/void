-- Symbolic presence is an optional, fixed-vocabulary display mark chosen in the
-- composer. NULL means "no mark" and is also the value of every pre-existing row;
-- this migration therefore adds the column without rewriting any letter.
ALTER TABLE letters ADD COLUMN presence TEXT DEFAULT NULL;
