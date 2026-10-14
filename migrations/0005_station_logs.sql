-- Station logs (CONTEXT.md, Station): a HYROX session's round times with the
-- loads and distances actually done, and a Race simulation's split on every
-- run and Station. A log's Station logs are replaced whole whenever the log
-- itself is. `part` is a Station id, 'run' or 'round'; loads are pounds per
-- implement, plates alone on a sled.
create table station_logs (
  session_log_id text not null references session_logs (id) on delete cascade,
  round integer not null check (round between 1 and 20),
  part text not null,
  pounds integer check (pounds between 0 and 1000),
  meters integer check (meters between 1 and 5000),
  reps integer check (reps between 1 and 500),
  seconds integer check (seconds between 0 and 10800),
  primary key (session_log_id, round, part)
);
