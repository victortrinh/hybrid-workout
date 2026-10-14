-- Recovery data (CONTEXT.md, Recovery data): one night per morning, sent by
-- the iOS Shortcut from Apple Health, filtered to the ring (ADR-0003). The
-- date is the morning the night ends on; a resend of the same morning
-- replaces it, so the Shortcut can run twice without harm.
create table recovery_nights (
  date text primary key,
  sleep_minutes integer not null check (sleep_minutes between 0 and 1440),
  hrv_ms integer check (hrv_ms between 1 and 300),
  resting_heart_rate integer check (resting_heart_rate between 20 and 150),
  source text not null,
  received_at text not null
);
