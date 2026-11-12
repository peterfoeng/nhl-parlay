create table if not exists slates (
  slate_date date primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists http_cache (
  cache_key text primary key,
  body text not null,
  fetched_at timestamptz not null
);
