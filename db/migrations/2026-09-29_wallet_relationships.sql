create table if not exists public.wallet_relationships (
  wallet_a text not null,
  wallet_b text not null,
  relationship_score numeric not null check (relationship_score >= 0 and relationship_score <= 100),
  confidence text not null check (confidence in ('low','medium','high','very_high')),
  signals jsonb not null default '{}'::jsonb,
  evidence_count integer not null default 0,
  computed_at timestamptz not null default now(),
  primary key (wallet_a, wallet_b),
  check (wallet_a < wallet_b)
);

create index if not exists wallet_relationships_a_score_idx
  on public.wallet_relationships(wallet_a, relationship_score desc);

create index if not exists wallet_relationships_b_score_idx
  on public.wallet_relationships(wallet_b, relationship_score desc);

alter table public.wallet_relationships enable row level security;
revoke all on table public.wallet_relationships from anon, authenticated;
grant select, insert, update, delete on table public.wallet_relationships to service_role;
