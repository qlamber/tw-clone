// Minimal Pine Script v5 interpreter — enough to run classic built-in-style indicators
// (sma/ema/rsi/macd/stoch/bbands/hma/vwap/crossover/tf-close etc.) on OHLCV bars.
// Supports: inputs, var-less simple series assignment, if/else blocks, plot()/plotshape()/bgcolor()/hline()
// with conditional color expressions (ternary), comparison/logic/arithmetic operators.

export interface Series { values: (number | null)[] }
export type PlotKind = 'line' | 'histogram' | 'area' | 'shape';
export interface PlotDef { kind: PlotKind; title: string; color: string | ((i: number) => string); series: Series; style?: string; location?: 'top' | 'belowbar' | 'abovebar'; shape?: string; }
export interface HLine { price: number; color: string; title: string; }
export interface TableOut { cells: string[][]; title: string }
export interface PineResult { plots: PlotDef[]; hlines: HLine[]; tables: TableOut[]; errors: string[]; warnings: string[] }

const N = (a: any): number | null => (typeof a === 'number' && isFinite(a) ? a : null);

class Env {
  vars = new Map<string, Series>();
  highS!: Series; lowS!: Series; closeS!: Series; openS!: Series; volumeS!: Series;
  times: number[] = []; openArr: any[] = []; highArr: any[] = []; lowArr: any[] = []; volumeArr: number[] = [];
  constructor(public len: number) {}
  setConst(name: string, v: number | null) { this.vars.set(name, { values: Array(this.len).fill(v) }); }
  setSeries(name: string, s: Series) { this.vars.set(name, s); }
}

// ---------- helpers exposed to scripts ----------
function src(series: Series): (number | null)[] { return series.values; }

