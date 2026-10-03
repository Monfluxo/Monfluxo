export const ANALYSIS_VERSION = 3;
export function analysisRevision(state) {
  return JSON.stringify([
    state?.last_synced_at ?? null, state?.backfill_updated_at ?? null,
    state?.pages_scanned ?? 0, state?.history_complete === true,
    state?.newest_signature ?? null, state?.backfill_pagination_token ?? null
  ]);
}
export function isCurrentAnalysis(cache, state) {
  return cache?.metrics?.analysisVersion === ANALYSIS_VERSION &&
    cache.metrics.sourceRevision === analysisRevision(state) &&
    !(state?.history_complete && cache.metrics.rowsTruncated !== false);
}
