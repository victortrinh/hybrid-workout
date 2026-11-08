-- Training paces from the Compromised run test (CONTEXT.md, Training paces).
-- The test's result is derived from its Station logs, the four run splits, so
-- the 5K test's result column goes. The race's finish keeps finish_seconds.
alter table session_logs drop column result_seconds;

-- The Starting point asks for an estimated 1 km split between Stations, in
-- seconds per km, instead of an estimated 5K time.
alter table starting_point add column split_seconds integer check (split_seconds between 150 and 600);
alter table starting_point drop column five_k_seconds;
