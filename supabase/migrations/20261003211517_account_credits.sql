-- Private invitations are login credentials: store only SHA-256 hashes.
create table public.credit_accounts (
 id uuid primary key default gen_random_uuid(), label text not null,
 plan text not null default 'beta' check(plan in ('beta','pro')),
 cycle_started_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '30 days',
 cycle_credits integer not null default 50 check(cycle_credits>=0),
 bonus_credits integer not null default 0 check(bonus_credits>=0),
 disabled boolean not null default false
);
create table public.credit_invites (
 code_hash text primary key, label text not null, account_id uuid references public.credit_accounts(id),
 created_at timestamptz not null default now(), revoked boolean not null default false
);
create table public.credit_sessions (
 token_hash text primary key, account_id uuid not null references public.credit_accounts(id) on delete cascade,
 expires_at timestamptz not null
);
create index credit_sessions_account_idx on public.credit_sessions(account_id);
create table public.credit_wallet_access (
 account_id uuid not null references public.credit_accounts(id) on delete cascade,
 wallet_address text not null, kind text not null check(kind in ('analysis','unlock')),
 created_at timestamptz not null default now(), primary key(account_id,wallet_address)
);
create table public.credit_requests (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.credit_accounts(id),
 wallet_address text not null, kind text not null check(kind in ('analysis','extension')),
 start_transactions bigint not null, target_transactions bigint not null,
 reserved integer not null check(reserved>0), charged integer not null default 0 check(charged>=0),
 status text not null default 'pending' check(status in ('pending','complete','failed')),
 created_at timestamptz not null default now()
);
create unique index credit_requests_one_pending_wallet on public.credit_requests(wallet_address) where status='pending';
create index credit_requests_account_idx on public.credit_requests(account_id);
create table public.credit_ledger (
 id bigint generated always as identity primary key, account_id uuid not null references public.credit_accounts(id),
 delta integer not null, reason text not null, wallet_address text, request_id uuid references public.credit_requests(id),
 created_at timestamptz not null default now()
);
create index credit_ledger_account_time_idx on public.credit_ledger(account_id,created_at desc);
create table public.credit_orders (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.credit_accounts(id),
 credits integer not null default 10 check(credits=10), usd integer not null default 5 check(usd=5),
 status text not null default 'pending' check(status in ('pending','paid','cancelled')),
 payment_reference text unique, created_at timestamptz not null default now()
);
create index credit_orders_account_idx on public.credit_orders(account_id);
create unique index credit_orders_one_pending on public.credit_orders(account_id) where status='pending';

create function public.credit_create_invite(p_hash text,p_label text) returns void
language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(7381,25);
 if (select count(*) from public.credit_invites where not revoked)>=25 then raise exception 'beta_invitation_limit'; end if;
 if length(trim(p_label)) not between 1 and 80 or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_request'; end if;
 insert into public.credit_invites(code_hash,label) values(p_hash,trim(p_label));
end $$;

