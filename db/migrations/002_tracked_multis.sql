create table if not exists tracked_multis (
  id text primary key,
  slate_date date not null,
  size integer not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tracked_multis_slate_date_idx on tracked_multis (slate_date);
