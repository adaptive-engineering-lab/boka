-- T071 — the delivery sweep (FR-040b, SC-006).
--
-- ===========================================================================
-- This is a durability backstop, not the retry mechanism.
--
-- Retrying with backoff (FR-040a) happens in `after()`, in `lib/inquiries/deliver.ts`, where
-- there is an HTTP client and an API key. Postgres has neither, and giving it one — pg_net is
-- installed and could technically POST to Resend — would put the notification logic in two
-- places, in two languages, with two sets of credentials. Principle V says no.
--
-- What this fixes is the case `after()` cannot: the function is frozen, killed, or redeployed
-- mid-retry. The row is left `pending` forever. The visitor was told their message was sent,
-- the record exists, and **the designer never hears about it** — the one outcome FR-040 and
-- SC-015 exist to prevent, and the only one invisible from every surface in the application.
--
-- So the sweep asks a single question: has anything been `pending` longer than delivery could
-- plausibly take? If so it is stranded, and marking it `undelivered` puts it on the dashboard
-- banner where the designer can act on it (FR-040b). Surfacing a lead that may in fact have
-- been emailed is a far better error than silently dropping one that was not.
-- ===========================================================================

create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- The timings are set by SC-006's five-minute notification budget, and they interlock:
--
--   `after()` finishes 3 attempts within seconds. Anything still pending after 3 minutes is
--   not slow, it is stranded — that is ~180x the expected duration.
--
--   The sweep runs every 2 minutes, so a stranded row waits at most 3 + 2 = 5 minutes before
--   it reaches the banner. The original design ran this every 15 minutes, which silently blew
--   the budget by a factor of three.
-- ---------------------------------------------------------------------------
create or replace function boka_sweep_stranded_inquiries()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  swept integer;
begin
  update inquiry
     set delivery_state = 'undelivered'
   where delivery_state = 'pending'
     and created_at < now() - interval '3 minutes';

  get diagnostics swept = row_count;
  return swept;
end;
$$;

comment on function boka_sweep_stranded_inquiries() is
  'FR-040b backstop. Marks inquiries stranded in `pending` as `undelivered` so they reach the '
  'dashboard banner. Does NOT send email — retries live in lib/inquiries/deliver.ts.';

-- Idempotent: unscheduling first means re-running this migration cannot leave two schedules
-- racing each other over the same rows.
do $$
begin
  perform cron.unschedule('boka-delivery-sweep');
exception
  when others then null;  -- not scheduled yet, which is the normal case on a fresh database
end;
$$;

select cron.schedule(
  'boka-delivery-sweep',
  '*/2 * * * *',
  $$select boka_sweep_stranded_inquiries();$$
);

-- ---------------------------------------------------------------------------
-- Assertion: the job exists and runs on the cadence SC-006 depends on.
--
-- A sweep that silently failed to schedule is indistinguishable from one that has nothing to
-- do — both leave an empty banner — so the absence has to be checked rather than assumed.
-- ---------------------------------------------------------------------------
do $$
declare
  found_schedule text;
begin
  select schedule into found_schedule
  from cron.job
  where jobname = 'boka-delivery-sweep';

  if found_schedule is null then
    raise exception 'FR-040b violation: the delivery sweep is not scheduled.';
  end if;

  if found_schedule <> '*/2 * * * *' then
    raise exception
      'SC-006 risk: the delivery sweep runs on "%" rather than every 2 minutes. A stranded '
      'inquiry must reach the banner within the 5-minute notification budget.', found_schedule;
  end if;
end;
$$;
