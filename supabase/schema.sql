-- NDURE Labs booking schema. Run once in the Supabase SQL editor (EU region project).
-- Only the server (service role key) talks to these tables. Row level security is on
-- with no policies, so the public anon key can read nothing.

create extension if not exists pgcrypto;

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,                 -- private link for the rider: /order/<token>
  status text not null default 'pending'      -- pending | paid | refunded | expired
    check (status in ('pending', 'paid', 'refunded', 'expired')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,

  rider_name text not null,
  rider_email text not null,
  rider_phone text,
  ftp integer,
  goal text,

  qty integer not null check (qty between 1 and 10),
  unit_price numeric(10,2) not null,          -- euros per session at checkout
  total numeric(10,2) not null,               -- euros, quoted total before any discount code
  amount_paid numeric(10,2),                  -- euros, what Stripe actually charged
  addons jsonb not null default '[]'::jsonb,  -- e.g. ["call","plan"]
  credits_left integer not null default 0,

  partner boolean not null default false,
  partner_name text,
  partner_email text,
  partner_token text unique,                  -- private link for the partner's consent page
  partner_used boolean not null default false,
  partner_consents jsonb,                     -- filled in by the partner themselves

  consents jsonb not null,                    -- rider consents with timestamp and wording version
  consent_version text not null,
  src text,                                   -- attribution, e.g. instagram
  stripe_session_id text unique
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null default 'booked' check (status in ('booked', 'cancelled')),
  event_type_id integer not null,
  label text not null,                        -- Morning / Afternoon
  start_at timestamptz not null,
  end_at timestamptz,
  cal_uid text not null,                      -- Cal.com booking uid for the rider
  seat_uid text,                              -- Cal.com seat uid for the rider (seated events)
  with_partner boolean not null default false,
  partner_cal_uid text,
  partner_seat_uid text,
  cancelled_at timestamptz,
  credit_returned boolean not null default false
);

create index if not exists bookings_order_idx on bookings(order_id);
create index if not exists bookings_start_idx on bookings(start_at);
create index if not exists bookings_cal_uid_idx on bookings(cal_uid);
create index if not exists bookings_seat_uid_idx on bookings(seat_uid);

alter table orders enable row level security;
alter table bookings enable row level security;

-- Take one session credit, only if the order is paid and has credits left.
-- Returns true when a credit was taken. Atomic, so two tabs can't spend the same credit.
create or replace function use_credit(p_order uuid)
returns boolean
language plpgsql
as $$
declare
  n integer;
begin
  update orders
     set credits_left = credits_left - 1
   where id = p_order and status = 'paid' and credits_left > 0;
  get diagnostics n = row_count;
  return n = 1;
end;
$$;

create or replace function return_credit(p_order uuid)
returns void
language sql
as $$
  update orders set credits_left = credits_left + 1 where id = p_order;
$$;

-- ---------- Date before payment (same as 002_date_before_pay.sql) ----------
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
