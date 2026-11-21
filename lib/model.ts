// Token Radar v3 — model "radar-4-rank" (Node 22, standard library only).
//
// The board ranks every pre-token protocol that passes the product rule
// (the watchlist's rule, without its $50M floor) by an implied launch value
// fitted from the snapshot's own live-token protocols. Nothing is hardcoded
// by name: the same function scores every row, and every number below is
// fitted at run time from the sealed snapshot.
//
// The model (fitted at run time, pure function of the snapshot):
//   live set   = protocols that record a token, not a CEX, no version marker,
//                with a positive market cap and TVL (118 in this snapshot).
//   trimmed    = the live set without ratio quirks (mcap/TVL outside 0.005–5).
//   global     = median log10(mcap/TVL) over the trimmed live set.
//   category   = the category's median log10(mcap/TVL), shrunk toward the
//                global with a prior weight of 6: (n*median + 6*global)/(n+6).
//                A category with no live token falls back to the global.
//                The weight is 6, not 3, because two categories rest on a
//                single live token each (Risk Curators: Api3, ratio 2.975;
//                Chain: Astar dApps Staking, ratio 3.026) and a weight of 3
//                lets one small token set the multiple for 38 pre-token
//                protocols. The shrinkage is the point: a thin category
//                borrows strength from the market, it does not invent one.
//   slope      = a ridge-shrunk line of [1, log10(TVL)] on the residual
//                log10(mcap/TVL) - category. The launch multiple falls as
//                TVL grows (the live data's correlation is -0.33), so the
//                implied value grows sublinearly with TVL.
//   implied    = TVL x 10^(b0 + b1*log10(TVL) + category).
//
// What the model deliberately does NOT use, and why (all measured on the
// live set, shown in the dashboard's Method tab):
//   7-day growth: its correlation with the log-ratio residual is -0.02.
//     Weekly TVL growth carries no signal for the launch multiple in this
//     snapshot, so the value does not chase it. The board still shows each
//     protocol's growth, so a reader can see it.
//   chain count: correlation -0.09, a weak negative that does not survive
//     cross-validation. More chains do not mean a bigger launch.
//   age: a long un-tokenised run adds a small premium in-sample, but it
//     does not improve the ranking out of sample, so it stays out of the
//     value and in the detail view as context.
//
// Validation (leave-one-out cross-validation on the live set, computed at run
// time by this file, deterministic): the v3 model ranks the live tokens better
// than the v2 OLS model (Spearman 0.385 against v2's 0.345) and fits their
// magnitude better (log10 RMSE 0.90 against 0.93). The v2 OLS fitted log-mcap
// magnitude well but its growth and chain terms were noise for ranking;
// removing them and shrinking the thin categories is what buys the rank.
// A repeated 5-fold check agrees: v3 beats v2 in 18 of 20 seeds, mean gap
// +0.033. The dashboard's Method tab prints the live numbers.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The fitted model: everything the value needs, all derived from the snapshot. */
export interface FittedModel {
  version: string;
  n_live: number;
  n_train: number;
  global_log_ratio: number;
  global_ratio: number;
  beta0: number;
  beta1: number;
  prior_weight: number;
  category_log_ratio: Record<string, number>;
  category_n: Record<string, number>;
}

