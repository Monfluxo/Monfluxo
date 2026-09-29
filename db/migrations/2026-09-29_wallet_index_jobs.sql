create table if not exists public.wallet_index_jobs (
  wallet_address text primary key references public.wallets(address) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','complete','error')),
  priority integer not null default 100,
  attempts integer not null default 0,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create index if not exists wallet_index_jobs_status_priority_idx
  on public.wallet_index_jobs(status, priority desc, requested_at asc);

-- Backend-only infrastructure for now. Before exposing any direct browser access,
-- enable RLS and add explicit policies instead of relying on this setting.
alter table public.wallet_index_jobs disable row level security;

create or replace function public.claim_wallet_index_job()
returns setof public.wallet_index_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.wallet_index_jobs;
begin
  select * into claimed
  from public.wallet_index_jobs
  where status = 'queued'
  order by priority desc, requested_at asc
  for update skip locked
  limit 1;

  if claimed.wallet_address is null then
    return;
  end if;

  update public.wallet_index_jobs
  set status = 'running',
      attempts = attempts + 1,
      started_at = now(),
      last_error = null,
      updated_at = now()
  where wallet_address = claimed.wallet_address
  returning * into claimed;

  return next claimed;
end;
$$;

create or replace function public.enqueue_wallet_index_job(
  p_wallet_address text,
  p_priority integer default 100
)
returns public.wallet_index_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.wallet_index_jobs;
begin
  insert into public.wallet_index_jobs (
    wallet_address, status, priority, requested_at, updated_at
  ) values (
    p_wallet_address, 'queued', p_priority, now(), now()
  )
  on conflict (wallet_address) do update
  set priority = greatest(public.wallet_index_jobs.priority, excluded.priority),
      status = case
        when public.wallet_index_jobs.status = 'running' then 'running'
        else 'queued'
      end,
      requested_at = case
        when public.wallet_index_jobs.status = 'running' then public.wallet_index_jobs.requested_at
        else now()
      end,
      completed_at = case
        when public.wallet_index_jobs.status = 'running' then public.wallet_index_jobs.completed_at
        else null
      end,
      last_error = case
        when public.wallet_index_jobs.status = 'running' then public.wallet_index_jobs.last_error
        else null
      end,
      updated_at = now()
  returning * into result;

  return result;
end;
$$;

revoke all on function public.claim_wallet_index_job() from public;
revoke all on function public.enqueue_wallet_index_job(text, integer) from public;
grant execute on function public.claim_wallet_index_job() to service_role;
grant execute on function public.enqueue_wallet_index_job(text, integer) to service_role;
