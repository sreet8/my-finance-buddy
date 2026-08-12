import { supabase } from "./supabase";
import { balanceFromTransactions, formatMonthYear, monthRange } from "./format";

export type Period = { year: number; month: number };

export function currentPeriod(): Period {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function previousPeriod(p: Period): Period {
  if (p.month === 1) return { year: p.year - 1, month: 12 };
  return { year: p.year, month: p.month - 1 };
}

/**
 * Opening balance present before the app began tracking, seeded as of the start
 * of May 2026. It flows into May 2026's starting balance and carries forward.
 */
const OPENING_BALANCE = 3804.37;

function openingBalanceFor(period: Period): number {
  const onOrAfterMay2026 =
    period.year > 2026 || (period.year === 2026 && period.month >= 5);
  return onOrAfterMay2026 ? OPENING_BALANCE : 0;
}

/**
 * The month's starting balance: a seeded opening balance plus the net
 * (income − expenses) of every transaction dated on or before the end of the
 * previous month. This equals the previous month's ending balance, carried over.
 */
export async function fetchStartingBalance(period: Period): Promise<number> {
  const prev = previousPeriod(period);
  const { end } = monthRange(prev.year, prev.month);
  const { data, error } = await supabase
    .from("transactions")
    .select("kind, amount")
    .lte("occurred_on", end);
  const txnBalance = error ? 0 : balanceFromTransactions(data ?? []);
  return openingBalanceFor(period) + txnBalance;
}

export function periodKey(p: Period): string {
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

function isBefore(a: Period, b: Period): boolean {
  return a.year < b.year || (a.year === b.year && a.month < b.month);
}

/**
 * Budget percentages in effect for a period. If the period has its own saved
 * budget rows, those are used. Otherwise the most recent prior month's budget
 * rolls over, so allocations carry forward instead of resetting to zero each
 * month. `rolledOverFrom` names the source month when a rollover was applied.
 */
export async function fetchEffectiveBudgets(period: Period): Promise<{
  percentByCategory: Record<string, number>;
  rolledOverFrom: Period | null;
}> {
  const { data, error } = await supabase
    .from("budgets")
    .select("year, month, category, percent");
  if (error || !data) return { percentByCategory: {}, rolledOverFrom: null };

  const byPeriod = new Map<
    string,
    { period: Period; rows: { category: string; percent: number }[] }
  >();
  for (const r of data) {
    const p = { year: Number(r.year), month: Number(r.month) };
    const key = periodKey(p);
    if (!byPeriod.has(key)) byPeriod.set(key, { period: p, rows: [] });
    byPeriod.get(key)!.rows.push({
      category: r.category as string,
      percent: Number(r.percent),
    });
  }

  const target = byPeriod.get(periodKey(period));
  const source =
    target ??
    [...byPeriod.values()]
      .filter((e) => isBefore(e.period, period))
      .sort((a, b) => (isBefore(a.period, b.period) ? 1 : -1))[0] ??
    null;

  const percentByCategory: Record<string, number> = {};
  for (const row of source?.rows ?? []) percentByCategory[row.category] = row.percent;

  return {
    percentByCategory,
    rolledOverFrom: !target && source ? source.period : null,
  };
}

export function parsePeriodKey(key: string): Period {
  const [y, m] = key.split("-");
  return { year: Number(y), month: Number(m) };
}

export function formatPeriodLabel(p: Period): string {
  return formatMonthYear(p.year, p.month);
}

function periodFromDate(iso: string): Period {
  const [y, m] = iso.split("-");
  return { year: Number(y), month: Number(m) };
}

function sortPeriodsDesc(periods: Period[]): Period[] {
  return [...periods].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.month - a.month;
  });
}

/** Months with transactions or budgets, plus the current month (newest first). */
export async function fetchAvailablePeriods(): Promise<Period[]> {
  const [txRes, budgetRes] = await Promise.all([
    supabase.from("transactions").select("occurred_on"),
    supabase.from("budgets").select("year, month"),
  ]);

  const byKey = new Map<string, Period>();
  const add = (p: Period) => byKey.set(periodKey(p), p);

  add(currentPeriod());

  if (!txRes.error) {
    for (const row of txRes.data ?? []) {
      const iso = row.occurred_on as string;
      if (iso) add(periodFromDate(iso));
    }
  }

  if (!budgetRes.error) {
    for (const row of budgetRes.data ?? []) {
      add({ year: Number(row.year), month: Number(row.month) });
    }
  }

  return sortPeriodsDesc(Array.from(byKey.values()));
}
