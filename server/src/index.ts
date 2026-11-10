import express from 'express';
import { getBars } from './yahoo.js';
import { runPine } from './pine.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((_req, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); next(); });

// GET /api/bars?symbol=NQ=F&tf=900  -> { bars: [...] }
app.get('/api/bars', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || 'NQ=F');
    const tf = Math.max(60, parseInt(String(req.query.tf || '300')));
    const bars = await getBars(symbol, tf);
    res.json({ symbol, tf, count: bars.length, bars });
  } catch (e: any) {
    res.status(502).json({ error: String(e?.message || e) });
  }
});

// POST /api/pine  { code, bars: [{time,open,high,low,close,volume}], tf }
app.post('/api/pine', (req, res) => {
  try {
    const { code, bars, tf } = req.body || {};
    if (!code || !Array.isArray(bars)) return void res.status(400).json({ error: 'code and bars required' });
    const result = runPine(String(code), bars, Number(tf) || 300);
    // serialize functions -> per-bar color arrays
    const plots = result.plots.map(p => ({
      kind: p.kind, title: p.title, style: p.style, location: p.location,
      values: p.series.values,
      colors: typeof p.color === 'function' ? p.series.values.map((_v, i) => (p.color as any)(i)) : Array(p.series.values.length).fill(p.color),
    }));
    res.json({ plots, hlines: result.hlines, errors: result.errors, warnings: result.warnings.slice(0, 20) });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e), plots: [], hlines: [], errors: [String(e?.message || e)], warnings: [] });
  }
});

const PORT = 8787;
app.listen(PORT, () => console.log(`data/pine server on http://localhost:${PORT}`));
