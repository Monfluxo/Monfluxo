-- Trade links can only unlock saved history, never silently reserve an initial analysis.
create or replace function public.credit_wallet_request(p_account uuid,p_wallet text,p_extend integer default 0)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.credit_accounts; s public.wallet_sync_state; p public.wallet_analysis_policies;
 r public.credit_requests; already boolean; work bigint; held integer; cost integer; target bigint;
begin
 if p_wallet !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' or p_extend not in (-1,0,2000,10000) then raise exception 'invalid_request'; end if;
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
 if p_extend=-1 then
  if work=0 and s.history_complete is distinct from true then raise exception 'wallet_not_indexed'; end if;
  p_extend:=0;
 end if;
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

