-- By-feel speeds (CONTEXT.md): the recovery jogs' pace, asked once at the end
-- of a Live run with by-feel reps, in seconds per km like every other pace.
-- Null on every log before it, and wherever the question was skipped.
alter table session_logs add column recovery_pace integer check (recovery_pace between 120 and 1200);
