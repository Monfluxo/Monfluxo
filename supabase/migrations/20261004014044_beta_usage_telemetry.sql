-- Compact aggregates: one row per account/wallet, not one row per HTTP request.
alter table public.credit_accounts add column last_login_at timestamptz;
alter table public.credit_requests add column indexed_transactions bigint not null default 0 check(indexed_transactions>=0),
 add column failure_reason text;
create table public.credit_wallet_usage (
 account_id uuid not null references public.credit_accounts(id) on delete cascade,
 wallet_address text not null, opens bigint not null default 0 check(opens>=0),
 first_opened_at timestamptz not null default now(), last_opened_at timestamptz not null default now(),
 primary key(account_id,wallet_address)
);
create index credit_wallet_usage_wallet on public.credit_wallet_usage(wallet_address);
alter table public.credit_wallet_usage enable row level security;
revoke all on public.credit_wallet_usage from public,anon,authenticated;
grant all on public.credit_wallet_usage to service_role;

alter function public.credit_login(text,text) rename to credit_login_core;
create function public.credit_login(p_code_hash text,p_token_hash text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare a uuid;
begin
 a:=public.credit_login_core(p_code_hash,p_token_hash);
 update public.credit_accounts set last_login_at=now() where id=a;
 return a;
end $$;

alter function public.credit_wallet_request(uuid,text,integer) rename to credit_wallet_request_core;
create function public.credit_wallet_request(p_account uuid,p_wallet text,p_extend integer default 0) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r jsonb;
begin
 r:=public.credit_wallet_request_core(p_account,p_wallet,p_extend);
 -- Explicit successful opens only. GET polling and extensions never increment opens.
 if p_extend in (-1,0) then
  insert into public.credit_wallet_usage(account_id,wallet_address,opens) values(p_account,p_wallet,1)
  on conflict(account_id,wallet_address) do update set opens=public.credit_wallet_usage.opens+1,last_opened_at=now();
 end if;
 return r;
end $$;

create function public.credit_track_indexed_transactions() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if current_setting('monfluxo.counter_reconciliation',true)='true' then return new; end if;
 update public.credit_requests set indexed_transactions=greatest(indexed_transactions,
  greatest(0,least(coalesce(new.transactions_scanned,0),target_transactions)-start_transactions))
 where wallet_address=new.wallet_address and status='pending';
 return new;
end $$;
-- Before settlement closes the reservation; later wallet extensions cannot inflate old counts.
create trigger credit_track_indexed_transactions before update of transactions_scanned on public.wallet_sync_state
for each row execute function public.credit_track_indexed_transactions();

create function public.credit_admin_usage() returns jsonb
language sql security invoker set search_path='' as $$
with usage as (
 select account_id,sum(opens) opens,count(*) wallets,max(last_opened_at) last_opened_at
 from public.credit_wallet_usage group by account_id
), requests as (
 select r.account_id,count(*) filter(where r.kind='analysis') analyses,
 count(*) filter(where r.kind='extension') extensions,sum(r.indexed_transactions) transactions,max(r.created_at) last_request_at,
 sum(r.reserved-r.charged) filter(where r.status='pending') reserved,
 count(*) filter(where r.status='complete') completed,
 count(*) filter(where r.status='failed') failed,
 count(*) filter(where r.status='pending' and j.status='paused') paused,
 count(*) filter(where r.status='pending' and coalesce(j.status,'')<>'paused') pending,
 (array_agg(coalesce(r.failure_reason,case when r.status='pending' then j.last_error end) order by r.created_at desc) filter(where r.failure_reason is not null or (r.status='pending' and j.last_error is not null)))[1] last_error
 from public.credit_requests r left join public.wallet_index_jobs j on j.wallet_address=r.wallet_address group by r.account_id
), spent as (
 select account_id,-sum(delta) consumed from public.credit_ledger where delta<0 group by account_id
), accounts as (
 select a.id,a.label,a.plan,a.is_owner,
 case when a.disabled then 'disabled' when a.expires_at<=now() then 'expired' else 'active' end status,
 a.expires_at,greatest(a.last_login_at,u.last_opened_at,r.last_request_at) last_activity,
 coalesce(u.opens,0) opens,coalesce(u.wallets,0) wallets,coalesce(r.analyses,0) analyses,
 coalesce(r.extensions,0) extensions,coalesce(r.transactions,0) transactions,
 coalesce(s.consumed,0) credits_consumed,coalesce(r.reserved,0) credits_reserved,
 case when a.expires_at<=now() then 0 else greatest(0,a.cycle_credits+a.bonus_credits-coalesce(r.reserved,0)) end credits_available,
 coalesce(r.completed,0) completed,coalesce(r.failed,0) failed,coalesce(r.paused,0) paused,coalesce(r.pending,0) pending,r.last_error
 from public.credit_accounts a left join usage u on u.account_id=a.id left join requests r on r.account_id=a.id left join spent s on s.account_id=a.id
), beta as (select * from accounts where plan='beta' and not is_owner), popular as (
 select u.wallet_address,sum(u.opens) opens,count(*) users,max(u.last_opened_at) last_opened_at,
 coalesce(w.transaction_count,0) transactions_indexed
 from public.credit_wallet_usage u join public.credit_accounts a on a.id=u.account_id
 left join public.wallets w on w.address=u.wallet_address
 where not a.is_owner and a.plan='beta'
 group by u.wallet_address,w.transaction_count order by sum(u.opens) desc,count(*) desc,u.wallet_address limit 25
)
select jsonb_build_object(
 'updatedAt',now(),
 'summary',jsonb_build_object('testers',(select count(*) from beta),'active24h',(select count(*) from beta where last_activity>=now()-interval '24 hours'),
 'opens',(select coalesce(sum(opens),0) from beta),'newTransactions',(select coalesce(sum(transactions),0) from beta),
 'creditsConsumed',(select coalesce(sum(credits_consumed),0) from beta),'pending',(select coalesce(sum(pending),0) from beta),
 'paused',(select coalesce(sum(paused),0) from beta),'failed',(select coalesce(sum(failed),0) from beta)),
 'testers',coalesce((select jsonb_agg(b order by b.last_activity desc nulls last,b.label) from beta b),'[]'::jsonb),
 'invitations',coalesce((select jsonb_agg(jsonb_build_object('label',i.label,'created_at',i.created_at,'status',case when i.revoked then 'revoked' else 'not_activated' end) order by i.created_at desc)
 from public.credit_invites i where i.account_id is null),'[]'::jsonb),
 'owners',coalesce((select jsonb_agg(a) from accounts a where is_owner),'[]'::jsonb),
 'popularWallets',coalesce((select jsonb_agg(p order by p.opens desc,p.users desc,p.wallet_address) from popular p),'[]'::jsonb));
$$;
revoke all on function public.credit_login(text,text),public.credit_wallet_request(uuid,text,integer),public.credit_track_indexed_transactions(),public.credit_admin_usage() from public,anon,authenticated;
grant execute on function public.credit_login(text,text),public.credit_wallet_request(uuid,text,integer),public.credit_track_indexed_transactions(),public.credit_admin_usage() to service_role;

create function public.credit_track_failed_request() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.status='error' or (new.status='paused' and coalesce(new.last_error,'')<>'analysis_budget_exhausted') then
  update public.credit_requests set failure_reason=left(coalesce(new.last_error,'Index job failed'),1000)
   where wallet_address=new.wallet_address and status='pending';
 end if;
 return new;
end $$;
create trigger credit_track_failed_request before update of status on public.wallet_index_jobs
for each row execute function public.credit_track_failed_request();
revoke all on function public.credit_track_failed_request() from public,anon,authenticated;
grant execute on function public.credit_track_failed_request() to service_role;
