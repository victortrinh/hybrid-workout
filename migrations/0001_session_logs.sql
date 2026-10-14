-- Session logs (CONTEXT.md): what actually happened in a Session. Ids come
-- from the device; on sync the later updated_at wins, per log.
create table session_logs (
  id text primary key,
  week integer not null,
  session_id text not null,
  date text not null,
  status text not null check (status in ('done', 'partial', 'skipped', 'swapped')),
  minutes integer,
  rpe integer check (rpe between 1 and 10),
  notes text,
  updated_at text not null
);

create index session_logs_week on session_logs (week, session_id);
