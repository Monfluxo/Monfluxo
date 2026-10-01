create table if not exists public.wallet_entity_labels (
  address text primary key,
  label text,
  category text not null default 'UNKNOWN',
  entity_type text,
  confidence text not null default 'unknown' check (confidence in ('unknown','low','medium','high','verified')),
  source text not null default 'manual',
  clusterable boolean not null default true,
  tags jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wallet_entity_labels_category_idx
  on public.wallet_entity_labels(category);

create index if not exists wallet_entity_labels_clusterable_idx
  on public.wallet_entity_labels(clusterable);

alter table public.wallet_entity_labels enable row level security;
revoke all on table public.wallet_entity_labels from anon, authenticated;
grant select, insert, update, delete on table public.wallet_entity_labels to service_role;