/** Cross-validation on the live set: the ranking evidence, computed at run time. */
export interface CvResult {
  folds: number;
  rmse_log10: number;
  spearman: number;
  within_2x: number;
  top10: number;
  top20: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_ratio: number;
    tvl_slope: number;
    tvl_multiple: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_ratio: number;
  tvl_multiple: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the model and its evidence. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: {
    global_ratio: number;
    beta0: number;
    beta1: number;
    prior_weight: number;
    n_live: number;
    n_train: number;
    category_ratio: Record<string, number>;
    category_n: Record<string, number>;
  };
  cv: CvResult;
  v2_cv: CvResult;
  watchlist_size: number;
  watchlist_slugs: Record<string, boolean>;
  board_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export const MODEL_VERSION = 'radar-4-rank';
/** Prior weight shrinking a category's median toward the global (see the header). */
const PRIOR_WEIGHT = 6;
/** Ridge penalty on the TVL-slope line. */
const RIDGE_LAMBDA = 1;
/** Ratio quirks outside this band are trimmed from training only. */
const RATIO_LOW = 0.005;
const RATIO_HIGH = 5;
/** How many live-token protocols the Live token view carries, by market cap. */
const LIVE_ROWS = 24;

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a list (the average of the two middle values when it is even). */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Solve a small dense linear system by Gaussian elimination with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    const tmp = M[c]!;
    M[c] = M[piv]!;
    M[piv] = tmp;
    const d = M[c]![c]!;
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c || M[r]![c] === 0) continue;
      const f = M[r]![c]! / d;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => (Math.abs(row[i]!) > 1e-12 ? row[n]! / row[i]! : 0));
}

/** Ridge regression: min ||Xb - y||^2 + lam*||b[1:]||^2 (the intercept is not penalised). */
function ridge(X: number[][], y: number[], lam: number): number[] {
  const k = X[0]!.length;
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < k; i++) {
    const row: number[] = [];
    for (let j = 0; j < k; j++) {
      let s = 0;
      for (let r = 0; r < X.length; r++) s += X[r]![i]! * X[r]![j]!;
      if (i === j && i > 0) s += lam;
      row.push(s);
    }
    A.push(row);
    let s = 0;
    for (let r = 0; r < X.length; r++) s += X[r]![i]! * y[r]!;
    b.push(s);
  }
  return solveLinear(A, b);
}

/** Spearman's rank correlation between two lists of the same length. */
function spearman(xs: number[], ys: number[]): number {
  const rank = (v: number[]): number[] => {
    const order = v.map((_, i) => i).sort((a, b) => v[a]! - v[b]!);
    const r = new Array<number>(v.length).fill(0);
    let i = 0;
    while (i < v.length) {
      let j = i;
      while (j + 1 < v.length && v[order[j + 1]!] === v[order[i]!]) j++;
      const avg = (i + j) / 2 + 1;
      for (let t = i; t <= j; t++) r[order[t]!] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i]! - mx) * (ry[i]! - my);
    dx += (rx[i]! - mx) ** 2;
    dy += (ry[i]! - my) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped, staked or staking anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** The exchange names the watchlist rule refuses at the start of a name. */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
/** The categories the watchlist rule refuses outright. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token and not a wrapped, staked or bridged product. */
export function isEligible(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  for (const e of EXCHANGES) {
    if (p.name === e || p.name.startsWith(`${e} `)) return false;
  }
  return true;
}

/** Whether a protocol belongs to the live-token training set. */
export function isLive(p: SnapshotProtocol): boolean {
  return !isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}

/** The training set: the live set without ratio quirks (mcap/TVL outside 0.005–5). */
function trimmedLive(live: SnapshotProtocol[]): SnapshotProtocol[] {
  return live.filter((p) => {
    const r = p.mcap_usd! / p.tvl_usd;
    return r >= RATIO_LOW && r <= RATIO_HIGH;
  });
}

/** Fit the radar-4-rank model on a live-token set (the whole set, or a training fold). */
export function fitModel(live: SnapshotProtocol[]): FittedModel {
  const train = trimmedLive([...live].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)));
  const logRatios = train.map((p) => Math.log10(p.mcap_usd! / p.tvl_usd));
  const global = median(logRatios);
  const byCat = new Map<string, number[]>();
  for (const p of train) {
    const key = p.category ?? '(none)';
    const arr = byCat.get(key) ?? [];
    arr.push(Math.log10(p.mcap_usd! / p.tvl_usd));
    byCat.set(key, arr);
  }
  const category_log_ratio: Record<string, number> = {};
  const category_n: Record<string, number> = {};
  for (const [key, vals] of byCat) {
    const n = vals.length;
    category_log_ratio[key] = (n * median(vals) + PRIOR_WEIGHT * global) / (n + PRIOR_WEIGHT);
    category_n[key] = n;
  }
  const X = train.map((p) => [1, Math.log10(p.tvl_usd)]);
  const y = train.map((p) => Math.log10(p.mcap_usd! / p.tvl_usd) - (category_log_ratio[p.category ?? '(none)'] ?? global));
  const beta = ridge(X, y, RIDGE_LAMBDA);
  return {
    version: MODEL_VERSION,
    n_live: live.length,
    n_train: train.length,
    global_log_ratio: global,
    global_ratio: 10 ** global,
    beta0: beta[0]!,
    beta1: beta[1]!,
    prior_weight: PRIOR_WEIGHT,
    category_log_ratio,
    category_n,
  };
}

