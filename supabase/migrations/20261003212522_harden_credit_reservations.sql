-- Payment references are shared by subscriptions and packs to prevent double fulfillment.
create table public.credit_payment_receipts (
 reference text primary key, account_id uuid not null references public.credit_accounts(id),
 kind text not null check(kind in ('pro','pack')), order_id uuid references public.credit_orders(id),
 created_at timestamptz not null default now()
);
create index credit_payment_receipts_account_idx on public.credit_payment_receipts(account_id);
create index credit_payment_receipts_order_idx on public.credit_payment_receipts(order_id);
alter table public.credit_payment_receipts enable row level security;
revoke all on public.credit_payment_receipts from anon,authenticated;
grant all on public.credit_payment_receipts to service_role;

create or replace function public.credit_wallet_request(p_account uuid,p_wallet text,p_extend integer default 0)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.credit_accounts; s public.wallet_sync_state; p public.wallet_analysis_policies;
 r public.credit_requests; already boolean; work bigint; held integer; cost integer; target bigint;
begin
 if p_wallet !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' or p_extend not in (0,2000,10000) then raise exception 'invalid_request'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_wallet,7381));
 -- Same state -> account lock order as checkpoint settlement.
 insert into public.wallets(address) values(p_wallet) on conflict do nothing;
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
 if p_extend=0 and (work>0 or s.history_complete) then
  if a.cycle_credits+a.bonus_credits-held<1 then raise exception 'insufficient_credits'; end if;
  perform public.credit_debit(p_account,1,'wallet_unlock',p_wallet);
  insert into public.credit_wallet_access values(p_account,p_wallet,'unlock',now());
  return jsonb_build_object('kind','unlock','cost',1);
 end if;
 if s.history_complete or (p_extend>0 and (s.status='syncing' or work<coalesce(p.transaction_limit,5000))) then raise exception 'history_not_extendable'; end if;
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

create or replace function public.credit_confirm_order(p_order uuid,p_reference text) returns void
language plpgsql security invoker set search_path='' as $$
declare o public.credit_orders; a public.credit_accounts;
begin
 if length(trim(p_reference))<5 then raise exception 'payment_reference_required'; end if;
 select * into o from public.credit_orders where id=p_order for update;
 if not found then raise exception 'order_not_found'; end if;
 if o.status='paid' then return; end if;
 if exists(select 1 from public.credit_payment_receipts where reference=p_reference) then raise exception 'payment_reference_reused'; end if;
 if o.status<>'pending' then raise exception 'order_cancelled'; end if;
 select * into a from public.credit_accounts where id=o.account_id for update;
 if a.plan<>'pro' or a.expires_at<=now() or a.disabled then raise exception 'active_pro_required'; end if;
 insert into public.credit_payment_receipts(reference,account_id,kind,order_id) values(p_reference,o.account_id,'pack',p_order);
 update public.credit_orders set status='paid',payment_reference=p_reference where id=p_order;
 update public.credit_accounts set bonus_credits=bonus_credits+10 where id=o.account_id;
 insert into public.credit_ledger(account_id,delta,reason) values(o.account_id,10,'credit_purchase');
end $$;

create or replace function public.credit_renew(p_account uuid,p_reference text) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if length(trim(p_reference))<5 then raise exception 'payment_reference_required'; end if;
 -- Unique payment references make renewal idempotent too.
 perform pg_advisory_xact_lock(hashtextextended('renew:'||p_reference,7381));
 if exists(select 1 from public.credit_payment_receipts where reference=p_reference and account_id=p_account and kind='pro') then return; end if;
 if exists(select 1 from public.credit_payment_receipts where reference=p_reference) then raise exception 'payment_reference_reused'; end if;
 perform 1 from public.credit_accounts where id=p_account for update;
 if not found then raise exception 'account_not_found'; end if;
 if exists(select 1 from public.credit_requests where account_id=p_account and status='pending') then raise exception 'pending_analysis'; end if;
 insert into public.credit_payment_receipts(reference,account_id,kind) values(p_reference,p_account,'pro');
 update public.credit_accounts set plan='pro',cycle_started_at=now(),expires_at=now()+interval '30 days',cycle_credits=50,bonus_credits=0 where id=p_account;
 insert into public.credit_ledger(account_id,delta,reason) values(p_account,50,'pro_activation:'||p_reference);
end $$;
