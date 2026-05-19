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
import { isSetAsideCategory } from "../lib/categories";
import { supabase } from "../lib/supabase";
import { Budget, Transaction, UNUSED_COLOR } from "../types";
import {
  balanceFromTransactions,
  formatMonthYear,
  formatUSD,
  maxEntryDateForMonth,
  monthRange,
} from "../lib/format";
import {
  currentPeriod,
  fetchAvailablePeriods,
  formatPeriodLabel,
  parsePeriodKey,
  periodKey,
  type Period,
} from "../lib/periods";

type EntryKind = "income" | "expense" | "set_aside";

type NewEntry = {
  kind: EntryKind;
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

  const expenseNames = useMemo(
    () => names.filter((n) => !isSetAsideCategory(n)),
    [names]
  );
  const setAsideNames = useMemo(
    () => names.filter((n) => isSetAsideCategory(n)),
    [names]
  );

  const [selectedKey, setSelectedKey] = useState(() => periodKey(currentPeriod()));
  const [availablePeriods, setAvailablePeriods] = useState<Period[]>(() => [currentPeriod()]);

  const { year, month } = useMemo(() => parsePeriodKey(selectedKey), [selectedKey]);
  const { start, end } = useMemo(() => monthRange(year, month), [year, month]);
  const isCurrentMonth = selectedKey === periodKey(currentPeriod());
  const maxEntryDate = useMemo(
    () => maxEntryDateForMonth(year, month),
    [year, month]
  );

  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [balance, setBalance] = useState(0);
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
    if (entry.kind === "expense" && expenseNames.length > 0 && !expenseNames.includes(entry.category)) {
      setEntry((p) => ({ ...p, category: expenseNames[0] }));
    }
    if (entry.kind === "set_aside" && setAsideNames.length > 0 && !setAsideNames.includes(entry.category)) {
      setEntry((p) => ({ ...p, category: setAsideNames[0] }));
    }
  }, [expenseNames, setAsideNames, entry.kind, entry.category]);

  useEffect(() => {
    setEntry((p) => {
      if (p.date >= start && p.date <= maxEntryDate) return p;
      return { ...p, date: isCurrentMonth ? todayISO() : maxEntryDate };
    });
  }, [start, maxEntryDate, isCurrentMonth]);

  async function refreshPeriods() {
    const periods = await fetchAvailablePeriods();
    setAvailablePeriods(periods);
    setSelectedKey((key) => {
      const keys = new Set(periods.map(periodKey));
      return keys.has(key) ? key : periodKey(currentPeriod());
    });
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    const balanceThrough = isCurrentMonth ? maxEntryDate : end;
    const [b, t, bal] = await Promise.all([
      supabase.from("budgets").select("*").eq("year", year).eq("month", month),
      supabase
        .from("transactions")
        .select("*")
        .gte("occurred_on", start)
        .lte("occurred_on", end)
        .order("occurred_on", { ascending: false }),
      supabase
        .from("transactions")
        .select("kind, amount")
        .lte("occurred_on", balanceThrough),
    ]);
    if (b.error || t.error || bal.error) {
      setError(b.error?.message ?? t.error?.message ?? bal.error?.message ?? "Load failed");
      setLoading(false);
      return;
    }
    setBudgets((b.data ?? []) as Budget[]);
    setTransactions((t.data ?? []) as Transaction[]);
    setBalance(balanceFromTransactions(bal.data ?? []));
    setLoading(false);
    await refreshPeriods();
  }

  useEffect(() => {
    if (!categoriesLoading && names.length > 0) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, categoriesLoading, names.join("|")]);

  const spentByCategory = useMemo(() => {
    const out = zeroMap(expenseNames);
    for (const t of transactions) {
      if (
        t.kind === "expense" &&
        t.category &&
        t.category in out &&
        !isSetAsideCategory(t.category)
      ) {
        out[t.category] += Number(t.amount);
      }
    }
    return out;
  }, [transactions, expenseNames]);

  const allSpentByCategory = useMemo(() => {
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
    const out = zeroMap(expenseNames);
    for (const b of budgets) {
      if (b.category in out) out[b.category] = Number(b.percent);
    }
    return out;
  }, [budgets, expenseNames]);

  const budgetByCategory = useMemo(() => {
    const out = zeroMap(expenseNames);
    for (const c of expenseNames) out[c] = (percentByCategory[c] / 100) * totalIncome;
    return out;
  }, [percentByCategory, totalIncome, expenseNames]);

  const percentByCategoryAll = useMemo(() => {
    const out = zeroMap(names);
    for (const b of budgets) {
      if (b.category in out) out[b.category] = Number(b.percent);
    }
    return out;
  }, [budgets, names]);

  const budgetByCategoryAll = useMemo(() => {
    const out = zeroMap(names);
    for (const c of names) out[c] = (percentByCategoryAll[c] / 100) * totalIncome;
    return out;
  }, [percentByCategoryAll, totalIncome, names]);

  const totalBudget = useMemo(
    () => expenseNames.reduce((s, c) => s + budgetByCategory[c], 0),
    [budgetByCategory, expenseNames]
  );
  const totalSpent = useMemo(
    () => expenseNames.reduce((s, c) => s + spentByCategory[c], 0),
    [spentByCategory, expenseNames]
  );

  const chartTotalBudget = useMemo(
    () => names.reduce((s, c) => s + budgetByCategoryAll[c], 0),
    [budgetByCategoryAll, names]
  );
  const chartTotalSpent = useMemo(
    () => names.reduce((s, c) => s + allSpentByCategory[c], 0),
    [allSpentByCategory, names]
  );

  const totalSetAside = useMemo(
    () => setAsideNames.reduce((s, c) => s + allSpentByCategory[c], 0),
    [allSpentByCategory, setAsideNames]
  );

  const overBudget = totalSpent > totalBudget && totalBudget > 0;
  const percentChartSpent =
    chartTotalBudget > 0 ? (chartTotalSpent / chartTotalBudget) * 100 : 0;

  const chartData = useMemo(() => {
    const slices: { name: string; value: number; color: string }[] = names
      .filter((c) => allSpentByCategory[c] > 0)
      .map((c) => ({
        name: c,
        value: allSpentByCategory[c],
        color: colors[c] ?? "#c9a98b",
      }));
    const remaining = Math.max(0, chartTotalBudget - chartTotalSpent);
    if (remaining > 0 || slices.length === 0) {
      slices.push({
        name: chartTotalBudget === 0 ? "No budget set" : "Unused",
        value: remaining > 0 ? remaining : 1,
        color: UNUSED_COLOR,
      });
    }
    return slices;
  }, [allSpentByCategory, chartTotalBudget, chartTotalSpent, names, colors]);

  async function submitEntry(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(entry.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Amount must be greater than 0");
      return;
    }
    if (entry.kind === "expense" && expenseNames.length === 0) {
      setError("Add at least one expense category in Settings");
      return;
    }
    if (entry.kind === "set_aside" && setAsideNames.length === 0) {
      setError(
        'Add a category whose name includes "Savings" or "Investment" in Settings'
      );
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
        <div className="period-select-wrap">
          <select
            className="period-select"
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
            aria-label="Select month"
          >
            {availablePeriods.map((p) => (
              <option key={periodKey(p)} value={periodKey(p)}>
                {formatPeriodLabel(p)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {pageLoading ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="grid">
          <div className="dashboard-top">
          <section className="card chart-card">
            <h2>Spending VS Budget</h2>
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
                    {chartTotalBudget === 0 ? "—" : `${Math.round(percentChartSpent)}%`}
                  </div>
                  <div className="muted" style={{ fontSize: "0.8rem" }}>
                    {chartTotalBudget === 0 ? "no budget" : "allocated"}
                  </div>
                </div>
              </div>
              <div className="legend">
                {names.map((c) => {
                      const spent = allSpentByCategory[c];
                      const budget = budgetByCategoryAll[c];
                      return (
                        <div className="legend-row" key={c}>
                          <span
                            className="legend-swatch"
                            style={{
                              background: spent > 0 ? (colors[c] ?? "#c9a98b") : UNUSED_COLOR,
                            }}
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
            <section className="card this-month-card">
              <h2>This Month</h2>
              <div className="stats stats-inline">
              <div className="stat">
                <div className="stat-inner">
                  <span className="label">Income</span>
                  <span className="value success">{formatUSD(totalIncome)}</span>
                </div>
              </div>
              <div className="stat">
                <div className="stat-inner">
                  <span className="label">Spent</span>
                  <span className="value danger">{formatUSD(totalSpent)}</span>
                </div>
              </div>
              {setAsideNames.length > 0 && (
                <div className="stat">
                  <div className="stat-inner">
                    <span className="label">Savings & Investments</span>
                    <span className="value success">{formatUSD(totalSetAside)}</span>
                  </div>
                </div>
              )}
                <div className="stat">
                  <div className="stat-inner">
                    <span className="label">Balance</span>
                    <span className={`value ${balance >= 0 ? "success" : "danger"}`}>
                      {formatUSD(balance)}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section className="card recent-activity-card">
              <h2>Recent Activity</h2>
              <div className="recent-activity-body">
              {transactions.length === 0 ? (
                <p className="muted">No entries for {formatMonthYear(year, month)}.</p>
              ) : (
                <div className="tx-list">
                  {transactions.map((t) => {
                    const setAside =
                      t.kind === "expense" && t.category && isSetAsideCategory(t.category);
                    const amtClass =
                      t.kind === "income" ? "income" : setAside ? "set_aside" : "expense";
                    return (
                      <div className="tx-row" key={t.id}>
                        <span className="date">{t.occurred_on}</span>
                        <span className="tx-label">
                          <span className="tx-category">
                            {t.kind === "income" ? "Income" : t.category}
                          </span>
                          {t.note ? <span className="tx-note"> · {t.note}</span> : null}
                        </span>
                        <span className={`amt ${amtClass}`}>
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
                    );
                  })}
                </div>
              )}
              </div>
            </section>
          </div>
          </div>

          <section className="card grid-full">
            <h2>Add Entry</h2>
            <form className="entry-form" onSubmit={submitEntry}>
              <select
                value={entry.kind}
                onChange={(e) => {
                  const kind = e.target.value as EntryKind;
                  setEntry((p) => ({
                    ...p,
                    kind,
                    category:
                      kind === "expense"
                        ? expenseNames[0] ?? ""
                        : kind === "set_aside"
                          ? setAsideNames[0] ?? ""
                          : p.category,
                  }));
                }}
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
                {setAsideNames.length > 0 && (
                  <option value="set_aside">Savings & Investments</option>
                )}
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
                  {expenseNames.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              ) : entry.kind === "set_aside" ? (
                <select
                  value={entry.category}
                  onChange={(e) =>
                    setEntry((p) => ({ ...p, category: e.target.value }))
                  }
                >
                  {setAsideNames.map((c) => (
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
              min={start}
              max={maxEntryDate}
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
