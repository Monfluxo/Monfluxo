begin;
set local role service_role;
do $$
declare a uuid; b uuid; r jsonb; w text:='77777777777777777777777777777777'; z text:='88888888888888888888888888888888';
begin
 select id into a from public.credit_accounts where is_owner;
 if a is null then raise exception 'owner_missing'; end if;
 if exists(select 1 from public.wallets where address in(w,z)) then raise exception 'fixture_exists'; end if;
 r:=public.credit_wallet_request(a,w,0);
 if (r->>'cost')::integer<>0 or (r->>'unlimited')::boolean is distinct from true then raise exception 'not_unlimited'; end if;
 if not (select owner_unlimited from public.wallet_analysis_policies where wallet_address=w) then raise exception 'missing_authorization'; end if;
 update public.wallet_sync_state set transactions_scanned=150000,status='idle' where wallet_address=w;
 r:=public.credit_wallet_request(a,w,2000);
 if (r->>'unlimited')::boolean is distinct from true then raise exception 'owner_ceiling'; end if;
 if exists(select 1 from public.credit_requests where account_id=a) or exists(select 1 from public.credit_ledger where account_id=a and delta<0) then raise exception 'owner_billed'; end if;
 update public.wallet_analysis_policies set action='block',source='manual' where wallet_address=w;
 begin perform public.credit_wallet_request(a,w,0);raise exception 'ban_bypassed';exception when others then if sqlerrm<>'wallet_restricted' then raise;end if;end;
 insert into public.credit_accounts(label,plan,cycle_credits,expires_at) values('Rollback fixture','pro',50,now()+interval '30 days') returning id into b;
 r:=public.credit_wallet_request(b,z,0);
 if (r->>'cost')::integer<>3 or (r->>'target')::integer<>5000 then raise exception 'normal_budget_changed';end if;
 if (select owner_unlimited from public.wallet_analysis_policies where wallet_address=z) then raise exception 'owner_privilege_leaked';end if;
 if has_function_privilege('anon','public.credit_wallet_request_core(uuid,text,integer)','execute') then raise exception 'rpc_public';end if;
end $$;
rollback;
