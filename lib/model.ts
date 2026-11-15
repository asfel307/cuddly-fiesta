// Token Radar — the value model.
//
// The model answers one question: if a protocol that records no token issued
// one tomorrow and its record stayed as it is, what would that token be
// worth? The answer comes only from the snapshot's own figures — the
// protocol's TVL, its seven-day growth, and how long it has run with no
// token — never from a hardcoded list of names.
//
// A category's multiple is the median market-cap/TVL of that category's
// live-token protocols in the same snapshot, so a category whose tokens
// trade richly earns a higher multiple and one whose tokens trade thinly
// earns a lower one. A category with fewer than three live-token protocols
// cannot set its own multiple, so it falls back to the global median.
// Every multiple is clamped to [0.02, 2.0].

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  watchlist: boolean;
}

export interface LiveEntry {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

// A protocol records no token when DefiLlama carries no market cap, no
// CoinGecko id and no symbol for it. That is a record, not proof: the
// protocol may still have a token its record does not carry, so the board
// says "records no token", never "has no token".
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

// A name ending in a version marker (a space followed by V2, v2, 2.0 or the
// like) is a versioned copy of another protocol, not a launch of its own.
const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

// Rankable means worth a row on the board: it records no token, it is not a
// centralised exchange (a CEX already has a token and is not a farmable
// DeFi launch), it is not a versioned copy, and it holds real TVL.
export function isRankable(p: SnapshotProtocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category === "CEX") return false;
  if (VERSION_TAIL.test(p.name)) return false;
  if (!(p.tvl_usd > 0)) return false;
  return true;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const mid = ordered.length >> 1;
  if (ordered.length % 2 === 1) return ordered[mid] as number;
  return ((ordered[mid - 1] as number) + (ordered[mid] as number)) / 2;
}

export function clamp(value: number, low: number, high: number): number {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

export interface CategoryMultiples {
  byCategory: Map<string, number>;
  global: number;
  counts: Map<string, number>;
}

// A category earns its own multiple only when at least three of its
// protocols already trade with a market cap; fewer than that and the median
// is one protocol's ratio, which is noise, not a category's price.
const MIN_CATEGORY_SAMPLE = 3;
const DAY_MS = 86_400_000;

export function categoryMultiples(protocols: SnapshotProtocol[]): CategoryMultiples {
  const ratiosByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0) continue;
    if (!(p.tvl_usd > 0)) continue;
    if (!p.category) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    allRatios.push(ratio);
    const bucket = ratiosByCategory.get(p.category);
    if (bucket) bucket.push(ratio);
    else ratiosByCategory.set(p.category, [ratio]);
  }
  const global = median(allRatios);
  const byCategory = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const [category, ratios] of ratiosByCategory) {
    counts.set(category, ratios.length);
    if (ratios.length >= MIN_CATEGORY_SAMPLE) {
      byCategory.set(category, median(ratios));
    }
  }
  return { byCategory, global, counts };
}

