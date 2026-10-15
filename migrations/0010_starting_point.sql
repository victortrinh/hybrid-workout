-- The Starting point (CONTEXT.md, Starting point): the estimates given once
-- at first launch. One row, or none before the athlete has answered; a row
-- with every estimate null means both sections were skipped. An estimated 5K
-- time stands in for a 5K test until the first one; an estimated Working
-- weight starts that lift's calibration. On sync the later updated_at wins.
create table starting_point (
  id integer primary key check (id = 1),
  five_k_seconds integer check (five_k_seconds between 720 and 3600),
  back_squat_pounds integer check (back_squat_pounds between 5 and 1000),
  romanian_deadlift_pounds integer check (romanian_deadlift_pounds between 5 and 1000),
  updated_at text not null
);
