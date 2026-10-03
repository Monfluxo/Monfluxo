create or replace function public.credit_settle_checkpoint() returns trigger
language plpgsql security invoker set search_path='' as $$
declare r public.credit_requests; work bigint; due integer; terminal boolean;
begin
 if current_setting('monfluxo.counter_reconciliation',true)='true' then return new; end if;
 work:=coalesce(new.transactions_scanned,0);
 select * into r from public.credit_requests where wallet_address=new.wallet_address and status='pending' for update;
 if r.id is null then return new; end if;
 due:=case when work<=r.start_transactions then 0 when r.kind='analysis' then 3 else least(r.reserved,ceil((work-r.start_transactions)/2000.0)::integer) end;
 if due>r.charged then perform public.credit_debit(r.account_id,due-r.charged,r.kind,new.wallet_address,r.id); end if;
 terminal:=new.history_complete or work>=r.target_transactions;
 update public.credit_requests set charged=greatest(charged,due),status=case when terminal then 'complete' else 'pending' end where id=r.id;
 return new;
end $$;

ALTER TABLE public.wallets ALTER COLUMN transaction_count TYPE bigint;
ALTER TABLE public.wallets ADD COLUMN transaction_count_exact boolean NOT NULL DEFAULT false;
ALTER TABLE public.wallets ADD COLUMN transaction_count_updated_at timestamptz;
CREATE TABLE public.wallet_index_page_receipts (
 wallet_address text NOT NULL REFERENCES public.wallets(address) ON DELETE CASCADE,
 page_key text NOT NULL CHECK(length(page_key)=64), transactions_indexed integer NOT NULL CHECK(transactions_indexed>0),
 scan_mode text NOT NULL, cursor_after text, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(wallet_address,page_key)
);
CREATE TABLE public.wallet_counter_recounts (
 wallet_address text PRIMARY KEY REFERENCES public.wallets(address) ON DELETE CASCADE,
 snapshot jsonb NOT NULL, pagination_token text, transactions_counted bigint NOT NULL DEFAULT 0 CHECK(transactions_counted>=0),
 pages_counted integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','complete','error')),
 lease_token uuid, lease_until timestamptz, last_error text, updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wallet_index_page_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_counter_recounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wallet_index_page_receipts,public.wallet_counter_recounts FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.wallet_index_page_receipts,public.wallet_counter_recounts TO service_role;
CREATE FUNCTION public.mirror_wallet_transaction_count() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.transactions_scanned IS NOT NULL THEN
  UPDATE public.wallets SET transaction_count=NEW.transactions_scanned,transaction_count_exact=true,transaction_count_updated_at=now()
  WHERE address=NEW.wallet_address AND (transaction_count IS DISTINCT FROM NEW.transactions_scanned OR NOT transaction_count_exact);
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER mirror_wallet_transaction_count AFTER INSERT OR UPDATE OF transactions_scanned ON public.wallet_sync_state
 FOR EACH ROW EXECUTE FUNCTION public.mirror_wallet_transaction_count();
UPDATE public.wallets w SET transaction_count=s.transactions_scanned,transaction_count_exact=true,transaction_count_updated_at=now()
 FROM public.wallet_sync_state s WHERE s.wallet_address=w.address AND s.transactions_scanned IS NOT NULL;
CREATE FUNCTION public.claim_wallet_counter_recount() RETURNS SETOF public.wallet_counter_recounts LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE chosen text;
BEGIN
 SELECT r.wallet_address INTO chosen FROM public.wallet_counter_recounts r JOIN public.wallet_sync_state s USING(wallet_address)
 WHERE (r.status='queued' OR (r.status='running' AND r.lease_until<now())) AND s.status IS DISTINCT FROM 'syncing'
 AND NOT EXISTS(SELECT 1 FROM public.wallet_analysis_policies p WHERE p.wallet_address=r.wallet_address AND p.action IN ('block','exclude'))
 ORDER BY r.pages_counted>0,COALESCE(s.pages_scanned,0),r.wallet_address FOR UPDATE OF r SKIP LOCKED LIMIT 1;
 IF chosen IS NULL THEN RETURN; END IF;
 RETURN QUERY UPDATE public.wallet_counter_recounts SET status='running',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now()
 WHERE wallet_address=chosen RETURNING *;
END; $$;
CREATE FUNCTION public.finish_wallet_counter_recount(p_wallet text,p_lease uuid,p_total bigint) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.wallet_counter_recounts; s public.wallet_sync_state;
BEGIN
 IF p_total<0 THEN RAISE EXCEPTION 'invalid_counter'; END IF;
 -- Consistent state -> maintenance row lock order.
 SELECT * INTO s FROM public.wallet_sync_state WHERE wallet_address=p_wallet FOR UPDATE;
 SELECT * INTO r FROM public.wallet_counter_recounts WHERE wallet_address=p_wallet AND lease_token=p_lease AND status='running' FOR UPDATE;
 IF r.wallet_address IS NULL THEN RAISE EXCEPTION 'counter_lease_required'; END IF;
 IF s.status='syncing' OR jsonb_build_object('newest',s.newest_signature,'oldest',s.oldest_signature,'cursor',s.backfill_pagination_token) IS DISTINCT FROM r.snapshot THEN
  UPDATE public.wallet_counter_recounts SET status='queued',snapshot=jsonb_build_object('newest',s.newest_signature,'oldest',s.oldest_signature,'cursor',s.backfill_pagination_token),pagination_token=NULL,transactions_counted=0,pages_counted=0,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE wallet_address=p_wallet;
  RETURN false;
 END IF;
 -- Historical maintenance is not a user-requested paid analysis.
 PERFORM set_config('monfluxo.counter_reconciliation','true',true);
 UPDATE public.wallet_sync_state SET transactions_scanned=p_total WHERE wallet_address=p_wallet;
 UPDATE public.wallet_counter_recounts SET status='complete',transactions_counted=p_total,lease_until=NULL,last_error=NULL,updated_at=now() WHERE wallet_address=p_wallet;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.mirror_wallet_transaction_count(),public.claim_wallet_counter_recount(),public.finish_wallet_counter_recount(text,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mirror_wallet_transaction_count(),public.claim_wallet_counter_recount(),public.finish_wallet_counter_recount(text,uuid,bigint) TO service_role;
-- Empty failed attempts have no indexed transactions, not an unknown history.
SELECT set_config('monfluxo.counter_reconciliation','true',true);
UPDATE public.wallet_sync_state s SET transactions_scanned=0
WHERE s.transactions_scanned IS NULL AND s.newest_signature IS NULL AND s.oldest_signature IS NULL
AND NOT EXISTS(SELECT 1 FROM public.wallet_transactions t WHERE t.wallet_address=s.wallet_address)
AND NOT EXISTS(SELECT 1 FROM public.wallet_trades t WHERE t.wallet_address=s.wallet_address)
AND NOT EXISTS(SELECT 1 FROM public.wallet_transfers t WHERE t.wallet_address=s.wallet_address)
AND NOT EXISTS(SELECT 1 FROM public.wallet_rewards t WHERE t.wallet_address=s.wallet_address);
INSERT INTO public.wallet_counter_recounts(wallet_address,snapshot)
SELECT s.wallet_address,jsonb_build_object('newest',s.newest_signature,'oldest',s.oldest_signature,'cursor',s.backfill_pagination_token)
FROM public.wallet_sync_state s WHERE s.transactions_scanned IS NULL AND s.pages_scanned>0 AND length(s.wallet_address) BETWEEN 32 AND 44
AND NOT EXISTS(SELECT 1 FROM public.wallet_analysis_policies p WHERE p.wallet_address=s.wallet_address AND p.action IN ('block','exclude'));

CREATE OR REPLACE FUNCTION public.replace_wallet_trade_journeys(p_wallet text, p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE written integer;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) > 500000 THEN
    RAISE EXCEPTION 'invalid_journey_rows';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE
      r->>'wallet_address' IS DISTINCT FROM p_wallet OR r->>'journey_id' IS NULL OR
      r->>'token_mint' IS NULL OR (r->>'closed')::boolean IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'invalid_journey_identity';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_wallet, 901));
  DELETE FROM public.wallet_trade_journeys old WHERE old.wallet_address=p_wallet
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE r->>'journey_id'=old.journey_id);
  INSERT INTO public.wallet_trade_journeys AS old (
    wallet_address,journey_id,token_mint,pnl_sol,pnl_pct,hold_seconds,cost_sol,
    proceeds_sol,entry_time,exit_time,closed,updated_at,analysis_version)
  SELECT p_wallet,r.journey_id,r.token_mint,r.pnl_sol,r.pnl_pct,r.hold_seconds,
    r.cost_sol,r.proceeds_sol,r.entry_time,r.exit_time,true,now(),4
  FROM jsonb_to_recordset(p_rows) AS r(journey_id text,token_mint text,
    pnl_sol double precision,pnl_pct double precision,hold_seconds bigint,
    cost_sol double precision,proceeds_sol double precision,
    entry_time timestamptz,exit_time timestamptz)
  ON CONFLICT (wallet_address,journey_id) DO UPDATE SET
    token_mint=excluded.token_mint,pnl_sol=excluded.pnl_sol,pnl_pct=excluded.pnl_pct,
    hold_seconds=excluded.hold_seconds,cost_sol=excluded.cost_sol,
    proceeds_sol=excluded.proceeds_sol,entry_time=excluded.entry_time,
    exit_time=excluded.exit_time,closed=excluded.closed,updated_at=now(),analysis_version=4
  WHERE (old.token_mint,old.pnl_sol,old.pnl_pct,old.hold_seconds,old.cost_sol,
    old.proceeds_sol,old.entry_time,old.exit_time,old.closed,old.analysis_version)
  IS DISTINCT FROM (excluded.token_mint,excluded.pnl_sol,excluded.pnl_pct,
    excluded.hold_seconds,excluded.cost_sol,excluded.proceeds_sol,
    excluded.entry_time,excluded.exit_time,excluded.closed,excluded.analysis_version);
  GET DIAGNOSTICS written = ROW_COUNT;
  RETURN written;
