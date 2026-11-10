// Yahoo Finance data source — closest CFD/futures proxy for NQ (E-mini Nasdaq-100): "NQ=F" (CME).
// Runs server-side to avoid CORS; aggregates 1-minute base bars into arbitrary timeframes.

export interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchYahooRaw(symbol: string, interval: '1m' | '5m', range: string): Promise<Bar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const j: any = await res.json();
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error(j?.chart?.error?.description || 'Yahoo: no result');
  const ts: number[] = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  const out: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    out.push({ time: ts[i], open: o, high: h, low: l, close: c, volume: q.volume?.[i] ?? 0 });
  }
  return out;
}

/** Aggregate sorted bars into buckets of tfSeconds aligned to epoch. */
export function aggregate(bars: Bar[], tfSeconds: number): Bar[] {
  if (tfSeconds <= 60) return bars;
  const out: Bar[] = [];
  let cur: Bar | null = null;
  for (const b of bars) {
    const bucket = Math.floor(b.time / tfSeconds) * tfSeconds;
    if (!cur || cur.time !== bucket) {
      if (cur) out.push(cur);
      cur = { time: bucket, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const cache = new Map<string, { t: number; bars: Bar[] }>();
const TTL_MS = 20_000; // short TTL so the app feels "near live" without hammering Yahoo

/**
 * Get bars for symbol at given timeframe seconds.
 * Base granularity: 1m for tf<=60min, 5m for larger tf (Yahoo has no native 90m etc.).
 */
export async function getBars(symbol: string, tfSec: number): Promise<Bar[]> {
  const key = `${symbol}:${tfSec}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.bars;

  const use1m = tfSec <= 3600;
  // Ranges: keep enough history but stay within Yahoo limits (1m max ~7d window per request day-range)
  const range = use1m ? (tfSec <= 300 ? '5d' : '7d') : (tfSec <= 86400 ? '3mo' : '1y');
  let bars = await fetchYahooRaw(symbol, use1m ? '1m' : '5m', range);
  // Fallback: some symbols lack 1m beyond a few days
  if (bars.length === 0 && use1m) bars = await fetchYahooRaw(symbol, '5m', '1mo');

  const agg = aggregate(bars, tfSec);
  cache.set(key, { t: Date.now(), bars: agg });
  return agg;
}
