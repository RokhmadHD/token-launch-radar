// Token Launch Radar — the value model.
//
// Everything the model knows comes from the sealed snapshot itself; no protocol name is ever
// special-cased and no outside data is consulted. A protocol that records no token is priced at what
// the market already pays for comparable protocols that do trade, then tilted by its own momentum and
// by how long it has run without a token:
//
//   anchor    = median(mcap / tvl) of the snapshot's live-token protocols in the same category,
//               falling back to the snapshot-wide median, clamped to [ANCHOR_MIN, ANCHOR_MAX]
//   momentum  = 1 + clamp(change_7d, GROWTH_FLOOR, GROWTH_CAP) / 100 * MOMENTUM_WEIGHT
//   readiness = a hump over the days it has run with no token: a launch needs accrued usage to reward
//               (too new scores low) and goes stale when none arrives for years (old scores low again)
//   implied   = max(1, round(tvl * anchor * momentum * readiness))   whole dollars, ≤ 1e14
//
// The same three snapshot figures the rules name — TVL, the seven-day change and the untokenized age —
// move every row, and the anchor is the market's own median multiple, so the board is not a TVL table:
// a smaller protocol in a richly-valued category can outrank a bigger one in a cheap one.

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

/** The model's knobs, stated verbatim on the dashboard's methodology panel. */
export interface ModelConstants {
  momentum_weight: number;
  growth_floor: number;
  growth_cap: number;
  anchor_min: number;
  anchor_max: number;
  anchor_min_samples: number;
  anchor_fallback: number;
  readiness_ramp_days: number;
  readiness_peak_days: number;
  readiness_decay_days: number;
  readiness_stale_days: number;
  readiness_floor_new: number;
  readiness_peak: number;
  readiness_mid: number;
  readiness_floor_old: number;
  readiness_unknown: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  momentum_weight: 0.35,
  growth_floor: -50,
  growth_cap: 120,
  anchor_min: 0.05,
  anchor_max: 8,
  anchor_min_samples: 4,
  anchor_fallback: 1.5,
  readiness_ramp_days: 90,
  readiness_peak_days: 540,
  readiness_decay_days: 1095,
  readiness_stale_days: 1825,
  readiness_floor_new: 0.8,
  readiness_peak: 1.1,
  readiness_mid: 0.95,
  readiness_floor_old: 0.75,
  readiness_unknown: 0.9,
  unknown_age_days: 365,
};

export const MODEL_VERSION = 'launch-multiple-2';
export const ENTRY_TITLE = 'Token Launch Radar';
/** Pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;
/** Live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;
/** The gate's own ceiling on one row's implied value. */
export const IMPLIED_CAP = 100_000_000_000_000;

const DAY_MS = 86_400_000;
const round3 = (n: number): number => Math.round(n * 1_000) / 1_000;

/** Whole days from the snapshot's `as_of` to `listedAt`, or null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** The middle of an ascending list: the middle item, or the mean of the two middle items. */
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A live protocol the anchor can read: a market cap and a TVL, and not a wrapped or exchange product
 * — a wrapper's multiple is the backing asset's, and an exchange's is a business's, so neither is a
 * fair comparable for a protocol's own launch. */
function anchorSample(p: SnapshotProtocol): number | null {
  if (p.mcap_usd === null || p.tvl_usd <= 0 || p.mcap_usd <= 0) return null;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return null;
  return p.mcap_usd / p.tvl_usd;
}

/** One anchor row: the median multiple of one category's live protocols, and how many backed it. */
export interface CategoryAnchor {
  category: string;
  samples: number;
  multiple: number;
}