function fSma(args: any[], env: Env): Series {
  const p = period(args[0], env); const s = asSeries(args[1], env);
  const out: (number | null)[] = new Array(env.len).fill(null);
  let sum = 0; const q: number[] = [];
  for (let i = 0; i < env.len; i++) {
    const v = N(s.values[i]);
    if (v != null) { q.push(v); sum += v; if (q.length > p) sum -= q.shift()!; }
    if (q.length === p) out[i] = sum / p;
  }
  return { values: out };
}
function fEma(args: any[], env: Env): Series {
  const p = period(args[0], env); const s = asSeries(args[1], env);
  const k = 2 / (p + 1);
  const out: (number | null)[] = new Array(env.len).fill(null);
  let e: number | null = null;
  for (let i = 0; i < env.len; i++) {
    const v = N(s.values[i]); if (v == null) continue;
    e = e == null ? v : v * k + e * (1 - k);
    out[i] = e;
  }
  return { values: out };
}
function fRsi(args: any[], env: Env): Series {
  const p = period(args[0], env); const s = asSeries(args[1], env);
  const out: (number | null)[] = new Array(env.len).fill(null);
  let up = 0, dn = 0;
  for (let i = 1; i < env.len; i++) {
    const a = N(s.values[i - 1]), b = N(s.values[i]); if (a == null || b == null) continue;
    const ch = b - a, u = Math.max(ch, 0), d = Math.max(-ch, 0);
    if (i <= p) { up += u; dn += d; if (i === p) out[i] = dn === 0 ? 100 : 100 - 100 / (1 + (up / p) / (dn / p)); }
    else { up = (up * (p - 1) + u) / p; dn = (dn * (p - 1) + d) / p; out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn); }
  }
  return { values: out };
}
function fStoch(args: any[], env: Env): Series { // returns K when called with (len,k,d) usage via tuple not supported -> use _k/_d funcs
  const len = period(args[0], env);
  const hi = rollingMax(env.highS.values, len), lo = rollingMin(env.lowS.values, len);
  const out: (number | null)[] = new Array(env.len).fill(null);
  for (let i = 0; i < env.len; i++) {
    const h = hi[i], l = lo[i], c = N(env.closeS.values[i]);
    if (h == null || l == null || c == null || h === l) continue;
    out[i] = ((c - l) / (h - l)) * 100;
  }
  return { values: out };
}
function fWpr(args: any[], env: Env): Series {
  const len = period(args[0], env);
  const hi = rollingMax(env.highS.values, len), lo = rollingMin(env.lowS.values, len);
  const out: (number | null)[] = new Array(env.len).fill(null);
  for (let i = 0; i < env.len; i++) {
    const h = hi[i], l = lo[i], c = N(env.closeS.values[i]);
    if (h == null || l == null || c == null || h === l) continue;
    out[i] = ((h - c) / (h - l)) * -100;
  }
  return { values: out };
}
function fBbands(args: any[], env: Env): Series { // basis only; upper/lower via .upper/.lower handled specially
  return fSma([args[0], args[1]], env);
}
function fHullMA(args: any[], env: Env): Series {
  const p = period(args[0], env); const s = asSeries(args[1], env);
  const half = fEma([{ literal: Math.max(1, Math.round(p / 2)) }, s], env);
  const full = fEma([{ literal: p }, s], env);
  const diff: Series = { values: half.values.map((v, i) => { const w = N(full.values[i]); return v == null || w == null ? null : 2 * v - w; }) };
  return fWma([{ literal: Math.round(Math.sqrt(p)) || 1 }, diff], env);
}
function fWma(args: any[], env: Env): Series {
  const p = period(args[0], env); const s = asSeries(args[1], env);
  const out: (number | null)[] = new Array(env.len).fill(null);
  const den = (p * (p + 1)) / 2;
  for (let i = p - 1; i < env.len; i++) {
    let num = 0, ok = true;
    for (let j = 0; j < p; j++) { const v = N(s.values[i - p + 1 + j]); if (v == null) { ok = false; break; } num += v * (j + 1); }
    if (ok) out[i] = num / den;
  }
  return { values: out };
}
function fVwap(args: any[], env: Env): Series {
  const out: (number | null)[] = new Array(env.len).fill(null);
  let pv = 0, vv = 0, day = -1;
  for (let i = 0; i < env.len; i++) {
    const t = env.times[i]; const d = Math.floor(t / 86400);
    if (d !== day) { day = d; pv = 0; vv = 0; }
    const o = env.openArr[i]?.open ?? NaN;
    const tp = (env.highArr[i].high + env.lowArr[i].low + (env.closeS.values[i] ?? 0)) / 3;
    const vol = env.volumeArr[i] || 1;
    pv += tp * vol; vv += vol; out[i] = vv ? pv / vv : null;
  }
  return { values: out };
}
function fAtr(args: any[], env: Env): Series {
  const p = period(args[0], env);
  const tr: (number | null)[] = new Array(env.len).fill(null);
  for (let i = 0; i < env.len; i++) {
    const h = env.highS.values[i], l = env.lowS.values[i], pc = i > 0 ? env.closeS.values[i - 1] : null;
    if (h == null || l == null) continue;
    tr[i] = pc == null ? (h as number) - (l as number) : Math.max(h as number, pc) - Math.min(l as number, pc);
  }
  return fEma([{ literal: p }, { values: tr }], env);
}
function rollingMax(arr: (number | null)[], p: number): (number | null)[] {
  const out: (number | null)[] = new Array(arr.length).fill(null);
  for (let i = p - 1; i < arr.length; i++) { let m: number | null = null; for (let j = 0; j < p; j++) { const v = N(arr[i - j]); if (v != null) m = m == null ? v : Math.max(m, v); } out[i] = m; }
  return out;
}
function rollingMin(arr: (number | null)[], p: number): (number | null)[] {
  const out: (number | null)[] = new Array(arr.length).fill(null);
  for (let i = p - 1; i < arr.length; i++) { let m: number | null = null; for (let j = 0; j < p; j++) { const v = N(arr[i - j]); if (v != null) m = m == null ? v : Math.min(m, v); } out[i] = m; }
  return out;
}
function fHighest(args: any[], env: Env) { return { values: rollingMax(asSeries(args[0], env).values, period(args[1], env)) }; }
function fLowest(args: any[], env: Env) { return { values: rollingMin(asSeries(args[0], env).values, period(args[1], env)) }; }
function fCrossover(a: any, b: any, env: Env): Series {
  const x = asSeries(a, env), y = asSeries(b, env);
  const out: (number | null)[] = new Array(env.len).fill(0);
  for (let i = 1; i < env.len; i++) {
    const x0 = N(x.values[i - 1]), x1 = N(x.values[i]), y0 = N(y.values[i - 1]), y1 = N(y.values[i]);
    out[i] = x1 != null && y1 != null && x0 != null && y0 != null && x1 > y1 && x0 <= y0 ? 1 : 0;
  }
  return { values: out };
}
function fCrossunder(a: any, b: any, env: Env): Series {
  const x = asSeries(a, env), y = asSeries(b, env);
  const out: (number | null)[] = new Array(env.len).fill(0);
  for (let i = 1; i < env.len; i++) {
    const x0 = N(x.values[i - 1]), x1 = N(x.values[i]), y0 = N(y.values[i - 1]), y1 = N(y.values[i]);
    out[i] = x1 != null && y1 != null && x0 != null && y0 != null && x1 < y1 && x0 >= y0 ? 1 : 0;
  }
  return { values: out };
}

// ---------- tokenizer ----------
interface Tok { t: 'id' | 'num' | 'str' | 'op' | 'nl' | 'eof'; v: string; line: number; col: number }
const OPS = ['>=', '<=', '==', ':=', '=>', '+', '-', '*', '/', '%', '<', '>', '=', '!', '(', ')', '[', ']', ',', '.', '?', ':', '&', '|'];
function tokenize(srcText: string): Tok[] {
  const toks: Tok[] = []; let line = 1, col = 1, i = 0; let parenDepth = 0;
  const push = (t: Tok['t'], v: string) => toks.push({ t, v, line, col });
  while (i < srcText.length) {
    const ch = srcText[i];
    if (ch === '\n') {
      // line continuation: skip newline inside unbalanced parentheses
      if (parenDepth > 0) { i++; line++; col = 1; continue; }
      push('nl', '\n'); i++; line++; col = 1; continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') { i++; col++; continue; }
    if (ch === '#') { while (i < srcText.length && srcText[i] !== '\n') i++; continue; }
    if (ch === '"') { let s = ''; i++; while (i < srcText.length && srcText[i] !== '"') { s += srcText[i++]; } i++; push('str', s); continue; }
    if (ch === '#' && /[0-9a-fA-F]/.test(srcText[i + 1] || '')) {
      let s = '#'; i++; while (i < srcText.length && /[0-9a-fA-F]/.test(srcText[i])) s += srcText[i++];
      push('str', s); continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(srcText[i + 1] || ''))) {
      let s = ''; while (i < srcText.length && /[0-9.eE]/.test(srcText[i])) s += srcText[i++];
      push('num', s); continue;
    }
    if (/[a-zA-Z_]/.test(ch)) { let s = ''; while (i < srcText.length && /[a-zA-Z0-9_]/.test(srcText[i])) s += srcText[i++]; push('id', s); continue; }
    const two = srcText.slice(i, i + 2);
    if (['>=', '<=', '==', ':=', '=>', '!='].includes(two)) { push('op', two); i += 2; continue; }
    if (ch === "'") { let s = ''; i++; while (i < srcText.length && srcText[i] !== "'") s += srcText[i++]; i++; push('str', s); continue; }
    if (OPS.includes(ch)) { if (ch === '(') parenDepth++; else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1); push('op', ch); i++; continue; }
    i++; // skip unknown chars (unicode strings etc.)
  }
  push('eof', '');
  return toks;
}

