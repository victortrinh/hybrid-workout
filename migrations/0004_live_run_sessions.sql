-- A Live run session's log (CONTEXT.md, Live session): the treadmill console's
-- distance on the Session log, and one Interval log per rep, Held it or
-- Changed. A log's reps are replaced whole whenever the log itself is.
alter table session_logs add column distance_meters integer check (distance_meters between 100 and 100000);

create table interval_logs (
  session_log_id text not null references session_logs (id) on delete cascade,
  block integer not null check (block between 0 and 99),
  rep integer not null check (rep between 1 and 99),
  target_pace integer check (target_pace between 120 and 1200),
  held integer not null check (held in (0, 1)),
  actual_pace integer check (actual_pace between 120 and 1200),
  primary key (session_log_id, block)
);
