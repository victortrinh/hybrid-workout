-- Activities (CONTEXT.md, Activity): workouts from the watch, sent from Apple
-- Health by the Workout Shortcut (ADR-0004). Keyed on the start instant, so a
-- resend of the same workout replaces it. Matching to Sessions is the Coach's,
-- on the device; only the athlete's answers to "Which Session was this?" are stored.
create table activities (
  id text primary key,
  date text not null,
  workout_type text not null,
  minutes integer not null check (minutes between 0 and 600),
  distance_meters integer check (distance_meters between 1 and 100000),
  average_heart_rate integer,
  max_heart_rate integer,
  indoor integer check (indoor in (0, 1)),
  received_at text not null
);

create index activities_date on activities (date);

-- Both null: "none of these". Later updated_at wins on sync.
create table activity_answers (
  activity_id text primary key,
  week integer,
  session_id text,
  updated_at text not null
);
