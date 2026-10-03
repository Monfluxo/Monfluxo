CREATE OR REPLACE FUNCTION public.claim_wallet_counter_recount() RETURNS SETOF public.wallet_counter_recounts LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE chosen text;
BEGIN
 -- A paused/finished index job cannot hold a sync lease indefinitely.
 UPDATE public.wallet_sync_state s SET status='idle'
 WHERE s.status='syncing' AND greatest(s.updated_at,s.backfill_updated_at)<now()-interval '5 minutes'
 AND EXISTS(SELECT 1 FROM public.wallet_counter_recounts r WHERE r.wallet_address=s.wallet_address AND r.status='queued')
 AND NOT EXISTS(SELECT 1 FROM public.wallet_index_jobs j WHERE j.wallet_address=s.wallet_address AND j.status='running');
 SELECT r.wallet_address INTO chosen FROM public.wallet_counter_recounts r JOIN public.wallet_sync_state s USING(wallet_address)
 WHERE (r.status='queued' OR (r.status='running' AND r.lease_until<now())) AND s.status IS DISTINCT FROM 'syncing'
 AND NOT EXISTS(SELECT 1 FROM public.wallet_analysis_policies p WHERE p.wallet_address=r.wallet_address AND p.action IN ('block','exclude'))
 ORDER BY r.pages_counted>0,COALESCE(s.pages_scanned,0),r.wallet_address FOR UPDATE OF r SKIP LOCKED LIMIT 1;
 IF chosen IS NULL THEN RETURN; END IF;
 RETURN QUERY UPDATE public.wallet_counter_recounts SET status='running',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now()
 WHERE wallet_address=chosen RETURNING *;
END; $$;
