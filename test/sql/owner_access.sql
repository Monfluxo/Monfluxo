begin;
set local role service_role;
do $$
declare a uuid; r jsonb; w text:='77777777777777777777777777777777';
begin
 if exists(select 1 from public.wallets where address=w) then raise exception 'fixture_exists'; end if;
 perform public.credit_create_owner(repeat('f',64));
 a:=public.credit_login(repeat('f',64),repeat('a',64));
 if not (select is_owner from public.credit_accounts where id=a) then raise exception 'not_owner'; end if;
 if (select starts_at from public.credit_beta_config where singleton) is not null then raise exception 'owner_started_beta'; end if;
 r:=public.credit_wallet_request(a,w,0);
 if (r->>'cost')::integer<>0 or (r->>'unlimited')::boolean is distinct from true then raise exception 'wrong_initial_budget'; end if;
 update public.wallet_sync_state set transactions_scanned=5000,status='idle' where wallet_address=w;
 r:=public.credit_wallet_request(a,w,2000);
 if (r->>'cost')::integer<>0 or (r->>'unlimited')::boolean is distinct from true then raise exception 'wrong_extension'; end if;
 if exists(select 1 from public.credit_requests where account_id=a) or exists(select 1 from public.credit_ledger where account_id=a) then raise exception 'owner_billed'; end if;
 update public.wallet_analysis_policies set action='block' where wallet_address=w;
 begin perform public.credit_wallet_request(a,w,0);raise exception 'block_bypassed';exception when others then if sqlerrm<>'wallet_restricted' then raise;end if;end;
 perform public.credit_create_owner(repeat('e',64));
 if exists(select 1 from public.credit_sessions where account_id=a) then raise exception 'old_session_alive'; end if;
 begin perform public.credit_login(repeat('f',64),repeat('b',64));raise exception 'old_code_alive';exception when others then if sqlerrm<>'invalid_invitation' then raise;end if;end;
 if has_function_privilege('anon','public.credit_create_owner(text)','execute') then raise exception 'public_owner_creation'; end if;
end $$;
select 'PASS: owner login, separate beta, zero billing, unlimited history, wallet block, credential rotation, private RPC' as result;
rollback;
