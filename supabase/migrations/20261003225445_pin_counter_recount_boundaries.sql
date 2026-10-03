ALTER TABLE public.wallet_counter_recounts ADD COLUMN count_filters jsonb;
ALTER TABLE public.wallet_counter_recounts ADD COLUMN last_signature text;
CREATE OR REPLACE FUNCTION public.finish_wallet_counter_recount(p_wallet text,p_lease uuid,p_total bigint) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.wallet_counter_recounts; s public.wallet_sync_state;
BEGIN
 IF p_total<0 THEN RAISE EXCEPTION 'invalid_counter'; END IF;
 -- Consistent state -> maintenance row lock order.
 SELECT * INTO s FROM public.wallet_sync_state WHERE wallet_address=p_wallet FOR UPDATE;
 SELECT * INTO r FROM public.wallet_counter_recounts WHERE wallet_address=p_wallet AND lease_token=p_lease AND status='running' FOR UPDATE;
 IF r.wallet_address IS NULL THEN RAISE EXCEPTION 'counter_lease_required'; END IF;
 IF s.status='syncing' OR jsonb_build_object('newest',s.newest_signature,'oldest',s.oldest_signature,'cursor',s.backfill_pagination_token) IS DISTINCT FROM r.snapshot THEN
  UPDATE public.wallet_counter_recounts SET status='queued',snapshot=jsonb_build_object('newest',s.newest_signature,'oldest',s.oldest_signature,'cursor',s.backfill_pagination_token),pagination_token=NULL,count_filters=NULL,last_signature=NULL,transactions_counted=0,pages_counted=0,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE wallet_address=p_wallet;
  RETURN false;
 END IF;
 -- Historical maintenance is not a user-requested paid analysis.
 PERFORM set_config('monfluxo.counter_reconciliation','true',true);
 UPDATE public.wallet_sync_state SET transactions_scanned=p_total WHERE wallet_address=p_wallet;
 UPDATE public.wallet_counter_recounts SET status='complete',transactions_counted=p_total,lease_until=NULL,last_error=NULL,updated_at=now() WHERE wallet_address=p_wallet;
 RETURN true;
END; $$;
