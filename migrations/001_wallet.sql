-- migrations/001_wallet.sql
create table if not exists wallets (
  user_id text primary key,
  coins integer not null default 0,
  paid_ever boolean not null default false,
  first_paid_date date,
  welcome_claimed boolean not null default false,
  expires_at bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists credits (
  id text primary key,           -- e.g., razorpay_payment_id or 'welcome:<userId>'
  user_id text not null,
  coins integer not null,
  meta jsonb,
  created_at timestamptz not null default now()
);

create table if not exists debits (
  id text primary key,           -- optional trace id (e.g., 'chat:<uuid>')
  user_id text not null,
  coins integer not null,
  meta jsonb,
  created_at timestamptz not null default now()
);

-- ✅ NEW: track raw payment facts (Razorpay/Cashfree/etc.)
create table if not exists payments (
  payment_id text primary key,
  email text,
  phone text,
  amount int,
  user_id text,
  pack text,
  status text,
  created_at timestamptz default now()
);
