-- A Live Strength session's log (CONTEXT.md, Working weight): one Set log per
-- set, with its lift, load in pounds, reps and RPE. The Coach replays them to
-- find and progress each Working weight. A log's sets are replaced whole
-- whenever the log itself is.
create table set_logs (
  session_log_id text not null references session_logs (id) on delete cascade,
  exercise integer not null check (exercise between 0 and 19),
  "set" integer not null check ("set" between 1 and 20),
  lift text,
  pounds integer check (pounds between 0 and 1000 and pounds % 5 = 0),
  reps integer not null check (reps between 0 and 100),
  rpe integer not null check (rpe between 1 and 10),
  primary key (session_log_id, exercise, "set")
);