/** Median mcap/tvl per category and snapshot-wide, from the live-token protocols themselves. */
export function categoryAnchors(protocols: SnapshotProtocol[], model: ModelConstants): { anchors: CategoryAnchor[]; global: number } {
  const buckets = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    const m = anchorSample(p);
    if (m === null) continue;
    all.push(m);
    const key = p.category ?? '';
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [m]);
    else bucket.push(m);
  }
  const anchors: CategoryAnchor[] = [];
  for (const [key, values] of buckets) {
    if (values.length < model.anchor_min_samples) continue;
    const med = median([...values].sort((a, b) => a - b));
    if (med === null) continue;
    anchors.push({ category: key === '' ? 'Uncategorized' : key, samples: values.length, multiple: round3(clamp(med, model.anchor_min, model.anchor_max)) });
  }
  anchors.sort((a, b) => a.category < b.category ? -1 : a.category > b.category ? 1 : 0);
  const globalMed = median([...all].sort((a, b) => a - b));
  const global = globalMed === null ? model.anchor_fallback : round3(clamp(globalMed, model.anchor_min, model.anchor_max));
  return { anchors, global };
}

/** The anchor one protocol is priced at: its category's median, else the snapshot-wide median. */
export function anchorFor(p: SnapshotProtocol, anchors: CategoryAnchor[], global: number): { multiple: number; samples: number; source: 'category' | 'global' } {
  if (p.category !== null) {
    const found = anchors.find((a) => a.category === p.category);
    if (found !== undefined) return { multiple: found.multiple, samples: found.samples, source: 'category' };
  }
  return { multiple: global, samples: 0, source: 'global' };
}

/** The launch-readiness hump over the days run with no token, with its band's name for the page. */
export function readiness(age: number | null, model: ModelConstants): { mult: number; band: string } {
  if (age === null) return { mult: model.readiness_unknown, band: 'age unreported' };
  const a = clamp(age, 0, model.readiness_stale_days + 3_650);
  const lerp = (from: number, to: number, t: number): number => from + (to - from) * clamp(t, 0, 1);
  if (a < model.readiness_ramp_days) {
    return { mult: lerp(model.readiness_floor_new, model.readiness_peak, (a - 30) / (model.readiness_ramp_days - 30)), band: 'too new' };
  }
  if (a < model.readiness_peak_days) {
    return { mult: lerp(model.readiness_peak, model.readiness_peak, 0), band: 'prime window' };
  }
  if (a < model.readiness_decay_days) {
    return { mult: lerp(model.readiness_peak, model.readiness_mid, (a - model.readiness_peak_days) / (model.readiness_decay_days - model.readiness_peak_days)), band: 'mature' };
  }
  if (a < model.readiness_stale_days) {
    return { mult: lerp(model.readiness_mid, model.readiness_floor_old, (a - model.readiness_decay_days) / (model.readiness_stale_days - model.readiness_decay_days)), band: 'going stale' };
  }
  return { mult: model.readiness_floor_old, band: 'stale' };
}

/** Everything the model says about one protocol: the implied value and every input behind it. */
export interface Score {
  implied: number;
  age: number | null;
  growthPct: number;
  growthReported: boolean;
  momentumMult: number;
  readinessMult: number;
  readinessBand: string;
  anchor: { multiple: number; samples: number; source: 'category' | 'global' };
}

