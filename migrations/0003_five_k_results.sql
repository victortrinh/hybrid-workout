-- A 5K test's time and Environment (CONTEXT.md, 5K test). The latest Done
-- test sets the Training paces. Null on every other Session log.
alter table session_logs add column result_seconds integer check (result_seconds between 720 and 3600);
alter table session_logs add column environment text check (environment in ('indoor', 'outdoor'));
