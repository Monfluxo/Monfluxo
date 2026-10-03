export function formatTimestamp(value) {
  if (!['number', 'string'].includes(typeof value)) return '—';
  if (typeof value === 'string' && !value.trim()) return '—';
  const raw = Number(value);
  let date;
  if (Number.isFinite(raw)) {
    // Contract: Unix seconds, not milliseconds; a Solana timestamp cannot predate epoch.
    if (raw < 0 || raw > 253402300799) return '—';
    date = new Date(raw * 1000);
  } else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) date = new Date(value);
  else return '—';
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', timeZoneName:'short'}).format(date);
}
export function formatNumber(value, digits=4) {
  if (!['number','string'].includes(typeof value) || (typeof value === 'string' && !value.trim()) || !Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', {maximumFractionDigits:digits}).format(Number(value));
}
export function signedNumber(value, digits=4) {
  const formatted = formatNumber(value, digits);
  return formatted === '—' ? formatted : `${Number(value) >= 0 ? '+' : ''}${formatted}`;
}
export function metricClass(value) {
  if (formatNumber(value) === '—') return '';
  return Number(value) < 0 ? 'negative' : 'positive';
}
export function startJourneyRequest({wallet,mint,journey}, onState, fetchImpl=fetch) {
  const controller = new AbortController();
  let alive = true;
  onState({data:null, error:''});
  const done = (async () => {
    try {
      if (journey !== null && (!journey.trim() || journey.length > 512)) throw new Error('Invalid trade journey identifier');
      const qs = journey !== null ? `?journey=${encodeURIComponent(journey)}` : '';
      const response = await fetchImpl(`/api/data/trade/${encodeURIComponent(wallet)}/${encodeURIComponent(mint)}${qs}`, {cache:'no-store', signal:controller.signal});
      if (!response.ok) throw new Error(response.status === 404 ? 'Trade journey not found' : 'Trade journey unavailable');
      const payload = await response.json();
      if (!payload || payload.wallet !== wallet || payload.tokenMint !== mint || typeof payload.journeyId !== 'string' || !payload.summary || typeof payload.summary !== 'object' || Array.isArray(payload.summary)) throw new Error('Invalid trade journey response');
      if (journey !== null && payload.journeyId !== journey && payload.legacyJourneyId !== journey) throw new Error('Trade journey identity mismatch');
      if (payload.events != null && !Array.isArray(payload.events)) throw new Error('Invalid trade journey events');
      const strings = (value,keys) => Object.fromEntries(keys.map(key => [key,typeof value?.[key] === 'string' ? value[key] : null]));
      const data = {...payload, summary:{...payload.summary,hold:typeof payload.summary.hold === 'string' ? payload.summary.hold : null}, token:strings(payload.token,['name','symbol']), walletProfile:strings(payload.walletProfile,['name','username','avatar']), events:(payload.events || []).filter(e => e && typeof e === 'object' && !Array.isArray(e)).map(e => ({...e,type:typeof e.type === 'string' ? e.type : null,signature:typeof e.signature === 'string' ? e.signature : null,dex:typeof e.dex === 'string' ? e.dex : null}))};
      if (alive) onState({data, error:''});
    } catch (error) {
      const known=['Invalid trade journey identifier','Trade journey not found','Trade journey unavailable','Invalid trade journey response','Trade journey identity mismatch','Invalid trade journey events'];
      if (alive) onState({data:null, error:known.includes(error.message) ? error.message : 'Trade journey unavailable'});
    }
  })();
  return {done, cancel(){alive = false; controller.abort();}};
}
