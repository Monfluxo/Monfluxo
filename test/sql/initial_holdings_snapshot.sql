begin;
set local role service_role;
insert into public.wallet_initial_holdings(wallet_address,captured_at,snapshot_kind,native_lamports,token_count,balances) values ('snapshot-test',now(),'scan_start',1,1,'[["mint","9007199254740993",6]]');
insert into public.wallet_initial_holdings(wallet_address,captured_at,snapshot_kind,native_lamports,token_count,balances) values ('snapshot-test',now(),'first_recorded',2,0,'[]') on conflict(wallet_address) do nothing;
do $$begin
 if (select snapshot_kind <> 'scan_start' or token_count <> 1 or balances->0->>1 <> '9007199254740993' from public.wallet_initial_holdings where wallet_address='snapshot-test') then raise exception 'Snapshot overwritten or precision lost'; end if;
 if has_table_privilege('anon','public.wallet_initial_holdings','SELECT') or has_table_privilege('authenticated','public.wallet_initial_holdings','SELECT') then raise exception 'Snapshot publicly exposed'; end if;
end$$;
rollback;
