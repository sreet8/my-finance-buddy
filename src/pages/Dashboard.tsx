import { useEffect, useMemo, useState } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
} from "recharts";
import { useCategories } from "../context/CategoriesContext";
import { supabase } from "../lib/supabase";
import { Budget, Transaction, UNUSED_COLOR } from "../types";
import { formatMonthYear, formatUSD, monthRange } from "../lib/format";

type NewEntry = {
  kind: "income" | "expense";
  amount: string;
  category: string;
  note: string;
  date: string;
};

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function zeroMap(names: string[]): Record<string, number> {
  return Object.fromEntries(names.map((n) => [n, 0]));
}

const PIE_SIZE = 240;
const PIE_CENTER = PIE_SIZE / 2;
const PIE_TOOLTIP_OFFSET = 52;

function PieTooltip({
  active,
  payload,
  coordinate,
}: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  const x = coordinate?.x ?? PIE_CENTER;
  const y = coordinate?.y ?? PIE_CENTER;
  const dx = x - PIE_CENTER;
  const dy = y - PIE_CENTER;
  const len = Math.hypot(dx, dy) || 1;
  const shiftX = (dx / len) * PIE_TOOLTIP_OFFSET;
  const shiftY = (dy / len) * PIE_TOOLTIP_OFFSET - 24;

  return (
    <div
      className="pie-tooltip"
      style={{ transform: `translate(${shiftX}px, ${shiftY}px)` }}
    >
      <span className="pie-tooltip-name">{item.name}</span>
      <span className="pie-tooltip-value">{formatUSD(Number(item.value))}</span>
    </div>
  );
}

