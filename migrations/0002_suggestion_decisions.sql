-- Suggestion decisions (CONTEXT.md, Suggestion): the athlete's Accept, Keep or
-- Undo. The Coach derives Suggestions from the logs, so only the decision is
-- stored, keyed by the Suggestion's id. On sync the later updated_at wins.
create table suggestion_decisions (
  id text primary key,
  decision text not null check (decision in ('open', 'accepted', 'kept')),
  date text not null,
  updated_at text not null
);