type Node = any;
// ---------- parser (indentation-aware statements, expression grammar) ----------
class Parser {
  pos = 0;
  constructor(private toks: Tok[]) {}
  peek(o = 0) { let p = this.pos; let skipped = 0; while (true) { const t = this.toks[p]; if (skipped < o && t.t !== 'nl') { p++; skipped++; continue; } return t; } }
  idIs(v: string) { const t = this.peek(); return t.t === 'id' && t.v === v; }
  opIs(v: string) { const t = this.peek(); return t.t === 'op' && t.v === v; }
  eat(t: Tok['t'], v?: string) { const x = this.toks[this.pos]; if (x.t === t && (v === undefined || x.v === v)) { this.pos++; return x; } throw new Error(`Expected ${v ?? t} but got '${x.v}' (line ${x.line})`); }
  skipNl() { while (this.toks[this.pos].t === 'nl') this.pos++; }

  parseProgram(): Node[] {
    const stmts: Node[] = [];
    while (this.peek().t !== 'eof') {
      if (this.peek().t === 'nl') { this.pos++; continue; }
      const s = this.parseStatement(this.peek().col);
      if (s) stmts.push(s);
    }
    return stmts;
  }

  parseStatement(indent: number): Node | null {
    const t = this.peek();
    if (t.t === 'id' && ['if', 'else'].includes(t.v)) return this.parseIf(indent);
    if (t.t === 'id' && ['study', 'indicator', 'strategy'].includes(t.v)) { this.skipToEol(); return null; }
    // (handled generically below: `name = input.int(...)` assignment parses via parseExpr)
    // input.int / input.float etc as statement start: id '.' id ('=' | ':=') ...

    if (t.t === 'id' && ['plot', 'plotshape', 'plotchar', 'plotarrow', 'bgcolor', 'hline'].includes(t.v)) return this.parseCallStmt();
    if (t.t === 'id' && t.v.startsWith('table')) { this.skipToEol(); return null; }
    if (t.t === 'id' && ['var', 'varip'].includes(t.v) && this.toks[this.pos + 2]?.t === 'id') { this.pos++; }
    if (t.t === 'id') {
      // name := expr  or  name = expr   or  name  (bare call like table.new())
      const name = this.eat('id').v;
      if (this.opIs('=') || this.opIs(':=')) { this.pos++; const e = this.parseExpr(); this.finishLine(); return { k: 'assign', name, e }; }
      if (this.opIs('(')) { const args = this.parseArgs(); this.finishLine(); return { k: 'exprstmt', e: { k: 'call', name, args } }; }
      this.finishLine(); return { k: 'assign', name, e: { k: 'ref', name } };
    }
    this.skipToEol(); return null;
  }

  // Handles "input.int(def, "title", minval=..)" used as a bare statement (value unused).
  parseInput2(): Node {
    this.eat('id'); // input
    if (this.opIs('.')) { this.pos++; this.eat('id'); } // .int / .float / .bool / .string / .timeframe
    const args = this.parseArgs();
    this.finishLine();
    return { k: 'exprstmt', e: args.length ? args[0] : { k: 'num', v: 0 } };
  }

  finishLine() { const t = this.peek(); if (t.t === 'nl' || t.t === 'eof') { if (t.t === 'nl') this.pos++; } else this.skipToEol(); }

  skipToEol() { while (this.toks[this.pos].t !== 'nl' && this.toks[this.pos].t !== 'eof') this.pos++; if (this.toks[this.pos].t === 'nl') this.pos++; }

  parseInput(): Node {
    const name = this.eat('id').v;
    this.eat('op', '='); this.eat('id', 'input');
    // input.int(...) / input.float(...) / input.bool(...) — the ".int" was tokenized as op '.' + id.
    if (this.opIs('.')) { this.pos++; this.eat('id'); }
    this.eat('op', '(');
    let def: Node;
    // rare: input( ... ) direct form with source first — treat first arg as default
    def = this.parseExpr();
    let title: Node = { k: 'str', v: name };
    if (this.opIs(',')) { this.pos++; title = this.parseExpr(); }
    const restArgs: Node[] = [];
    while (this.opIs(',')) { this.pos++; restArgs.push(this.parseNamedOrPos()); }
    while (!this.opIs(')') && this.peek().t !== 'eof') this.pos++;
    if (this.opIs(')')) this.pos++;
    this.finishLine();
    return { k: 'input', name, def, title, rest: restArgs };
  }
  parseNamedOrPos(): Node {
    if (this.peek().t === 'id' && this.toks[this.pos + 1]?.t === 'op' && this.toks[this.pos + 1]?.v === '=' ) { const n = this.eat('id').v; this.pos++; const v = this.parseExpr(); return { k: 'named', name: n, v }; }
    return this.parseExpr();
  }

