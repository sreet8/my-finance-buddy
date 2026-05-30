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
