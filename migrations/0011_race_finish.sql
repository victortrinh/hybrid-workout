-- The race's finish time (CONTEXT.md, Race day), asked for the day after.
-- A HYROX takes longer than result_seconds lets a 5K test take, so it has a
-- column of its own; the Session log carries either as its result.
alter table session_logs add column finish_seconds integer check (finish_seconds between 1800 and 14400);