/** The model in one function: the same arithmetic the dashboard re-runs and the board states. */
export function scoreProtocol(p: SnapshotProtocol, asOf: string, model: ModelConstants, anchors: CategoryAnchor[], global: number): Score {
  const age = ageDays(asOf, p.listed_at);
  const growthReported = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d);
  const growthPct = growthReported ? clamp(finite(p.change_7d, 0), model.growth_floor, model.growth_cap) : 0;
  const momentumMult = 1 + (growthPct / 100) * model.momentum_weight;
  const ready = readiness(age, model);
  const anchor = anchorFor(p, anchors, global);
  const raw = p.tvl_usd * anchor.multiple * momentumMult * ready.mult;
  const implied = Math.min(IMPLIED_CAP, Math.max(1, Math.round(raw)));
  return { implied, age, growthPct, growthReported, momentumMult: round3(momentumMult), readinessMult: round3(ready.mult), readinessBand: ready.band, anchor };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const WRAPPED_WORDS = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether the board may rank it: pre-token, and not a wrapped, staked, bridged or exchange product of
 * one that trades — the watchlist's own structural rule, applied to the early rows too.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORDS.test(p.name)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Re-check the protocol's own page before acting.`;
  return s;
}

// --------------------------------------------------------------------- gas and capital tiers

/** Gas per transaction by chain tier: the mainnet of a chain family sets the tier. */
const L2_CHAINS = new Set([
  'Arbitrum', 'Arbitrum Nova', 'Base', 'Optimism', 'Scroll', 'Linea', 'Polygon zkEVM', 'zkSync Era',
  'zkSync', 'Blast', 'Mantle', 'Mode', 'Ink', 'Unichain', 'World Chain', 'Sonya', 'Bob', 'Fraxtal',
]);
const SOLANA_CHAINS = new Set(['Solana']);

/** A dollar figure for gas: two decimals at most, no trailing zeros. */
function gasUsd(n: number): string {
  const s = n.toFixed(2).replace(/\.?0+$/, '');
  return `$${s}`;
}

function gasTier(chain: string): { setup: number; weekly: number } {
  if (chain === 'Ethereum') return { setup: 8, weekly: 3 };
  if (L2_CHAINS.has(chain)) return { setup: 0.6, weekly: 0.15 };
  if (SOLANA_CHAINS.has(chain)) return { setup: 0.05, weekly: 0.01 };
  return { setup: 1.2, weekly: 0.4 };
}

/** Position size, from the protocol's own TVL: a bigger room can notice a bigger position. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold: a younger protocol gets a longer window to land in more than one snapshot. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's first action, in the words a farmer can follow, with the protocol's own name. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string, gas: { setup: number }): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const money = `$${capital}`;
  if (c.includes('dex') || c.includes('liquidity') || c.includes('amm')) {
    return `Provide ${money} of liquidity to ${name}'s deepest pool on ${chain} and leave the position in place.`;
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('stable')) {
    return `Supply ${money} of USDC as collateral on ${name} (${chain}), borrow under 40% LTV, and keep both sides open.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('leverage')) {
    return `Deposit ${money} of USDC as margin on ${name} (${chain}) and open one small position, under 2x leverage.`;
  }
  if (c.includes('bridge')) {
    return `Bridge ${money} of USDC to ${chain} through ${name} and put the bridged funds to work in its app.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake ${money} of the chain's staking asset through ${name} and keep the liquid receipt.`;
  }
  if (c.includes('yield') || c.includes('vault') || c.includes('curator') || c.includes('allocator') || c.includes('aggregate')) {
    return `Deposit ${money} into ${name}'s main vault on ${chain} and keep the receipt token.`;
  }
  if (c.includes('launchpad') || c.includes('launch')) {
    return `Register for ${name}'s next sale on ${chain} with ${money} committed, per its own rules.`;
  }
  if (c.includes('rwa')) {
    return `Mint ${money} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  }
  if (c.includes('insurance')) {
    return `Buy ${money} of cover from ${name} on ${chain} and keep the policy active.`;
  }
  if (c.includes('oracle') || c.includes('infrastructure') || c.includes('wallet') || c.includes('node')) {
    return `Run or use ${name}'s core service on ${chain}: one full transaction flow with ${money} at stake.`;
  }
  return `Deposit ${money} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The position's main risk, from the category: named before the entry, in the farmer's words. */
function riskFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('dex') || c.includes('liquidity') || c.includes('amm')) {
    return 'impermanent loss: if one pool asset moves far from the other, the position can end up worth less than simply holding — size it so that outcome is acceptable';
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('stable')) {
    return 'liquidation: if the collateral falls toward the borrow, the position is sold at a penalty — keep the borrow well under 40% LTV and check it weekly';
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('leverage')) {
    return 'liquidation and funding: one adverse move can close a leveraged position, and funding eats it slowly — stay under 2x and close early';
  }
  if (c.includes('bridge')) {
    return 'bridge risk: the funds depend on the bridge staying sound — bridge only what you plan to use and withdraw when you are done';
  }
  if (c.includes('staking') || c.includes('restak')) {
    return 'slashing and unstaking delays: the stake can be penalized for validator faults and withdrawals can queue for days';
  }
  if (c.includes('yield') || c.includes('vault') || c.includes('curator') || c.includes('allocator') || c.includes('aggregate')) {
    return 'strategy risk: the vault is managed by others and can underperform or take a bad deployment — read what it holds before depositing';
  }
  if (c.includes('rwa')) {
    return 'issuer risk: the yield depends on an off-chain party honoring the asset — treat it as counterparty exposure, not a permissionless position';
  }
  if (c.includes('insurance')) {
    return 'cover denial: claims can be refused for scope reasons — read what the policy actually covers before buying';
  }
  if (c.includes('launchpad') || c.includes('launch')) {
    return 'lockups: funds can be committed before a sale completes and token unlocks can run long — enter only what you can leave';
  }
  return 'smart-contract risk: a bug in the protocol\'s contracts can take the deposited funds — check that audits and timelocks are published';
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age) — never from a hand-kept list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const second = p.chains.length > 1 ? p.chains[1]! : null;
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasTier(chain);
  const steps: FarmStep[] = [
    {
      text: 'Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: `under ${gasUsd(gas.setup)} to fund it`,
      time: '5 minutes',
    },
    {
      text: `Know the position's main risk before you enter: ${riskFor(p)}.`,
      cost: 'nothing — the check is reading, not spending',
      time: '10 minutes before you deposit',
    },
    {
      text: actionFor(p, capital, chain, gas),
      cost: `${`$${capital}`} of capital plus about ${gasUsd(gas.setup)} of gas`,
      time: '15 minutes to set up',
    },
    second === null
      ? {
          text: `Deepen the position instead of spreading: add a second, smaller deposit of $${Math.round(capital / 2)} on ${chain} after a week.`,
          cost: `$${Math.round(capital / 2)} of capital plus about ${gasUsd(gas.weekly)} of gas`,
          time: '10 minutes, one week in',
        }
      : {
          text: `Repeat the same action on ${second}, ${p.name}'s second chain, so the activity spans more than one network.`,
          cost: `$${Math.round(capital / 2)} of capital plus about ${gasUsd(gasTier(second).setup)} of gas`,
          time: '15 minutes',
        },
    {
      text: 'Make one qualifying action each week: a deposit, a borrow, a swap or a vote, small but real.',
      cost: `about ${gasUsd(gas.weekly)} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: "Check the protocol's own points or rewards page weekly, and claim only from a link it publishes itself.",
      cost: 'nothing — never pay a third party to claim',
      time: '10 minutes a week',
    },
    {
      text: `Keep a farm log of the wallet, dates and transaction hashes, and write your unwind trigger before you enter: at ${hold} days, or sooner if the TVL halves.`,
      cost: 'nothing but the log',
      time: '5 minutes to start, 2 minutes a week',
    },
  ];
  return steps;
}

// --------------------------------------------------------------------- the board and the radar data

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
  confidence: 'high' | 'medium' | 'low';
  model: {
    anchor_multiple: number;
    anchor_samples: number;
    anchor_source: 'category' | 'global';
    momentum_multiplier: number;
    readiness_multiplier: number;
    readiness_band: string;
    growth_pct: number;
  };
  farm_steps: string[];
}

/** One row of data.js: everything the page renders, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  confidence: 'high' | 'medium' | 'low';
  model: BoardRow['model'];
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  entry_title: string;
  model_version: string;
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  /** Pre-token protocols at or above the floor the watchlist's parent rule sets aside (derived: the
   * count is the snapshot's own — rankable above floor minus the watchlist). */
  set_aside_parent_products: number;
  anchors: CategoryAnchor[];
  anchor_global: number;
  readiness_notes: string[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** How well-supported a row's number is: complete inputs and a category anchor are the strongest. */
function confidenceFor(score: Score, p: SnapshotProtocol): 'high' | 'medium' | 'low' {
  if (score.anchor.source === 'category' && score.growthReported && score.age !== null && p.tvl_usd >= 100_000_000) return 'high';
  if (score.growthReported && score.age !== null) return 'medium';
  return 'low';
}

/** The protocols the board ranks, strongest first, ranks 1..n once each. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; anchors: CategoryAnchor[]; global: number } {
  const { anchors, global } = categoryAnchors(snapshot.protocols, model);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p] as const));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rankable pre-token protocols below the floor, by TVL, capped. Never a replacement
  // for a watchlist row.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, model, anchors, global) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : 1));
  const board = scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    confidence: confidenceFor(s, p),
    model: {
      anchor_multiple: s.anchor.multiple,
      anchor_samples: s.anchor.samples,
      anchor_source: s.anchor.source,
      momentum_multiplier: s.momentumMult,
      readiness_multiplier: s.readinessMult,
      readiness_band: s.readinessBand,
      growth_pct: s.growthPct,
    },
    farm_steps: farmSteps(p, s.age).map(stepText),
  }));
  return { board, anchors, global };
}

/** The live-token protocols, by market cap, for the dashboard's separated Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && (p.category === null || !WRAPPED_CATEGORIES.has(p.category)))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => {
      const m = anchorSample(p);
      return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd,
        change_7d: p.change_7d,
        multiple: m === null ? null : round3(m),
      };
    });
}

/** Everything the dashboard needs, from the snapshot, in one pass. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, anchors, global } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  // Every rankable pre-token protocol below the floor is already on the board, so the radar's early
  // coverage is complete. Above the floor, the watchlist is the rankable set minus the ones
  // DefiLlama ties to a parent protocol (the wrapped and staked products): the snapshot's own counts
  // give that number, and the page states it rather than hiding it.
  const rankableAboveFloor = snapshot.protocols.filter((p) => p.tvl_usd >= snapshot.floor_usd && isRankable(p)).length;
  const setAside = Math.max(0, rankableAboveFloor - snapshot.watchlist.length);
  const radar: RadarData = {
    entry_title: ENTRY_TITLE,
    model_version: MODEL_VERSION,
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    set_aside_parent_products: setAside,
    anchors,
    anchor_global: global,
    readiness_notes: [
      `0 to 30 days: ${model.readiness_floor_new}x — too new to have accrued usage a token could reward`,
      `30 to ${model.readiness_ramp_days} days: rising ${model.readiness_floor_new}x → ${model.readiness_peak}x`,
      `${model.readiness_ramp_days} to ${model.readiness_peak_days} days: ${model.readiness_peak}x — the prime window`,
      `${model.readiness_peak_days} to ${model.readiness_decay_days} days: easing to ${model.readiness_mid}x — established, still no launch`,
      `${model.readiness_decay_days} to ${model.readiness_stale_days} days: easing to ${model.readiness_floor_old}x; over ${model.readiness_stale_days} days: ${model.readiness_floor_old}x — stale`,
      `age unreported: ${model.readiness_unknown}x`,
    ],
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      confidence: r.confidence,
      model: r.model,
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

// --------------------------------------------------------------------- input and gate checks

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
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

/** Why a board is not one the gate will take, or null: coverage, ranks, order, values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot, knownSlugs: Set<string>): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows: the gate takes at least 100`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  for (const r of board) {
    if (!knownSlugs.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > IMPLIED_CAP) {
      return `${r.slug} has an implied value the gate refuses: ${r.implied_value_usd}`;
    }
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const trimmed = s.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `${r.slug} has a farm step of ${trimmed.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, written beside dashboard/, no fetch. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