  parseCallStmt(): Node {
    const name = this.eat('id').v;
    const args = this.parseArgs();
    this.finishLine();
    return { k: 'call', name, args };
  }
  parseArgs(): Node[] {
    this.eat('op', '('); const args: Node[] = [];
    this.skipNl();
    if (this.opIs(')')) { this.pos++; return args; }
    while (true) {
      args.push(this.parseNamedOrPos());
      this.skipNl();
      if (this.opIs(',')) { this.pos++; this.skipNl(); continue; }
      break;
    }
    if (this.opIs(')')) this.pos++;
    return args;
  }

  parseIf(indent: number): Node {
    const neg = this.idIs('if') ? false : false;
    this.eat('id'); // if / else
    let cond: Node | null = null;
    if (this.peek().t !== 'nl') cond = this.parseExpr();
    this.finishLine();
    const body = this.parseBlock(indent);
    let els: Node | null = null;
    if (this.idIs('else') && this.peek().col === indent) {
      const save = this.pos;
      const elseIndent = this.peek().col;
      this.pos++;
      if (this.idIs('if')) { els = { k: 'ifelse', e: this.parseIf(elseIndent) }; }
      else { this.finishLine(); els = { k: 'block', body: this.parseBlock(elseIndent) }; }
      void save;
    }
    void neg;
    return { k: 'if', cond, body, els };
  }

  parseBlock(indent: number): Node[] {
    const body: Node[] = [];
    while (true) {
      this.skipNl();
      const t = this.peek();
      if (t.t === 'eof') break;
      if (t.col <= indent) break;
      if (t.t === 'id' && t.v === 'else') break;
      const s = this.parseStatement(t.col);
      if (s) body.push(s);
    }
    return body;
  }

  // ---- expressions (precedence climbing) ----
  parseExpr(): Node { return this.parseTernary(); }
  parseTernary(): Node {
    const c = this.parseOr();
    if (this.opIs('?')) { this.pos++; const a = this.parseTernary(); this.eat('op', ':'); const b = this.parseTernary(); return { k: 'tern', c, a, b }; }
    return c;
  }
  parseOr(): Node {
    let l = this.parseAnd();
    while (this.idIs('or') || (this.peek().t === 'id' && this.peek().v.toLowerCase() === 'or')) { this.pos++; l = { k: 'or', l, r: this.parseAnd() }; }
    return l;
  }
  parseAnd(): Node {
    let l = this.parseNot();
    while (this.idIs('and') || this.opIs('&')) { this.pos++; l = { k: 'and', l, r: this.parseNot() }; }
    return l;
  }
  parseNot(): Node {
    if (this.idIs('not') || this.opIs('!')) { this.pos++; return { k: 'not', e: this.parseNot() }; }
    return this.parseCompare();
  }
  parseCompare(): Node {
    let l = this.parseAdd();
    while (['==', '=', '!=', '>=', '<=', '>', '<'].some(o => this.opIs(o))) {
      const op = this.eat('op').v; l = { k: 'bin', op: op === '=' ? '==' : op, l, r: this.parseAdd() };
    }
    return l;
  }
  parseAdd(): Node {
    let l = this.parseMul();
    while (this.opIs('+') || this.opIs('-')) { const op = this.eat('op').v; l = { k: 'bin', op, l, r: this.parseMul() }; }
    return l;
  }
  parseMul(): Node {
    let l = this.parseUnary();
    while (this.opIs('*') || this.opIs('/') || this.opIs('%')) { const op = this.eat('op').v; l = { k: 'bin', op, l, r: this.parseUnary() }; }
    return l;
  }
  parseUnary(): Node {
    if (this.opIs('-')) { this.pos++; return { k: 'neg', e: this.parseUnary() }; }
    if (this.opIs('+')) { this.pos++; return this.parseUnary(); }
    return this.parsePostfix();
  }
  parsePostfix(): Node {
    let e = this.parsePrimary();
    while (true) {
      if (this.opIs('.')) { this.pos++; const prop = this.eat('id').v; e = { k: 'prop', obj: e, prop }; continue; }
      if (this.opIs('[')) { this.pos++; const idx = this.parseExpr(); if (this.opIs(']')) this.pos++; e = { k: 'index', obj: e, idx }; continue; }
      break;
    }
    return e;
  }
  parsePrimary(): Node {
    const t = this.peek();
    if (t.t === 'num') { this.pos++; return { k: 'num', v: parseFloat(t.v) }; }
    if (t.t === 'str') { this.pos++; return { k: 'str', v: t.v }; }
    if (t.t === 'op' && t.v === '(') { this.pos++; const e = this.parseExpr(); if (this.opIs(')')) this.pos++; return e; }
    if (t.t === 'id') {
      const name = this.eat('id').v;
      if (this.opIs('(')) { const args = this.parseArgs(); return this.parsePrimaryAfterId(name, { k: 'call', name, args }); }
      return { k: 'ref', name };
    }
    throw new Error(`Unexpected token '${t.v}' at line ${t.line}`);
  }
  parsePrimaryAfterId(name: string, node: Node): Node { return node; }
}