END;
$$;
REVOKE ALL ON FUNCTION public.replace_wallet_trade_journeys(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_wallet_trade_journeys(text,jsonb) TO service_role;


CREATE OR REPLACE FUNCTION public.persist_wallet_event_page(p_wallet text, p_signatures text[], p_data jsonb, p_checkpoint jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR EXISTS (
    SELECT 1 FROM unnest(ARRAY['transactions','trades','transfers','rewards','funding']) k
    WHERE jsonb_typeof(p_data->k) IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'invalid_page_arrays';
  END IF;
  PERFORM 1 FROM public.wallet_sync_state WHERE wallet_address=p_wallet AND status='syncing' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'wallet_sync_lease_required'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(p_data) arrays, LATERAL jsonb_array_elements(arrays.value) r
    WHERE r->>'wallet_address' IS DISTINCT FROM p_wallet OR r->>'signature' IS NULL OR NOT (r->>'signature'=ANY(p_signatures))) THEN
    RAISE EXCEPTION 'invalid_page_identity';
  END IF;
  DELETE FROM public.wallet_transactions old WHERE old.wallet_address=p_wallet AND old.signature=ANY(p_signatures)
    AND NOT EXISTS (SELECT 1 FROM jsonb_populate_recordset(NULL::public.wallet_transactions, p_data->'transactions') r WHERE r.wallet_address=old.wallet_address AND r.signature=old.signature);
  INSERT INTO public.wallet_transactions AS old (wallet_address,signature,slot,block_time,tx_version,parsed_type,parser_reason,raw_transaction)
    SELECT r.wallet_address,r.signature,r.slot,r.block_time,r.tx_version,r.parsed_type,r.parser_reason,r.raw_transaction FROM jsonb_populate_recordset(NULL::public.wallet_transactions, p_data->'transactions') r
    ON CONFLICT (wallet_address,signature) DO UPDATE SET slot=excluded.slot,block_time=excluded.block_time,tx_version=excluded.tx_version,parsed_type=excluded.parsed_type,parser_reason=excluded.parser_reason,raw_transaction=excluded.raw_transaction
    WHERE (old.slot,old.block_time,old.tx_version,old.parsed_type,old.parser_reason,old.raw_transaction) IS DISTINCT FROM (excluded.slot,excluded.block_time,excluded.tx_version,excluded.parsed_type,excluded.parser_reason,excluded.raw_transaction);
  DELETE FROM public.wallet_trades old WHERE old.wallet_address=p_wallet AND old.signature=ANY(p_signatures)
    AND NOT EXISTS (SELECT 1 FROM jsonb_populate_recordset(NULL::public.wallet_trades, p_data->'trades') r WHERE r.wallet_address=old.wallet_address AND r.signature=old.signature AND r.event_index=old.event_index);
  INSERT INTO public.wallet_trades AS old (wallet_address,signature,slot,event_index,instruction_index,block_time,type,token_mint,token_amount,sol_amount,estimated_price_sol,fee_sol,dex,parser)
    SELECT r.wallet_address,r.signature,r.slot,r.event_index,r.instruction_index,r.block_time,r.type,r.token_mint,r.token_amount,r.sol_amount,r.estimated_price_sol,r.fee_sol,r.dex,r.parser FROM jsonb_populate_recordset(NULL::public.wallet_trades, p_data->'trades') r
    ON CONFLICT (wallet_address,signature,event_index) DO UPDATE SET slot=excluded.slot,instruction_index=excluded.instruction_index,block_time=excluded.block_time,type=excluded.type,token_mint=excluded.token_mint,token_amount=excluded.token_amount,sol_amount=excluded.sol_amount,estimated_price_sol=excluded.estimated_price_sol,fee_sol=excluded.fee_sol,dex=excluded.dex,parser=excluded.parser
    WHERE (old.slot,old.instruction_index,old.block_time,old.type,old.token_mint,old.token_amount,old.sol_amount,old.estimated_price_sol,old.fee_sol,old.dex,old.parser) IS DISTINCT FROM (excluded.slot,excluded.instruction_index,excluded.block_time,excluded.type,excluded.token_mint,excluded.token_amount,excluded.sol_amount,excluded.estimated_price_sol,excluded.fee_sol,excluded.dex,excluded.parser);
  DELETE FROM public.wallet_transfers old WHERE old.wallet_address=p_wallet AND old.signature=ANY(p_signatures)
    AND NOT EXISTS (SELECT 1 FROM jsonb_populate_recordset(NULL::public.wallet_transfers, p_data->'transfers') r WHERE r.wallet_address=old.wallet_address AND r.signature=old.signature AND r.event_index=old.event_index);
  INSERT INTO public.wallet_transfers AS old (wallet_address,signature,slot,event_index,instruction_index,block_time,direction,token_mint,token_amount,raw_amount,decimals,source_address,destination_address,source_token_account,destination_token_account,parser)
    SELECT r.wallet_address,r.signature,r.slot,r.event_index,r.instruction_index,r.block_time,r.direction,r.token_mint,r.token_amount,r.raw_amount,r.decimals,r.source_address,r.destination_address,r.source_token_account,r.destination_token_account,r.parser FROM jsonb_populate_recordset(NULL::public.wallet_transfers, p_data->'transfers') r
    ON CONFLICT (wallet_address,signature,event_index) DO UPDATE SET slot=excluded.slot,instruction_index=excluded.instruction_index,block_time=excluded.block_time,direction=excluded.direction,token_mint=excluded.token_mint,token_amount=excluded.token_amount,raw_amount=excluded.raw_amount,decimals=excluded.decimals,source_address=excluded.source_address,destination_address=excluded.destination_address,source_token_account=excluded.source_token_account,destination_token_account=excluded.destination_token_account,parser=excluded.parser
    WHERE (old.slot,old.instruction_index,old.block_time,old.direction,old.token_mint,old.token_amount,old.raw_amount,old.decimals,old.source_address,old.destination_address,old.source_token_account,old.destination_token_account,old.parser) IS DISTINCT FROM (excluded.slot,excluded.instruction_index,excluded.block_time,excluded.direction,excluded.token_mint,excluded.token_amount,excluded.raw_amount,excluded.decimals,excluded.source_address,excluded.destination_address,excluded.source_token_account,excluded.destination_token_account,excluded.parser);
  DELETE FROM public.wallet_rewards old WHERE old.wallet_address=p_wallet AND old.signature=ANY(p_signatures)
    AND NOT EXISTS (SELECT 1 FROM jsonb_populate_recordset(NULL::public.wallet_rewards, p_data->'rewards') r WHERE r.wallet_address=old.wallet_address AND r.signature=old.signature AND r.quote_mint=old.quote_mint AND r.instruction_index=old.instruction_index);
  INSERT INTO public.wallet_rewards AS old (wallet_address,signature,slot,block_time,reward_type,quote_mint,quote_token_program,amount,raw_amount,decimals,creator,creator_token_account,creator_vault,creator_vault_token_account,instruction_index,source)
    SELECT r.wallet_address,r.signature,r.slot,r.block_time,r.reward_type,r.quote_mint,r.quote_token_program,r.amount,r.raw_amount,r.decimals,r.creator,r.creator_token_account,r.creator_vault,r.creator_vault_token_account,r.instruction_index,r.source FROM jsonb_populate_recordset(NULL::public.wallet_rewards, p_data->'rewards') r
    ON CONFLICT (wallet_address,signature,quote_mint,instruction_index) DO UPDATE SET slot=excluded.slot,block_time=excluded.block_time,reward_type=excluded.reward_type,quote_token_program=excluded.quote_token_program,amount=excluded.amount,raw_amount=excluded.raw_amount,decimals=excluded.decimals,creator=excluded.creator,creator_token_account=excluded.creator_token_account,creator_vault=excluded.creator_vault,creator_vault_token_account=excluded.creator_vault_token_account,source=excluded.source
    WHERE (old.slot,old.block_time,old.reward_type,old.quote_token_program,old.amount,old.raw_amount,old.decimals,old.creator,old.creator_token_account,old.creator_vault,old.creator_vault_token_account,old.source) IS DISTINCT FROM (excluded.slot,excluded.block_time,excluded.reward_type,excluded.quote_token_program,excluded.amount,excluded.raw_amount,excluded.decimals,excluded.creator,excluded.creator_token_account,excluded.creator_vault,excluded.creator_vault_token_account,excluded.source);
  DELETE FROM public.wallet_funding_events old WHERE old.wallet_address=p_wallet AND old.signature=ANY(p_signatures)
    AND NOT EXISTS (SELECT 1 FROM jsonb_populate_recordset(NULL::public.wallet_funding_events, p_data->'funding') r WHERE r.wallet_address=old.wallet_address AND r.signature=old.signature AND r.event_index=old.event_index AND r.asset_id=old.asset_id);
  INSERT INTO public.wallet_funding_events AS old (wallet_address,signature,event_index,slot,block_time,asset_type,asset_id,amount,raw_amount,decimals,source_address,destination_address,source_token_account,destination_token_account,parser)
    SELECT r.wallet_address,r.signature,r.event_index,r.slot,r.block_time,r.asset_type,r.asset_id,r.amount,r.raw_amount,r.decimals,r.source_address,r.destination_address,r.source_token_account,r.destination_token_account,r.parser FROM jsonb_populate_recordset(NULL::public.wallet_funding_events, p_data->'funding') r
    ON CONFLICT (wallet_address,signature,event_index,asset_id) DO UPDATE SET slot=excluded.slot,block_time=excluded.block_time,asset_type=excluded.asset_type,amount=excluded.amount,raw_amount=excluded.raw_amount,decimals=excluded.decimals,source_address=excluded.source_address,destination_address=excluded.destination_address,source_token_account=excluded.source_token_account,destination_token_account=excluded.destination_token_account,parser=excluded.parser
    WHERE (old.slot,old.block_time,old.asset_type,old.amount,old.raw_amount,old.decimals,old.source_address,old.destination_address,old.source_token_account,old.destination_token_account,old.parser) IS DISTINCT FROM (excluded.slot,excluded.block_time,excluded.asset_type,excluded.amount,excluded.raw_amount,excluded.decimals,excluded.source_address,excluded.destination_address,excluded.source_token_account,excluded.destination_token_account,excluded.parser);
  IF p_checkpoint IS NOT NULL AND p_checkpoint ? 'page_key' THEN
    INSERT INTO public.wallet_index_page_receipts(wallet_address,page_key,transactions_indexed,scan_mode,cursor_after)
    VALUES(p_wallet,p_checkpoint->>'page_key',(p_checkpoint->>'page_transactions')::integer,p_checkpoint->>'scan_mode',p_checkpoint->>'backfill_pagination_token')
    ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN RAISE EXCEPTION 'history_page_already_committed'; END IF;
  END IF;
  IF p_checkpoint IS NOT NULL THEN
    UPDATE public.wallet_sync_state SET
      backfill_pagination_token=p_checkpoint->>'backfill_pagination_token',
      backfill_started_at=(p_checkpoint->>'backfill_started_at')::timestamptz,
      backfill_updated_at=(p_checkpoint->>'backfill_updated_at')::timestamptz,
      transactions_scanned=(p_checkpoint->>'transactions_scanned')::bigint,
      pages_scanned=(p_checkpoint->>'pages_scanned')::integer,
      newest_signature=COALESCE(p_checkpoint->>'newest_signature',newest_signature),
      oldest_signature=COALESCE(p_checkpoint->>'oldest_signature',oldest_signature),
      updated_at=(p_checkpoint->>'updated_at')::timestamptz
    WHERE wallet_address=p_wallet;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.persist_wallet_event_page(text,text[],jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_wallet_event_page(text,text[],jsonb,jsonb) TO service_role;