create function public.credit_login(p_code_hash text,p_token_hash text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare i public.credit_invites; a uuid;
begin
 select * into i from public.credit_invites where code_hash=p_code_hash and not revoked for update;
 if not found then raise exception 'invalid_invitation'; end if;
 a:=i.account_id;
 if a is null then
  insert into public.credit_accounts(label) values(i.label) returning id into a;
  update public.credit_invites set account_id=a where code_hash=p_code_hash;
  insert into public.credit_ledger(account_id,delta,reason) values(a,50,'beta_activation');
 end if;
 if exists(select 1 from public.credit_accounts where id=a and disabled) then raise exception 'account_disabled'; end if;
 delete from public.credit_sessions where account_id=a and expires_at<now();
 insert into public.credit_sessions values(p_token_hash,a,now()+interval '30 days');
 return a;
end $$;

create function public.credit_debit(p_account uuid,p_amount integer,p_reason text,p_wallet text,p_request uuid default null)
returns void language plpgsql security invoker set search_path='' as $$
declare a public.credit_accounts; n integer;
begin
 if p_amount<=0 then return; end if;
 select * into a from public.credit_accounts where id=p_account for update;
 if a.cycle_credits+a.bonus_credits<p_amount then raise exception 'insufficient_credits'; end if;
 n:=least(a.cycle_credits,p_amount);
 update public.credit_accounts set cycle_credits=cycle_credits-n,bonus_credits=bonus_credits-(p_amount-n) where id=p_account;
 insert into public.credit_ledger(account_id,delta,reason,wallet_address,request_id) values(p_account,-p_amount,p_reason,p_wallet,p_request);
end $$;

create function public.credit_wallet_request(p_account uuid,p_wallet text,p_extend integer default 0)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.credit_accounts; s public.wallet_sync_state; p public.wallet_analysis_policies;
 r public.credit_requests; already boolean; work bigint; held integer; cost integer; target bigint;
begin
 if p_wallet !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' or p_extend not in (0,2000,10000) then raise exception 'invalid_request'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_wallet,7381));
 -- Same state -> account lock order as checkpoint settlement.
 insert into public.wallet_sync_state(wallet_address,status,updated_at) values(p_wallet,'idle',now()) on conflict do nothing;
 select * into s from public.wallet_sync_state where wallet_address=p_wallet for update;
 select * into p from public.wallet_analysis_policies where wallet_address=p_wallet;
 if p.action in ('block','review') then raise exception 'wallet_restricted'; end if;
 select * into a from public.credit_accounts where id=p_account for update;
 if not found or a.disabled then raise exception 'account_disabled'; end if;
 if a.expires_at<=now() then raise exception 'subscription_expired'; end if;
 select exists(select 1 from public.credit_wallet_access where account_id=p_account and wallet_address=p_wallet) into already;
 select coalesce(sum(reserved-charged),0)::integer into held from public.credit_requests where account_id=p_account and status='pending';
 work:=coalesce(s.transactions_scanned,s.pages_scanned*100,0);
 select * into r from public.credit_requests where wallet_address=p_wallet and status='pending';
 if already and p_extend=0 then return jsonb_build_object('kind','revisit','cost',0); end if;
 if p_extend>0 and not already then raise exception 'unlock_required'; end if;
 if r.id is not null then raise exception 'wallet_analysis_in_progress'; end if;
 if p_extend=0 and work>0 then
  if a.cycle_credits+a.bonus_credits-held<1 then raise exception 'insufficient_credits'; end if;
  perform public.credit_debit(p_account,1,'wallet_unlock',p_wallet);
  insert into public.credit_wallet_access values(p_account,p_wallet,'unlock',now());
  return jsonb_build_object('kind','unlock','cost',1);
 end if;
 if s.history_complete or (p_extend>0 and s.status='syncing') then raise exception 'history_not_extendable'; end if;
 if p_extend=0 then cost:=3; target:=5000; else cost:=p_extend/2000; target:=work+p_extend; end if;
 if target>50000 then raise exception 'wallet_limit_reached'; end if;
 if a.cycle_credits+a.bonus_credits-held<cost then raise exception 'insufficient_credits'; end if;
 insert into public.credit_requests(account_id,wallet_address,kind,start_transactions,target_transactions,reserved)
 values(p_account,p_wallet,case when p_extend=0 then 'analysis' else 'extension' end,work,target,cost) returning * into r;
 insert into public.credit_wallet_access values(p_account,p_wallet,'analysis',now()) on conflict do nothing;
 insert into public.wallet_analysis_policies(wallet_address,transaction_limit,reason) values(p_wallet,target,'Account credit allowance')
 on conflict(wallet_address) do update set transaction_limit=excluded.transaction_limit,updated_at=now();
 perform public.enqueue_wallet_index_job(p_wallet,100);
 update public.wallet_index_jobs set status='queued',requested_at=now(),last_error=null where wallet_address=p_wallet and status in ('paused','error','complete');
 return jsonb_build_object('kind',r.kind,'cost',cost,'reserved',true,'target',target);
end $$;

-- Billing and facts commit atomically; retries cannot charge the same saved page twice.
create function public.credit_settle_checkpoint() returns trigger
language plpgsql security invoker set search_path='' as $$
declare r public.credit_requests; work bigint; due integer; terminal boolean;
begin
 work:=coalesce(new.transactions_scanned,0);
 select * into r from public.credit_requests where wallet_address=new.wallet_address and status='pending' for update;
 if r.id is null then return new; end if;
 due:=case when work<=r.start_transactions then 0 when r.kind='analysis' then 3 else least(r.reserved,ceil((work-r.start_transactions)/2000.0)::integer) end;
 if due>r.charged then perform public.credit_debit(r.account_id,due-r.charged,r.kind,new.wallet_address,r.id); end if;
 terminal:=new.history_complete or work>=r.target_transactions;
 update public.credit_requests set charged=greatest(charged,due),status=case when terminal then 'complete' else 'pending' end where id=r.id;
 return new;
end $$;
create trigger credit_settle_checkpoint after insert or update of transactions_scanned,history_complete on public.wallet_sync_state
for each row execute function public.credit_settle_checkpoint();

create function public.credit_release_failed_job() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.status='error' or (new.status='paused' and coalesce(new.last_error,'')<>'analysis_budget_exhausted') then
  delete from public.credit_wallet_access a using public.credit_requests r where r.wallet_address=new.wallet_address and r.status='pending' and r.charged=0 and r.kind='analysis' and a.account_id=r.account_id and a.wallet_address=r.wallet_address;
  update public.credit_requests set status='failed' where wallet_address=new.wallet_address and status='pending';
 end if;
 return new;
end $$;
create trigger credit_release_failed_job after update of status on public.wallet_index_jobs for each row execute function public.credit_release_failed_job();

create function public.credit_confirm_order(p_order uuid,p_reference text) returns void
language plpgsql security invoker set search_path='' as $$
declare o public.credit_orders; a public.credit_accounts;
begin
 if length(trim(p_reference))<5 then raise exception 'payment_reference_required'; end if;
 select * into o from public.credit_orders where id=p_order for update;
 if not found then raise exception 'order_not_found'; end if;
 if o.status='paid' then return; end if;
 if o.status<>'pending' then raise exception 'order_cancelled'; end if;
 select * into a from public.credit_accounts where id=o.account_id for update;
 if a.plan<>'pro' or a.expires_at<=now() or a.disabled then raise exception 'active_pro_required'; end if;
 update public.credit_orders set status='paid',payment_reference=p_reference where id=p_order;
 update public.credit_accounts set bonus_credits=bonus_credits+10 where id=o.account_id;
 insert into public.credit_ledger(account_id,delta,reason) values(o.account_id,10,'credit_purchase');
end $$;

create function public.credit_renew(p_account uuid,p_reference text) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if length(trim(p_reference))<5 then raise exception 'payment_reference_required'; end if;
 -- Unique payment references make renewal idempotent too.
 perform pg_advisory_xact_lock(hashtextextended('renew:'||p_reference,7381));
 if exists(select 1 from public.credit_ledger where reason='pro_activation:'||p_reference) then return; end if;
 perform 1 from public.credit_accounts where id=p_account for update;
 if not found then raise exception 'account_not_found'; end if;
 if exists(select 1 from public.credit_requests where account_id=p_account and status='pending') then raise exception 'pending_analysis'; end if;
 update public.credit_accounts set plan='pro',cycle_started_at=now(),expires_at=now()+interval '30 days',cycle_credits=50,bonus_credits=0 where id=p_account;
 insert into public.credit_ledger(account_id,delta,reason) values(p_account,50,'pro_activation:'||p_reference);
end $$;

do $$ declare t text; f regprocedure; begin
 foreach t in array array['credit_accounts','credit_invites','credit_sessions','credit_wallet_access','credit_requests','credit_ledger','credit_orders'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname like 'credit_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',f);
  execute format('grant execute on function %s to service_role',f);
 end loop;
end $$;
grant usage,select on sequence public.credit_ledger_id_seq to service_role;