// ---------- evaluator ----------
class Interp {
  plots: PlotDef[] = []; hlines: HLine[] = []; tables: TableOut[] = [];
  errors: string[] = []; warnings: string[] = [];
  env: Env;
  constructor(private bars: BarLite[], tfSec: number) {
    const len = bars.length;
    this.env = new Env(len);
    this.times = bars.map(b => b.time);
    this.openArr = bars; this.highArr = bars; this.lowArr = bars; this.volumeArr = bars.map(b => b.volume ?? 0);
    const mk = (sel: (b: BarLite) => number) => ({ values: bars.map(sel) });
    this.openS = mk(b => b.open); this.highS = mk(b => b.high); this.lowS = mk(b => b.low); this.closeS = mk(b => b.close);
    this.volumeS = { values: this.volumeArr };
    this.hla3 = { values: bars.map(b => (b.high + b.low + b.close) / 3) };
    this.env.setSeries('close', this.closeS); this.env.setSeries('open', this.openS);
    this.env.setSeries('high', this.highS); this.env.setSeries('low', this.lowS);
    this.env.setSeries('volume', this.volumeS); this.env.setSeries('hl2', { values: bars.map(b => (b.high + b.low) / 2) });
    this.env.setSeries('hlc3', this.hla3); this.env.setSeries('ohlc4', { values: bars.map(b => (b.open + b.high + b.low + b.close) / 4) });
    this.env.setSeries('time', { values: this.times });
    Object.assign(this.env, { highS: this.highS, lowS: this.lowS, closeS: this.closeS, openS: this.openS, volumeS: this.volumeS, times: this.times, openArr: this.openArr, highArr: this.highArr, lowArr: this.lowArr, volumeArr: this.volumeArr });
    this.env.setConst('bar_index', null);
    this.tfSec = tfSec;
  }
  times: number[]; openArr: BarLite[]; highArr: BarLite[]; lowArr: BarLite[]; volumeArr: number[];
  openS!: Series; highS!: Series; lowS!: Series; closeS!: Series; volumeS!: Series; hla3!: Series; tfSec: number;

  run(program: Node[]) { for (const s of program) { try { this.exec(s, this.env); } catch (e: any) { this.errors.push(String(e?.message || e)); } } }

  exec(node: Node, env: Env): any {
    switch (node.k) {
      case 'assign': { const v = this.eval(node.e, env); env.setSeries(node.name, asSeries(v, env)); return null; }
      case 'input': { const v = this.eval(node.def, env); env.setSeries(node.name, asSeries(v, env)); return null; }
      case 'call': return this.callStmt(node, env);
      case 'if': {
        const c = asSeries(this.eval(node.cond, env), env);
        // execute body where condition true (series-level if: evaluate body once per bar mask)
        if (c.values.some(x => N(x) != null && x !== 0)) this.execBlock(node.body, env, c);
        if (node.els) { const inv: Series = { values: c.values.map(v => (N(v) != null && v !== 0) ? 0 : 1) }; this.execEls(node.els, env, inv); }
        return null;
      }
      case 'block': this.execBlock(node.body, env); return null;
      case 'exprstmt': this.eval(node.e, env); return null;
      default: this.eval(node, env); return null;
    }
  }
  execEls(els: Node, env: Env, mask: Series) { if (els.k === 'ifelse') this.exec(els.e, env); else this.execBlock(els.body, env, mask); }
  execBlock(body: Node[], env: Env, mask?: Series) {
    for (const s of body) {
      try {
        if (mask && (s.k === 'assign')) { // conditional assignment: blend previous value where mask false
          const newVal = asSeries(this.eval(s.e, env), env);
          const old = env.vars.get(s.name)?.values ?? new Array(env.len).fill(null);
          const blended = newVal.values.map((v, i) => (N(mask.values[i]) != null && mask.values[i] !== 0) ? v : old[i]);
          env.setSeries(s.name, { values: blended });
        } else this.exec(s, env);
      } catch (e: any) { this.warnings.push(String(e?.message || e)); }
    }
  }

