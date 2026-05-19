import { supabase } from "./supabase";
import { formatMonthYear } from "./format";

export type Period = { year: number; month: number };

export function currentPeriod(): Period {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
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
