-- Date before payment: riders pick their first session, we hold the seat while
-- they pay, and book it in Cal.com the moment Stripe confirms the payment.
-- Safe to run more than once. Already included at the end of schema.sql for new setups.

alter table orders add column if not exists first_event_type_id integer;
alter table orders add column if not exists first_start timestamptz;
alter table orders add column if not exists first_status text not null default 'none';
-- none: no date chosen before paying | pending: paid, being booked | booked | failed: taken while paying

create table if not exists holds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  event_type_id integer not null,
  start_at timestamptz not null,
  seats integer not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists holds_slot_idx on holds(event_type_id, start_at);
create index if not exists holds_order_idx on holds(order_id);
alter table holds enable row level security;

-- Hold seats for one order while it pays. p_free is the number of seats Cal.com
-- still has free. The advisory lock makes two riders checking out the same
-- session at the same moment queue up, so seats can't be promised twice.
create or replace function place_hold(
  p_order uuid, p_et integer, p_start timestamptz, p_seats integer, p_free integer, p_minutes integer
) returns boolean
language plpgsql
as $$
declare
  held integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_et::text || '|' || extract(epoch from p_start)::text));
  select coalesce(sum(seats), 0) into held
    from holds
   where event_type_id = p_et and start_at = p_start and expires_at > now() and order_id <> p_order;
  if held + p_seats > p_free then
    return false;
  end if;
  delete from holds where order_id = p_order;
  insert into holds(order_id, event_type_id, start_at, seats, expires_at)
  values (p_order, p_et, p_start, p_seats, now() + make_interval(mins => p_minutes));
  return true;
end;
$$;
