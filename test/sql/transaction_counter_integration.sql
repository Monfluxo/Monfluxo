BEGIN;
SET LOCAL ROLE service_role;
INSERT INTO public.wallets(address) VALUES('counter_integration_fixture');
INSERT INTO public.wallet_sync_state(wallet_address,status,transactions_scanned,pages_scanned,newest_signature,oldest_signature)
VALUES('counter_integration_fixture','syncing',0,0,'newest','oldest');
DO $$
DECLARE data jsonb := '{"transactions":[],"trades":[],"transfers":[],"rewards":[],"funding":[]}';checkpoint jsonb := '{"transactions_scanned":20,"pages_scanned":1,"page_transactions":20,"page_key":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","scan_mode":"deep","backfill_pagination_token":"10:1","updated_at":"2026-10-03T22:00:00Z"}';n bigint;
BEGIN
 PERFORM public.persist_wallet_event_page('counter_integration_fixture',ARRAY['signature'],data,checkpoint);
 SELECT transaction_count INTO n FROM public.wallets WHERE address='counter_integration_fixture';
 IF n<>20 THEN RAISE EXCEPTION 'wallet mirror failed';END IF;
 BEGIN
  PERFORM public.persist_wallet_event_page('counter_integration_fixture',ARRAY['signature'],data,checkpoint||'{"transactions_scanned":40}');
  RAISE EXCEPTION 'duplicate page accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'history_page_already_committed' THEN RAISE; END IF;END;
 SELECT transactions_scanned INTO n FROM public.wallet_sync_state WHERE wallet_address='counter_integration_fixture';
 IF n<>20 THEN RAISE EXCEPTION 'duplicate inflated counter';END IF;
END;$$;
UPDATE public.wallet_sync_state SET status='idle' WHERE wallet_address='counter_integration_fixture';
INSERT INTO public.wallet_counter_recounts(wallet_address,snapshot,status,lease_token)
VALUES('counter_integration_fixture','{"newest":"newest","oldest":"oldest","cursor":"10:1"}','running','00000000-0000-0000-0000-000000000001');
DO $$
DECLARE n bigint;done boolean;
BEGIN
 SELECT public.finish_wallet_counter_recount('counter_integration_fixture','00000000-0000-0000-0000-000000000001',25) INTO done;
 IF NOT done THEN RAISE EXCEPTION 'recount did not complete';END IF;
 SELECT transaction_count INTO n FROM public.wallets WHERE address='counter_integration_fixture';
 IF n<>25 THEN RAISE EXCEPTION 'recovery not mirrored';END IF;
 UPDATE public.wallet_counter_recounts SET status='running',snapshot='{"newest":"obsolete","oldest":"oldest","cursor":"10:1"}' WHERE wallet_address='counter_integration_fixture';
 SELECT public.finish_wallet_counter_recount('counter_integration_fixture','00000000-0000-0000-0000-000000000001',100) INTO done;
 IF done THEN RAISE EXCEPTION 'changed snapshot accepted';END IF;
 SELECT transaction_count INTO n FROM public.wallets WHERE address='counter_integration_fixture';
 IF n<>25 THEN RAISE EXCEPTION 'changed snapshot overwrote counter';END IF;
END;$$;
ROLLBACK;