  callStmt(node: Node, env: Env): any {
    const n = node.name;
    const args = node.args || [];
    if (n === 'plot' || n === 'plotshape' || n === 'plotchar' || n === 'plotarrow') {
      const series = asSeries(this.eval(args[0], env), env);
      const title = args[1]?.k === 'str' ? args[1].v : n;
      const named = (nm: string): Node | undefined => args.find((a: Node) => (a.k === 'named' && a.name === nm) || (a.k === 'bin' && a.op === '==' && a.l?.k === 'id' && a.l.name === nm));
      let color: string | ((i: number) => string) = '#2196f3';
      const colorNamed = named('color');
      const cv = colorNamed ? (colorNamed.k === 'named' ? colorNamed.v : colorNamed.r) : (args[2] && args[2].k !== 'named' && !(args[2].k === 'bin' && args[2].l?.k === 'id') ? args[2] : undefined);
      if (cv) { if (cv.k === 'str') color = cv.v; else { const cs = asSeries(this.eval(cv, env), env); color = (i: number) => String(cs.values[i] ?? '#2196f3'); } }
      const namedNode = (nm: string): Node | undefined => { const x = named(nm); return x ? (x.k === 'named' ? x.v : x.r) : undefined; };
      const styleArg = named('style') ? { v: namedNode('style') } : undefined;
      const locArg = named('location') ? { v: namedNode('location') } : undefined;
      const shArg = named('title') ? { v: namedNode('title') } : undefined;
      const kind: PlotKind = n === 'plot' ? 'line' : 'shape';
      let style = '';
      if (styleArg && styleArg.v.k === 'prop') style = styleColorName(styleArg.v.prop);
      this.plots.push({ kind, title: shArg && shArg.v.k === 'str' ? shArg.v.v : title, color, series, style, location: locArg && locArg.v.k === 'prop' ? (locArg.v.prop.includes('above') ? 'abovebar' : locArg.v.prop.includes('below') ? 'belowbar' : 'top') : 'top' });
      return null;
    }
    if (n === 'bgcolor') {
      const cs = asSeries(this.eval(args[0], env), env);
      this.plots.push({ kind: 'histogram', title: '__bg', color: (i: number) => String(cs.values[i] ?? ''), series: { values: cs.values.map(v => (N(v) != null && v !== 0 ? 1 : 0)) }, style: 'bg' });
      return null;
    }
    if (n === 'hline') {
      const price = N(this.eval(args[0], env)) ?? 0;
      let color = '#787b86'; if (args[1]?.k === 'str') color = args[1].v;
      this.hlines.push({ price, color, title: args[2]?.k === 'str' ? args[2].v : '' });
      return null;
    }
    if (n.startsWith('table')) { this.tables.push({ cells: [], title: 'table' }); return null; }
    return this.evalCall(n, args, env);
  }

  eval(node: Node, env: Env): any {
    switch (node.k) {
      case 'num': return { values: Array(env.len).fill(node.v) };
      case 'str': return { values: Array(env.len).fill(node.v) };
      case 'ref': {
        const v = env.vars.get(node.name); if (v) return v;
        const lower = node.name.toLowerCase();
        if (lower === 'true') return { values: Array(env.len).fill(1) };
        if (lower === 'false') return { values: Array(env.len).fill(0) };
        if (lower === 'na') return { values: Array(env.len).fill(null) };
        if (['green','red','blue','yellow','white','gray','grey','orange','purple','aqua','fuchsia','lime','teal','maroon','navy','olive','silver'].includes(lower)) return { values: Array(env.len).fill(colorHex(node.name)) };
        if (node.name === 'bar_index') return { values: Array.from({ length: env.len }, (_, i) => i) };
        this.warnings.push(`unknown identifier: ${node.name}`);
        return { values: Array(env.len).fill(null) };
      }
      case 'prop': {
        const obj = this.eval(node.obj, env);
        // bb.upper / bb.lower / macd.macd etc — handle via marker objects
        if (obj && obj.__kind === 'bb') return node.prop === 'upper' ? obj.upper : node.prop === 'lower' ? obj.lower : obj.basis;
        if (obj && obj.__kind === 'macd') return node.prop === 'signal' ? obj.signal : node.prop === 'histogram' ? obj.hist : obj.macd;
        if (obj && obj.__kind === 'stoch') return node.prop === 'd' ? obj.d : obj.k;
        if (obj && obj.__kind === 'color') return { values: Array(env.len).fill(obj.name) };
        if (obj && obj.__kind === 'tf') return this.requestTF(node.prop);
        if (obj && obj.__kind === 'ta') return { __kind: 'fn', name: node.prop };
        if (obj && obj.__kind === 'math') return { __kind: 'fn', name: node.prop };
        if (obj && obj.__kind === 'timeframe') return { values: Array(env.len).fill(this.tfSec * 1000) };
        const s = asSeries(obj, env);
        // series properties: .1 [offset], .length etc
        if (/^\d+$/.test(node.prop)) { const off = parseInt(node.prop); return { values: s.values.map((_, i) => s.values[Math.max(0, i - off)]) }; }
        return s;
      }
      case 'index': {
        const s = asSeries(this.eval(node.obj, env), env);
        const idx = asSeries(this.eval(node.idx, env), env);
        return { values: s.values.map((v, i) => { const k = N(idx.values[i]); return k == null ? v : s.values[Math.max(0, i - Math.round(k))]; }) };
      }
      case 'neg': { const s = asSeries(this.eval(node.e, env), env); return { values: s.values.map(v => (N(v) == null ? null : -(v as number))) }; }
      case 'not': { const s = asSeries(this.eval(node.e, env), env); return { values: s.values.map(v => (N(v) != null && v !== 0 ? 0 : 1)) }; }
      case 'and': { const a = asSeries(this.eval(node.l, env), env), b = asSeries(this.eval(node.r, env), env); return { values: a.values.map((v, i) => (truthy(v) && truthy(b.values[i]) ? 1 : 0)) }; }
      case 'or': { const a = asSeries(this.eval(node.l, env), env), b = asSeries(this.eval(node.r, env), env); return { values: a.values.map((v, i) => (truthy(v) || truthy(b.values[i]) ? 1 : 0)) }; }
      case 'tern': {
        const c = asSeries(this.eval(node.c, env), env), a = asSeries(this.eval(node.a, env), env), b = asSeries(this.eval(node.b, env), env);
        return { values: c.values.map((v, i) => (truthy(v) ? a.values[i] : b.values[i])) };
      }
      case 'bin': {
        const a = asSeries(this.eval(node.l, env), env), b = asSeries(this.eval(node.r, env), env);
        const op = node.op;
        return { values: a.values.map((x, i) => { const y = b.values[i];
          if (op === '==') return (sameVal(x, y) ? 1 : 0);
          if (op === '!=') return (sameVal(x, y) ? 0 : 1);
          const nx = N(x), ny = N(y);
          if (nx == null || ny == null) {
            if (typeof x === 'string' || typeof y === 'string') {
              if (op === '>') return (String(x) > String(y) ? 1 : 0);
              if (op === '<') return (String(x) < String(y) ? 1 : 0);
              if (op === '>=') return (String(x) >= String(y) ? 1 : 0);
              if (op === '<=') return (String(x) <= String(y) ? 1 : 0);
            }
            return null;
          }
          switch (op) { case '+': return nx + ny; case '-': return nx - ny; case '*': return nx * ny; case '/': return ny === 0 ? null : nx / ny; case '%': return ny === 0 ? null : nx % ny; case '>': return nx > ny ? 1 : 0; case '<': return nx < ny ? 1 : 0; case '>=': return nx >= ny ? 1 : 0; case '<=': return nx <= ny ? 1 : 0; }
          return null; }) };
      }
      case 'call': {
        const callee = this.resolveCallee(node.name);
        if (callee) { const bound = node.args.map((a: Node) => this.evalArg(a, env)); return callee(bound, env); }
        // ta.sma style calls handled in evalCall via prop chain: name may be 'ta' -> handled below
        const inner = this.evalCall(node.name, node.args, env);
        return inner;
      }
      default: return { values: Array(env.len).fill(null) };
    }
  }