// Whole days from the listing date to the snapshot date; null when the
// listing date is missing or unparseable.
export function daysListed(listedAt: string | null, asOf: string): number | null {
  if (!listedAt) return null;
  const start = Date.parse(listedAt + "T00:00:00Z");
  const end = Date.parse(asOf + "T00:00:00Z");
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

// Seven-day growth bends the value, never a lot: a protocol growing fast is
// worth more than one shrinking, but one week is a week, not a record. The
// growth is clamped to [-60, +120] per cent and weighted by one half.
export function growthMultiplier(change7d: number | null): number {
  const raw = change7d === null || !Number.isFinite(change7d) ? 0 : change7d;
  const bounded = clamp(raw, -60, 120);
  return 1 + (bounded / 100) * 0.5;
}

// Maturity rewards a long record with no token: a protocol listed three
// years ago that never issued one has a steadier claim than one listed last
// month. The multiplier runs from 0.6 (just listed) to 1.0 (three years or
// more). A missing listing date is scored as one year old.
export function maturityMultiplier(listedAt: string | null, asOf: string): number {
  const days = daysListed(listedAt, asOf);
  const age = days === null ? 365 : days;
  return 0.6 + (Math.min(Math.max(age, 0), 1095) / 1095) * 0.4;
}

// The implied value of one protocol: its TVL times its category's multiple,
// bent by its seven-day growth and by how long it has run with no token.
// The multiple is clamped so no category's thin sample can price a protocol
// at more than twice its TVL or less than two per cent of it.
export function impliedValue(
  p: SnapshotProtocol,
  multiples: CategoryMultiples,
  asOf: string,
): number {
  const raw = p.category ? multiples.byCategory.get(p.category) : undefined;
  const multiple = clamp(raw !== undefined ? raw : multiples.global, 0.02, 2.0);
  const value =
    p.tvl_usd * multiple * growthMultiplier(p.change_7d) * maturityMultiplier(p.listed_at, asOf);
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(1, Math.round(value));
}

function moneyShort(usd: number): string {
  if (usd >= 1e9) return "$" + (usd / 1e9).toFixed(2) + "B";
  if (usd >= 1e6) return "$" + (usd / 1e6).toFixed(1) + "M";
  if (usd >= 1e3) return "$" + (usd / 1e3).toFixed(0) + "K";
  return "$" + Math.round(usd);
}

function primaryChain(p: SnapshotProtocol): string {
  if (p.chains && p.chains.length > 0) return p.chains[0] as string;
  return "its main chain";
}

function chainList(p: SnapshotProtocol): string {
  if (!p.chains || p.chains.length === 0) return "its main chain";
  if (p.chains.length === 1) return p.chains[0] as string;
  if (p.chains.length === 2) return p.chains[0] + " and " + p.chains[1];
  return p.chains[0] + ", " + p.chains[1] + " and " + (p.chains.length - 2) + " more";
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(p: SnapshotProtocol, asOf: string): number {
  const days = daysListed(p.listed_at, asOf);
  if (days === null) return 30;
  if (days < 180) return 60;
  if (days < 365) return 45;
  return 30;
}

function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const kind = (p.category ?? "").toLowerCase();
  const name = p.name;
  if (kind.includes("lend") || kind.includes("cdp") || kind.includes("collateral")) {
    return "Supply $" + capital + " of USDC to " + name + " on " + chain + " and keep the position open.";
  }
  if (kind.includes("dex") || kind.includes("yield") || kind.includes("leveraged farm")) {
    return "Provide $" + capital + " of liquidity to " + name + "'s main pool on " + chain + " and keep the position open.";
  }
  if (kind.includes("bridge")) {
    return "Bridge $" + capital + " of USDC to " + chain + " through " + name + " and use the bridged funds in its app.";
  }
  if (kind.includes("staking") || kind.includes("restak")) {
    return "Stake $" + capital + " of the chain's staking asset through " + name + " and keep the receipt.";
  }
  if (kind.includes("perpetual") || kind.includes("derivative")) {
    return "Deposit $" + capital + " of USDC as margin on " + name + " and open one small hedge.";
  }
  if (kind.includes("prediction")) {
    return "Fund $" + capital + " and place one market position on " + name + ".";
  }
  if (kind.includes("curator") || kind.includes("allocator")) {
    return "Deposit $" + capital + " into a " + name + " vault on " + chain + " and keep the shares.";
  }
  if (kind.includes("stable")) {
    return "Mint or deposit $" + capital + " of the stable asset through " + name + " on " + chain + ".";
  }
  if (kind.includes("rwa")) {
    return "Mint $" + capital + " of the protocol's yield asset on " + chain + " and hold it.";
  }
  if (kind.includes("insurance")) {
    return "Buy $" + capital + " of cover from " + name + " on " + chain + " and keep the policy.";
  }
  return "Deposit $" + capital + " of USDC into " + name + " on " + chain + " and keep the position open.";
}

function weeklyHabit(p: SnapshotProtocol, chain: string): string {
  const kind = (p.category ?? "").toLowerCase();
  const name = p.name;
  if (kind.includes("lend") || kind.includes("cdp") || kind.includes("collateral")) {
    return "Borrow a small amount against your supply on " + name + " once, then repay it, so the position shows real use and not an idle deposit.";
  }
  if (kind.includes("dex") || kind.includes("yield") || kind.includes("leveraged farm")) {
    return "Swap a small amount through " + name + " once a week so the position shows trading activity, not only a deposit.";
  }
  if (kind.includes("bridge")) {
    return "Bridge a small amount through " + name + " once a week, alternating the direction, so the account shows repeated use.";
  }
  if (kind.includes("staking") || kind.includes("restak")) {
    return "Check the staking rewards on " + name + " once a week and restake the rewards if the protocol allows it.";
  }
  if (kind.includes("perpetual") || kind.includes("derivative")) {
    return "Open and close one small hedge on " + name + " each week to keep the account active.";
  }
  if (kind.includes("prediction")) {
    return "Place one small market position on " + name + " each week.";
  }
  if (kind.includes("curator") || kind.includes("allocator")) {
    return "Review the vault allocation on " + name + " once a week and rebalance only if the vault itself changes its strategy.";
  }
  if (kind.includes("stable")) {
    return "Use the stable asset in one transaction a week, such as a payment or a deposit, so the wallet shows real use.";
  }
  if (kind.includes("rwa")) {
    return "Check the yield accrual on " + name + " once a week and keep the asset held; there is nothing to trade.";
  }
  if (kind.includes("insurance")) {
    return "Review the cover terms on " + name + " once a week; no action is needed unless the cover itself changes.";
  }
  return "Make one qualifying action each week on " + name + ", such as a deposit, a swap, or a vote.";
}

// Seven concrete farm steps for one protocol. Each step says what to do, what
// it costs and how long it takes, and each is written from the protocol's own
// record — its name, its category, its chains and its TVL — so no two
// protocols share a plan.
export function farmSteps(p: SnapshotProtocol, asOf: string): string[] {
  const chain = primaryChain(p);
  const chains = chainList(p);
  const category = p.category ?? "DeFi";
  const tvl = moneyShort(p.tvl_usd);
  const name = p.name;
  const capital = capitalFor(p);
  const hold = holdDaysFor(p, asOf);
  const gas = capital >= 150 ? 8 : 4;
  return [
    "Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.",
    coreAction(p, capital, chain) +
      " Cost: $" + capital + " of capital and about $" + gas + " of gas. Time: 15 minutes to set up.",
    weeklyHabit(p, chain) + " Cost: about $2 of gas a week. Time: 10 minutes a week.",
    "Hold the position for at least " + hold + " days so the activity is counted in more than one snapshot. Cost: the $" + capital + " stays in the position. Time: " + hold + " days.",
    "Check " + name + "'s points or rewards page once a month to confirm the position is earning; use only the link the protocol itself publishes. Cost: no fee to check. Time: 10 minutes a month.",
    "Before you withdraw, claim only from " + name + "'s own page and never pay a third party to claim for you; a real airdrop never asks for a fee to claim. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    "Write the wallet address, the dates, and every transaction hash in a farm log so you can repeat the position or unwind it without guessing. The position is in " + name + "'s " + category + " product on " + chain + " (" + tvl + " TVL across " + chains + "). Cost: nothing but the log. Time: 5 minutes.",
  ];
}

export interface BoardResult {
  rows: BoardRow[];
  multiples: CategoryMultiples;
  liveTop: LiveEntry[];
}

// Build the board: every rankable pre-token protocol, ranked by implied
// value, most valuable first. Rows are sorted by implied value descending,
// then by TVL descending, then by slug, so the order is deterministic and
// two runs write the same bytes. The 24 live-token protocols with the
// largest market caps are set aside for the dashboard's live-token view:
// they already trade, so they are the comparison set, not the board.
export function buildBoard(snapshot: Snapshot): BoardResult {
  const multiples = categoryMultiples(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(isRankable)
    .map((p) => ({ protocol: p, value: impliedValue(p, multiples, snapshot.as_of) }))
    .sort((a, b) => {
      if (b.value !== a.value) return b.value - a.value;
      if (b.protocol.tvl_usd !== a.protocol.tvl_usd) {
        return b.protocol.tvl_usd - a.protocol.tvl_usd;
      }
      return a.protocol.slug < b.protocol.slug ? -1 : 1;
    });
  const rows: BoardRow[] = scored.map((entry, index) => {
    const p = entry.protocol;
    return {
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: [...p.chains],
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      rank: index + 1,
      implied_value_usd: entry.value,
      farm_steps: farmSteps(p, snapshot.as_of),
      watchlist: watchlist.has(p.slug),
    };
  });
  const liveTop: LiveEntry[] = snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== "CEX" && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: [...p.chains],
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
  return { rows, multiples, liveTop };
}

// A one-line summary of the model for the dashboard's model panel: which
// multiple each category earned and how many live-token protocols backed it.
export function modelSummary(multiples: CategoryMultiples): {
  category: string;
  multiple: number;
  sample: number;
}[] {
  const out: { category: string; multiple: number; sample: number }[] = [];
  for (const [category, multiple] of multiples.byCategory) {
    out.push({
      category,
      // Full precision, not rounded: the dashboard recomputes each row's
      // implied value from these multiples, and a rounded multiple would
      // move the recomputed value away from the board's own number.
      multiple,
      sample: multiples.counts.get(category) ?? 0,
    });
  }
  out.sort((a, b) => b.multiple - a.multiple);
  return out;
}

// Why a board is not one the gate will take, or null: coverage, ranks,
// order, one shared implied value, and farm steps.
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return "the board misses " + missing.length + " watchlist slugs: " + missing.slice(0, 5).join(", ");
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return "rank " + (i + 1) + " is " + ranks[i];
  }
  for (let i = 1; i < board.length; i++) {
    const prev = board[i - 1] as BoardRow;
    const cur = board[i] as BoardRow;
    if (cur.implied_value_usd > prev.implied_value_usd) {
      return "row " + (i + 1) + " outranks row " + i + " on implied value";
    }
  }
  if (board.length >= 2) {
    const first = board[0] as BoardRow;
    const last = board[board.length - 1] as BoardRow;
    if (first.implied_value_usd === last.implied_value_usd) {
      return "all " + board.length + " rows share the same implied value: a board that ranks nothing by value is not a ranking";
    }
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return r.slug + " has " + r.farm_steps.length + " farm steps";
    }
    for (const s of r.farm_steps) {
      if (s.length < 20 || s.length > 600) {
        return r.slug + " has a farm step of " + s.length + " characters";
      }
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return r.slug + " has implied value " + r.implied_value_usd;
    }
  }
  return null;
}