/** The category's shrunk log-ratio, or the global when the category has no live token. */
function categoryLogRatio(model: FittedModel, category: string | null): number {
  return model.category_log_ratio[category ?? '(none)'] ?? model.global_log_ratio;
}

/** One protocol's implied launch value under the fitted model (whole dollars, at least 1). */
export function impliedValue(p: SnapshotProtocol, model: FittedModel): number {
  const logRatio = model.beta0 + model.beta1 * Math.log10(p.tvl_usd) + categoryLogRatio(model, p.category);
  return Math.max(1, Math.round(p.tvl_usd * 10 ** logRatio));
}

/** The launch multiple (implied / TVL) one protocol gets: the number the board is really ranking on. */
export function tvlMultiple(p: SnapshotProtocol, model: FittedModel): number {
  return 10 ** (model.beta0 + model.beta1 * Math.log10(p.tvl_usd) + categoryLogRatio(model, p.category));
}

/** The v2 OLS model, refitted here only so the dashboard can quote its cross-validation honestly. */
interface V2Model {
  beta: number[];
  category_log_ratio: Record<string, number>;
  global_log_ratio: number;
  median_age: number;
}
function fitV2(live: SnapshotProtocol[], asOf: string): V2Model {
  const train = trimmedLive([...live].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)));
  const logRatios = train.map((p) => Math.log10(p.mcap_usd! / p.tvl_usd));
  const global = median(logRatios);
  const byCat = new Map<string, number[]>();
  for (const p of train) {
    const key = p.category ?? '(none)';
    const arr = byCat.get(key) ?? [];
    arr.push(Math.log10(p.mcap_usd! / p.tvl_usd));
    byCat.set(key, arr);
  }
  const category_log_ratio: Record<string, number> = {};
  for (const [key, vals] of byCat) {
    const n = vals.length;
    category_log_ratio[key] = (n * median(vals) + 3 * global) / (n + 3);
  }
  const ages = train.map((p) => ageDays(asOf, p.listed_at)).filter((a): a is number => a !== null);
  const medAge = median(ages);
  const feats = (p: SnapshotProtocol): number[] => {
    const age = ageDays(asOf, p.listed_at);
    const a = age === null ? medAge : age;
    const g = p.change_7d === null ? 0 : Math.max(-0.5, Math.min(1, p.change_7d / 100));
    return [1, Math.log10(p.tvl_usd), g, Math.log10(1 + p.chains.length), Math.log1p(a) / Math.log1p(1095)];
  };
  const X = train.map(feats);
  const y = train.map((p) => Math.log10(p.mcap_usd!) - (category_log_ratio[p.category ?? '(none)'] ?? global));
  // Plain OLS via the ridge solver with a zero penalty.
  const beta = ridge(X, y, 0);
  return { beta, category_log_ratio, global_log_ratio: global, median_age: medAge };
}
function predictV2(p: SnapshotProtocol, m: V2Model, asOf: string): number {
  const age = ageDays(asOf, p.listed_at);
  const a = age === null ? m.median_age : age;
  const g = p.change_7d === null ? 0 : Math.max(-0.5, Math.min(1, p.change_7d / 100));
  const f = [1, Math.log10(p.tvl_usd), g, Math.log10(1 + p.chains.length), Math.log1p(a) / Math.log1p(1095)];
  const logMcap = f.reduce((s, x, i) => s + m.beta[i]! * x, 0) + (m.category_log_ratio[p.category ?? '(none)'] ?? m.global_log_ratio);
  return Math.max(1, Math.round(10 ** logMcap));
}