  evalArg(a: Node, env: Env): any { if (a.k === 'named') return { __named: true, name: a.name, v: this.eval(a.v, env) }; return this.eval(a, env); }

  resolveCallee(name: string): ((args: any[], env: Env) => any) | null {
    const map: Record<string, (args: any[], env: Env) => any> = {
      sma: (a, e) => fSma(a, e), ema: (a, e) => fEma(a, e), rsi: (a, e) => fRsi(a, e),
      wma: (a, e) => fWma(a, e), hullma: (a, e) => fHullMA(a, e), atr: (a, e) => fAtr(a, e),
      highest: (a, e) => fHighest(a, e), lowest: (a, e) => fLowest(a, e),
      vwap: (_a, e) => fVwap([], e), wpr: (a, e) => fWpr(a, e),
      crossover: (a, e) => fCrossover(a[0], a[1], e), crossunder: (a, e) => fCrossunder(a[0], a[1], e),
      abs: a => unaryMath(a, Math.abs), log: a => unaryMath(a, Math.log), ln: a => unaryMath(a, Math.log),
      sqrt: a => unaryMath(a, Math.sqrt), pow: a => binMath(a, Math.pow), max: a => aggMath(a, (x, y) => Math.max(x, y)), min: a => aggMath(a, (x, y) => Math.min(x, y)),
      round: a => unaryMath(a, Math.round), floor: a => unaryMath(a, Math.floor), ceil: a => unaryMath(a, Math.ceil),
      nz: (a, e) => { const s = asSeries(a[0], e); const d = a[1] != null ? asSeries(a[1], e) : null; return { values: s.values.map((v, i) => v == null ? (d ? d.values[i] ?? 0 : 0) : v) }; },
      iff: (a, e) => { const c = asSeries(a[0], e), x = asSeries(a[1], e), y = asSeries(a[2], e); return { values: c.values.map((v, i) => truthy(v) ? x.values[i] : y.values[i]) }; },
      time_close: () => ({ values: [] }),
    };
    return map[name] || null;
  }

  evalCall(name: string, argNodes: Node[], env: Env): any {
    const args = argNodes.map(a => this.evalArg(a, env));
    if (name === 'ta') return { __kind: 'fn', name: '' };
    if (name === 'request' || name === 'syminfo' || name === 'chart') return { __kind: 'tf' };
    if (name === 'color') return { __kind: 'color', name: '' };
    if (name === 'bb') { // builtin convenience: bb(src, len, mult) -> object
      const basis = fSma([args[0], args[1]], env);
      const mult = N(args[2]) ?? 2;
      const upper: Series = { values: basis.values.map((v, i) => { const s = stdDevOver(asSeries(args[1], env).values, i, period(args[0], env)); return v == null || s == null ? null : v + mult * s; }) };
      const lower: Series = { values: basis.values.map((v, i) => { const s = stdDevOver(asSeries(args[1], env).values, i, period(args[0], env)); return v == null || s == null ? null : v - mult * s; }) };
      return { __kind: 'bb', basis, upper, lower };
    }
    if (name === 'macd') {
      const fast = fEma([args[0] ?? { values: [12] }, args[3] ?? this.env.closeS], env);
      const slow = fEma([args[1] ?? { values: [26] }, args[3] ?? this.env.closeS], env);
      const macdS: Series = { values: fast.values.map((v, i) => { const s = N(slow.values[i]); return v == null || s == null ? null : (v as number) - s; }) };
      const signal = fEma([args[2] ?? { values: [9] }, macdS], env);
      const hist: Series = { values: macdS.values.map((v, i) => { const s = N(signal.values[i]); return v == null || s == null ? null : (v as number) - s; }) };
      return { __kind: 'macd', macd: macdS, signal, hist };
    }
    if (name === 'stoch') {
      const k = fStoch(args, env);
      const d = fSma([{ literal: 3 }, k], env);
      return { __kind: 'stoch', k, d };
    }
    const known = ['sma','ema','rsi','wma','hullma','atr','highest','lowest','vwap','wpr','crossover','crossunder','abs','log','ln','sqrt','pow','max','min','round','floor','ceil','nz','iff','stdev','cum','change','ta'];
    if (known.includes(name)) {
      const fn = this.resolveCallee(name.toLowerCase());
      if (fn) return fn(args, env);
    }
    this.warnings.push(`unsupported function: ${name}`);
    return { values: Array(env.len).fill(null) };
  }

