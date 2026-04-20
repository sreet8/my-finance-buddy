import { useEffect, useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { supabase } from "../lib/supabase";
import {
  Budget,
  CATEGORIES,
  CATEGORY_COLORS,
  Category,
  SavingsContribution,
  Transaction,
  UNUSED_COLOR,
} from "../types";
import { formatMonthYear, formatUSD, monthRange } from "../lib/format";

type NewEntry = {
  kind: "income" | "expense" | "savings";
  amount: string;
  category: Category;
  note: string;
  date: string;
};

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function Dashboard() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const { start, end } = useMemo(() => monthRange(year, month), [year, month]);

  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [savings, setSavings] = useState<SavingsContribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [entry, setEntry] = useState<NewEntry>({
    kind: "expense",
    amount: "",
    category: "Food",
    note: "",
    date: todayISO(),
  });
  const [submitting, setSubmitting] = useState(false);

  async function loadAll() {
    setLoading(true);
    setError(null);
    const [b, t, s] = await Promise.all([
      supabase.from("budgets").select("*").eq("year", year).eq("month", month),
      supabase
        .from("transactions")
        .select("*")
        .gte("occurred_on", start)
        .lte("occurred_on", end)
        .order("occurred_on", { ascending: false }),
      supabase
        .from("savings_contributions")
        .select("*")
        .gte("occurred_on", start)
        .lte("occurred_on", end)
        .order("occurred_on", { ascending: false }),
    ]);
    if (b.error || t.error || s.error) {
      setError(b.error?.message ?? t.error?.message ?? s.error?.message ?? "Load failed");
      setLoading(false);
      return;
    }
    setBudgets((b.data ?? []) as Budget[]);
    setTransactions((t.data ?? []) as Transaction[]);
    setSavings((s.data ?? []) as SavingsContribution[]);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  const spentByCategory = useMemo(() => {
    const out: Record<Category, number> = {
      Housing: 0, Food: 0, Transport: 0, Utilities: 0,
      Entertainment: 0, Shopping: 0, Other: 0,
    };
    for (const t of transactions) {
      if (t.kind === "expense" && t.category) out[t.category] += Number(t.amount);
    }
    return out;
  }, [transactions]);

  const totalIncome = useMemo(
    () => transactions.filter((t) => t.kind === "income").reduce((s, t) => s + Number(t.amount), 0),
    [transactions]
  );

  const percentByCategory = useMemo(() => {
    const out: Record<Category, number> = {
      Housing: 0, Food: 0, Transport: 0, Utilities: 0,
      Entertainment: 0, Shopping: 0, Other: 0,
    };
    for (const b of budgets) out[b.category] = Number(b.percent);
    return out;
  }, [budgets]);

  const budgetByCategory = useMemo(() => {
    const out: Record<Category, number> = {
      Housing: 0, Food: 0, Transport: 0, Utilities: 0,
      Entertainment: 0, Shopping: 0, Other: 0,
    };
    for (const c of CATEGORIES) out[c] = (percentByCategory[c] / 100) * totalIncome;
    return out;
  }, [percentByCategory, totalIncome]);

  const totalBudget = useMemo(
    () => CATEGORIES.reduce((s, c) => s + budgetByCategory[c], 0),
    [budgetByCategory]
  );
  const totalSpent = useMemo(
    () => CATEGORIES.reduce((s, c) => s + spentByCategory[c], 0),
    [spentByCategory]
  );
  const totalSavings = useMemo(
    () => savings.reduce((s, x) => s + Number(x.amount), 0),
    [savings]
  );

  const overBudget = totalSpent > totalBudget && totalBudget > 0;
  const percentSpent = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;
  const savingsRate = totalIncome > 0 ? (totalSavings / totalIncome) * 100 : 0;

  const chartData = useMemo(() => {
    const slices: { name: string; value: number; color: string }[] = CATEGORIES
      .filter((c) => spentByCategory[c] > 0)
      .map((c) => ({
        name: c,
        value: spentByCategory[c],
        color: CATEGORY_COLORS[c],
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
  }, [spentByCategory, totalBudget, totalSpent]);

  async function submitEntry(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(entry.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Amount must be greater than 0");
      return;
    }
    setSubmitting(true);
    setError(null);

    let res;
    if (entry.kind === "income") {
      res = await supabase.from("transactions").insert({
        kind: "income",
        amount: amt,
        category: null,
        note: entry.note || null,
        occurred_on: entry.date,
      });
    } else if (entry.kind === "expense") {
      res = await supabase.from("transactions").insert({
        kind: "expense",
        amount: amt,
        category: entry.category,
        note: entry.note || null,
        occurred_on: entry.date,
      });
    } else {
      res = await supabase.from("savings_contributions").insert({
        amount: amt,
        note: entry.note || null,
        occurred_on: entry.date,
      });
    }
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

  async function deleteSaving(id: string) {
    const res = await supabase.from("savings_contributions").delete().eq("id", id);
    if (res.error) setError(res.error.message);
    else await loadAll();
  }

  return (
    <div>
      <div className="page-title">
        <h1>Dashboard</h1>
        <span className="period">{formatMonthYear(year, month)}</span>
      </div>

      {loading ? (
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
                      formatter={(v: number, n) => [formatUSD(Number(v)), n]}
                      contentStyle={{ background: "#1e293b", border: "1px solid #334155" }}
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
                {CATEGORIES.map((c) => {
                  const spent = spentByCategory[c];
                  const budget = budgetByCategory[c];
                  return (
                    <div className="legend-row" key={c}>
                      <span
                        className="legend-swatch"
                        style={{ background: spent > 0 ? CATEGORY_COLORS[c] : UNUSED_COLOR }}
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

          <section className="card">
            <h2>This month</h2>
            <div className="stats">
              <div className="stat">
                <span className="label">Income</span>
                <span className="value success">{formatUSD(totalIncome)}</span>
              </div>
              <div className="stat">
                <span className="label">Spent</span>
                <span className={`value ${overBudget ? "danger" : ""}`}>{formatUSD(totalSpent)}</span>
              </div>
              <div className="stat">
                <span className="label">Budget</span>
                <span className="value">{formatUSD(totalBudget)}</span>
              </div>
              <div className="stat">
                <span className="label">Savings</span>
                <span className="value success">{formatUSD(totalSavings)}</span>
              </div>
              <div className="stat">
                <span className="label">Savings rate</span>
                <span className="value">
                  {totalIncome > 0 ? `${Math.round(savingsRate)}%` : "—"}
                </span>
              </div>
            </div>
          </section>

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
                <option value="savings">Savings</option>
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
                    setEntry((p) => ({ ...p, category: e.target.value as Category }))
                  }
                >
                  {CATEGORIES.map((c) => (
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

          <section className="card grid-full">
            <h2>Recent activity</h2>
            {transactions.length === 0 && savings.length === 0 ? (
              <p className="muted">No entries yet this month.</p>
            ) : (
              <div className="tx-list">
                {transactions.map((t) => (
                  <div className="tx-row" key={`t-${t.id}`}>
                    <span className="date">{t.occurred_on}</span>
                    <span>
                      {t.kind === "income" ? "Income" : t.category}
                      {t.note ? ` · ${t.note}` : ""}
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
                {savings.map((s) => (
                  <div className="tx-row" key={`s-${s.id}`}>
                    <span className="date">{s.occurred_on}</span>
                    <span>Savings{s.note ? ` · ${s.note}` : ""}</span>
                    <span className="amt income">+{formatUSD(Number(s.amount))}</span>
                    <button
                      className="del"
                      aria-label="delete"
                      onClick={() => deleteSaving(s.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
