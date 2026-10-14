-- Pain reports (CONTEXT.md, Pain report): 0 for "No", otherwise 1–10 with a
-- body area, and the Session it was given for, if any. The Coach reads the
-- latest one; on sync the later updated_at wins.
create table pain_reports (
  id text primary key,
  date text not null,
  score integer not null check (score between 0 and 10),
  area text check (area in ('achilles-calf', 'shin', 'knee', 'hip', 'back', 'other')),
  week integer check (week >= 1),
  session_id text,
  updated_at text not null,
  check ((score = 0) = (area is null)),
  check ((week is null) = (session_id is null))
);