  requestTF(prop: string): any {
    // request.security-like: approximate higher TF by aggregating current bars
    const m: Record<string, number> = { minute: 60, '3minute': 180, five: 300, fifteen: 900, thirty: 1800, hour: 3600, '3hour': 10800, '6hour': 21600, daily: 86400, weekly: 604800, monthly: 2592000 };
    const secs = m[prop.replace('security_', '')] ?? this.tfSec;
    const step = Math.max(1, Math.round(secs / this.tfSec));
    const c = this.closeS.values;
    return { values: c.map((_v, i) => { const end = Math.min(c.length - 1, Math.ceil((i + 1) / step) * step - 1); return c[end]; }) };
  }
}

function unaryMath(args: any[], f: (x: number) => number) { const s = args[0]; return { values: (s.values || []).map((v: any) => (typeof v === 'number' && isFinite(v) ? f(v) : null)) }; }
function binMath(args: any[], f: (x: number, y: number) => number) { const a = args[0], b = args[1]; return { values: a.values.map((v: any, i: number) => (typeof v === 'number' && typeof b.values[i] === 'number' ? f(v, b.values[i]) : null)) }; }
function aggMath(args: any[], f: (x: number, y: number) => number) { const vals = args.filter((a: any) => a?.values); return { values: vals[0].values.map((_: any, i: number) => { let acc: number | null = null; for (const s of vals) { const v = s.values[i]; if (typeof v === 'number') acc = acc == null ? v : f(acc, v); } return acc; }) }; }

function stdDevOver(arr: (number | null)[], i: number, p: number): number | null {
  if (i < p - 1) return null;
  const xs = arr.slice(i - p + 1, i + 1).map(v => N(v)); if (xs.some(v => v == null)) return null;
  const m = (xs as number[]).reduce((a, b) => a + b, 0) / p;
  return Math.sqrt((xs as number[]).reduce((a, b) => a + (b - m) ** 2, 0) / p);
}

function asSeries(v: any, env: Env): Series {
  if (v == null) return { values: Array(env.len).fill(null) };
  if (Array.isArray(v.values)) return v;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return { values: Array(env.len).fill(typeof v === 'boolean' ? (v ? 1 : 0) : v) };
  return { values: Array(env.len).fill(null) };
}
function period(a: any, env: Env): number { const s = asSeries(a, env); return Math.max(1, Math.round(N(s.values[s.values.length - 1]) ?? 14)); }
function truthy(v: any): boolean { if (typeof v === 'number') return v !== 0 && isFinite(v); if (typeof v === 'string') return !/^#[0-9a-fA-F]+$/.test(v); return false; }
function sameVal(a: any, b: any): boolean { if (a == null || b == null) return false; if (typeof a === 'string' || typeof b === 'string') return String(a).toLowerCase() === String(b).toLowerCase(); return a === b; }
function colorHex(name: string): string {
  const map: Record<string, string> = { green: '#089981', red: '#f23645', blue: '#2962ff', yellow: '#fbcc2b', white: '#ffffff', gray: '#787b86', grey: '#787b86', orange: '#ff6d00', purple: '#9c27b0', aqua: '#00fff6', fuchsia: '#ff00ff', lime: '#00ff00', teal: '#008080', maroon: '#800000', navy: '#000080', olive: '#808000', silver: '#c0c0c0' };
  return map[name.toLowerCase()] || '#2196f3';
}
function styleColorName(prop: string): string {
  const p = prop.toLowerCase();
  if (p.includes('histogram')) return 'histogram';
  if (p.includes('area')) return 'area';
  if (p.includes('cross')) return 'cross';
  if (p.includes('circles')) return 'circles';
  return '';
}

export interface BarLite { time: number; open: number; high: number; low: number; close: number; volume?: number }

export function runPine(code: string, bars: BarLite[], tfSec: number): PineResult {
  try {
    const toks = tokenize(code);
    const program = new Parser(toks).parseProgram();
    const it = new Interp(bars, tfSec);
    it.run(program);
    return { plots: it.plots, hlines: it.hlines, tables: it.tables, errors: it.errors, warnings: [...new Set(it.warnings)] };
  } catch (e: any) {
    return { plots: [], hlines: [], tables: [], errors: [String(e?.message || e)], warnings: [] };
  }
}