// The snapshot out of a file's text, refused unless it is the shape the
// model scores.
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("snapshot.json is not JSON");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("snapshot.json is not a JSON object");
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new Error("snapshot.json has no as_of date");
  }
  if (typeof o.source !== "string") throw new Error("snapshot.json has no source");
  if (typeof o.floor_usd !== "number" || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new Error("snapshot.json has no floor_usd");
  }
  if (!Array.isArray(o.protocols)) throw new Error("snapshot.json has no protocols array");
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== "string")) {
    throw new Error("snapshot.json has no watchlist of slugs");
  }
  const protocols: SnapshotProtocol[] = o.protocols.map((v, i) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      throw new Error("snapshot.json protocol " + i + " is not an object");
    }
    const p = v as Record<string, unknown>;
    if (
      typeof p.slug !== "string" ||
      typeof p.name !== "string" ||
      typeof p.tvl_usd !== "number" ||
      !Number.isFinite(p.tvl_usd)
    ) {
      throw new Error("snapshot.json protocol " + i + " lacks a slug, a name or a TVL");
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === "string" ? p.category : null,
      chains: Array.isArray(p.chains)
        ? p.chains.filter((c): c is string => typeof c === "string")
        : [],
      tvl_usd: p.tvl_usd,
      change_7d:
        typeof p.change_7d === "number" && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd:
        typeof p.mcap_usd === "number" && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === "string" ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === "string" ? p.gecko_id : null,
      symbol: typeof p.symbol === "string" ? p.symbol : null,
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
