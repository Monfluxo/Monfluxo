-- Internal derived data is accessed exclusively by the backend service role.
ALTER TABLE public.wallet_trade_journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_smart_scores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wallet_trade_journeys, public.wallet_smart_scores FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallet_trade_journeys, public.wallet_smart_scores TO service_role;
ALTER TABLE public.wallet_trade_journeys ADD COLUMN IF NOT EXISTS analysis_version integer NOT NULL DEFAULT 0;

-- Replace a wallet's derived ranking atomically. Unchanged journeys produce no new
-- row versions; legacy and obsolete derived rows disappear only after reconstruction.
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
    r.cost_sol,r.proceeds_sol,r.entry_time,r.exit_time,true,now(),3
  FROM jsonb_to_recordset(p_rows) AS r(journey_id text,token_mint text,
    pnl_sol double precision,pnl_pct double precision,hold_seconds bigint,
    cost_sol double precision,proceeds_sol double precision,
    entry_time timestamptz,exit_time timestamptz)
  ON CONFLICT (wallet_address,journey_id) DO UPDATE SET
    token_mint=excluded.token_mint,pnl_sol=excluded.pnl_sol,pnl_pct=excluded.pnl_pct,
    hold_seconds=excluded.hold_seconds,cost_sol=excluded.cost_sol,
    proceeds_sol=excluded.proceeds_sol,entry_time=excluded.entry_time,
    exit_time=excluded.exit_time,closed=excluded.closed,updated_at=now(),analysis_version=3
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

ALTER TABLE public.wallet_rewards ALTER COLUMN block_time DROP NOT NULL;

-- Facts and the resume checkpoint commit together; unchanged rows are not rewritten.
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
  IF p_checkpoint IS NOT NULL THEN
    UPDATE public.wallet_sync_state SET
      backfill_pagination_token=p_checkpoint->>'backfill_pagination_token',
      backfill_started_at=(p_checkpoint->>'backfill_started_at')::timestamptz,
      backfill_updated_at=(p_checkpoint->>'backfill_updated_at')::timestamptz,
      transactions_scanned=(p_checkpoint->>'transactions_scanned')::bigint,
      pages_scanned=(p_checkpoint->>'pages_scanned')::integer,
      updated_at=(p_checkpoint->>'updated_at')::timestamptz
    WHERE wallet_address=p_wallet;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.persist_wallet_event_page(text,text[],jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_wallet_event_page(text,text[],jsonb,jsonb) TO service_role;