export default function Dashboard() {
  const { names, colors, loading: categoriesLoading } = useCategories();

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const { start, end } = useMemo(() => monthRange(year, month), [year, month]);

  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [entry, setEntry] = useState<NewEntry>({
    kind: "expense",
    amount: "",
    category: "",
    note: "",
    date: todayISO(),
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (names.length > 0 && !names.includes(entry.category)) {
      setEntry((p) => ({ ...p, category: names[0] }));
    }
  }, [names, entry.category]);

  async function loadAll() {
    setLoading(true);
    setError(null);
    const [b, t] = await Promise.all([
      supabase.from("budgets").select("*").eq("year", year).eq("month", month),
      supabase
        .from("transactions")
        .select("*")
        .gte("occurred_on", start)
        .lte("occurred_on", end)
        .order("occurred_on", { ascending: false }),
    ]);
    if (b.error || t.error) {
      setError(b.error?.message ?? t.error?.message ?? "Load failed");
      setLoading(false);
      return;
    }
    setBudgets((b.data ?? []) as Budget[]);
    setTransactions((t.data ?? []) as Transaction[]);
    setLoading(false);
  }

  useEffect(() => {
    if (!categoriesLoading && names.length > 0) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, categoriesLoading, names.join("|")]);

  const spentByCategory = useMemo(() => {
    const out = zeroMap(names);
    for (const t of transactions) {
      if (t.kind === "expense" && t.category && t.category in out) {
        out[t.category] += Number(t.amount);
      }
    }
    return out;
  }, [transactions, names]);

  const totalIncome = useMemo(
    () => transactions.filter((t) => t.kind === "income").reduce((s, t) => s + Number(t.amount), 0),
    [transactions]
  );

  const percentByCategory = useMemo(() => {
    const out = zeroMap(names);
    for (const b of budgets) {
      if (b.category in out) out[b.category] = Number(b.percent);
    }
    return out;
  }, [budgets, names]);

  const budgetByCategory = useMemo(() => {
    const out = zeroMap(names);
    for (const c of names) out[c] = (percentByCategory[c] / 100) * totalIncome;
    return out;
  }, [percentByCategory, totalIncome, names]);

  const totalBudget = useMemo(
    () => names.reduce((s, c) => s + budgetByCategory[c], 0),
    [budgetByCategory, names]
  );
  const totalSpent = useMemo(
    () => names.reduce((s, c) => s + spentByCategory[c], 0),
    [spentByCategory, names]
  );

  const overBudget = totalSpent > totalBudget && totalBudget > 0;
  const percentSpent = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;

  const chartData = useMemo(() => {
    const slices: { name: string; value: number; color: string }[] = names
      .filter((c) => spentByCategory[c] > 0)
      .map((c) => ({
        name: c,
        value: spentByCategory[c],
        color: colors[c] ?? "#c9a98b",
      }));
    const remaining = Math.max(0, totalBudget - totalSpent);
    if (remaining > 0 || slices.length === 0) {
      slices.push({
        name: totalBudget === 0 ? "No budget set" : "Unused",
        value: remaining > 0 ? remaining : 1,
        color: UNUSED_COLOR,
      });
    }
    return slices;
  }, [spentByCategory, totalBudget, totalSpent, names, colors]);

  async function submitEntry(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(entry.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Amount must be greater than 0");
      return;
    }
    if (entry.kind === "expense" && names.length === 0) {
      setError("Add at least one category in Settings");
      return;
    }
    setSubmitting(true);
    setError(null);

    const res =
      entry.kind === "income"
        ? await supabase.from("transactions").insert({
            kind: "income",
            amount: amt,
            category: null,
            note: entry.note || null,
            occurred_on: entry.date,
          })
        : await supabase.from("transactions").insert({
            kind: "expense",
            amount: amt,
            category: entry.category,
            note: entry.note || null,
            occurred_on: entry.date,
          });

    setSubmitting(false);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    setEntry((p) => ({ ...p, amount: "", note: "" }));
    await loadAll();
  }

  async function deleteTransaction(id: string) {
    const res = await supabase.from("transactions").delete().eq("id", id);
    if (res.error) setError(res.error.message);
    else await loadAll();
  }

  const pageLoading = categoriesLoading || loading;

  return (
    <div>
      <div className="page-title">
        <h1>Dashboard</h1>
        <span className="period">{formatMonthYear(year, month)}</span>
      </div>

      {pageLoading ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="grid">
          <section className="card">
            <h2>Spending vs budget</h2>
            <div className="chart-wrap">
              <div style={{ width: 240, height: 240, position: "relative" }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={chartData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={70}
                      outerRadius={110}
                      paddingAngle={1}
                      isAnimationActive={false}
                    >
                      {chartData.map((d, i) => (
                        <Cell key={i} fill={d.color} stroke="none" />
                      ))}
                    </Pie>
                    <Tooltip
                      content={<PieTooltip />}
                      allowEscapeViewBox={{ x: true, y: true }}
                      wrapperStyle={{ zIndex: 20, outline: "none" }}
                      cursor={false}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    pointerEvents: "none",
                  }}
                >
                  <div style={{ fontSize: "1.4rem", fontWeight: 700 }}>
                    {totalBudget === 0 ? "—" : `${Math.round(percentSpent)}%`}
                  </div>
                  <div className="muted" style={{ fontSize: "0.8rem" }}>
                    {totalBudget === 0 ? "no budget" : "spent"}
                  </div>
                </div>
              </div>
              <div className="legend">
                {names.map((c) => {
                  const spent = spentByCategory[c];
                  const budget = budgetByCategory[c];
                  return (
                    <div className="legend-row" key={c}>
                      <span
                        className="legend-swatch"
                        style={{ background: spent > 0 ? (colors[c] ?? "#c9a98b") : UNUSED_COLOR }}
                      />
                      <span>{c}</span>
                      <span className="legend-amount">
                        {formatUSD(spent)} / {formatUSD(budget)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            {overBudget && (
              <p className="error">
                Over budget by {formatUSD(totalSpent - totalBudget)}.
              </p>
            )}
          </section>

          <div className="dashboard-side">
            <section className="card">
              <h2>This month</h2>
              <div className="stats">
              <div className="stat">
                <span className="label">Income</span>
                <span className="value success">{formatUSD(totalIncome)}</span>
              </div>
              <div className="stat">
                <span className="label">Spent</span>
                <span className="value danger">{formatUSD(totalSpent)}</span>
              </div>
              </div>
            </section>

            <section className="card">
              <h2>Recent activity</h2>
              {transactions.length === 0 ? (
                <p className="muted">No entries yet this month.</p>
              ) : (
                <div className="tx-list">
                  {transactions.map((t) => (
                    <div className="tx-row" key={t.id}>
                      <span className="date">{t.occurred_on}</span>
                      <span className="tx-label">
                        <span className="tx-category">
                          {t.kind === "income" ? "Income" : t.category}
                        </span>
                        {t.note ? <span className="tx-note"> · {t.note}</span> : null}
                      </span>
                      <span className={`amt ${t.kind}`}>
                        {t.kind === "income" ? "+" : "−"}
                        {formatUSD(Number(t.amount))}
                      </span>
                      <button
                        className="del"
                        aria-label="delete"
                        onClick={() => deleteTransaction(t.id)}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="card grid-full">
            <h2>Add entry</h2>
            <form className="entry-form" onSubmit={submitEntry}>
              <select
                value={entry.kind}
                onChange={(e) =>
                  setEntry((p) => ({ ...p, kind: e.target.value as NewEntry["kind"] }))
                }
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Amount"
                value={entry.amount}
                onChange={(e) => setEntry((p) => ({ ...p, amount: e.target.value }))}
                required
              />
              {entry.kind === "expense" ? (
                <select
                  value={entry.category}
                  onChange={(e) =>
                    setEntry((p) => ({ ...p, category: e.target.value }))
                  }
                >
                  {names.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              ) : (
                <input disabled placeholder="—" />
              )}
              <input
                type="text"
                placeholder="Note (optional)"
                value={entry.note}
                onChange={(e) => setEntry((p) => ({ ...p, note: e.target.value }))}
              />
              <button type="submit" disabled={submitting}>
                {submitting ? "Adding…" : "Add"}
              </button>
            </form>
            <div className="spacer" />
            <input
              type="date"
              value={entry.date}
              onChange={(e) => setEntry((p) => ({ ...p, date: e.target.value }))}
            />
            {error && <div className="error">{error}</div>}
          </section>
        </div>
      )}
    </div>
  );
}
