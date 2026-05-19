export function formatUSD(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatMonthYear(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export function monthRange(year: number, month: number): { start: string; end: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}

/** Latest allowed entry date for a month (today if current month, else last day). */
export function maxEntryDateForMonth(year: number, month: number): string {
  const { end } = monthRange(year, month);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const cur = currentMonthYear();
  if (year === cur.year && month === cur.month) return today < end ? today : end;
  return end;
}

function currentMonthYear(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** Net cash position from income minus all expenses through a date (inclusive). */
export function balanceFromTransactions(
  rows: { kind: string; amount: number }[]
): number {
  return rows.reduce((sum, t) => {
    const amt = Number(t.amount);
    return t.kind === "income" ? sum + amt : sum - amt;
  }, 0);
}