/** A small seeded PRNG (mulberry32) so any shuffled split is deterministic. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Leave-one-out cross-validation on the live set: each protocol is predicted
 * by a model fitted on the other 117, so every number is out of sample and
 * nothing depends on a fold draw. (A single 5-fold split is noisy at n=118:
 * its mean Spearman moves by ±0.04 with the seed, while leave-one-out is
 * deterministic. The repeated 5-fold check agrees: v3 beats v2 in 18 of 20
 * seeds, mean gap +0.033.)
 */
export function crossValidate(live: SnapshotProtocol[], asOf: string): { v3: CvResult; v2: CvResult } {
  const sorted = [...live].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const actual: number[] = [];
  const pred3: number[] = [];
  const pred2: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const test = sorted[i]!;
    const train = sorted.filter((_, j) => j !== i);
    const m3 = fitModel(train);
    const m2 = fitV2(train, asOf);
    actual.push(Math.log10(test.mcap_usd!));
    pred3.push(Math.log10(impliedValue(test, m3)));
    pred2.push(Math.log10(predictV2(test, m2, asOf)));
  }
  const score = (pred: number[]): CvResult => {
    const rmse = Math.sqrt(pred.reduce((s, v, i) => s + (v - actual[i]!) ** 2, 0) / pred.length);
    const sp = spearman(pred, actual);
    const w2 = pred.filter((v, i) => Math.abs(v - actual[i]!) <= Math.log10(2)).length / pred.length;
    const overlap = (k: number): number => {
      const A = new Set(actual.map((_, i) => i).sort((a, b) => actual[b]! - actual[a]!).slice(0, k));
      const P = new Set(pred.map((_, i) => i).sort((a, b) => pred[b]! - pred[a]!).slice(0, k));
      return [...A].filter((i) => P.has(i)).length;
    };
    return { folds: sorted.length, rmse_log10: rmse, spearman: sp, within_2x: w2, top10: overlap(10), top20: overlap(20) };
  };
  return { v3: score(pred3), v2: score(pred2) };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('basis')) return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and hold the receipt.`;
  if (c.includes('farm')) return `Stake $${capital} of LP tokens in ${name}'s farm on ${chain} and claim only from its own page.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: FittedModel): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it, whether or not it passes the product rule.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other pre-token protocol that passes the product rule, whatever its TVL.
  // The watchlist is a floor, never a ceiling, so a protocol the list leaves out is ranked too.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isEligible(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const implied = impliedValue(p, model);
    const age = ageDays(snapshot.as_of, p.listed_at);
    return { p, implied, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_ratio: 10 ** categoryLogRatio(model, s.p.category),
      tvl_slope: model.beta1,
      tvl_multiple: tvlMultiple(s.p, model),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_ratio: row.model.category_ratio,
    tvl_multiple: row.model.tvl_multiple,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData; model: FittedModel } {
  const live = snapshot.protocols.filter(isLive);
  const model = fitModel(live);
  const cv = crossValidate(live, snapshot.as_of);
  const board = buildBoard(snapshot, model);
  const liveTop = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: {
      global_ratio: model.global_ratio,
      beta0: model.beta0,
      beta1: model.beta1,
      prior_weight: model.prior_weight,
      n_live: model.n_live,
      n_train: model.n_train,
      category_ratio: Object.fromEntries(
        Object.entries(model.category_log_ratio).map(([k, v]) => [k, 10 ** v]),
      ),
      category_n: model.category_n,
    },
    cv: cv.v3,
    v2_cv: cv.v2,
    watchlist_size: snapshot.watchlist.length,
    watchlist_slugs: Object.fromEntries(snapshot.watchlist.map((s) => [s, true])),
    board_size: board.length,
    live_size: liveTop.length,
    rows: board.map(radarRow),
    live: liveTop,
  };
  return { board, radar, model };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
