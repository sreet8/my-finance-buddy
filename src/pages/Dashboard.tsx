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
import { Transaction, UNUSED_COLOR } from "../types";
import {
  formatMonthYear,
  formatUSD,
  maxEntryDateForMonth,
  monthRange,
} from "../lib/format";
import {
  currentPeriod,
  fetchAvailablePeriods,
  fetchEffectiveBudgets,
  fetchStartingBalance,
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
  title: string;
  description: string;
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

const PIE_SIZE = 200;
const PIE_CENTER = PIE_SIZE / 2;
const PIE_TOOLTIP_OFFSET = 52;

type ChartSlice = { name: string; value: number; color: string };

function buildChartSlices(
  categoryNames: string[],
  spentByCategory: Record<string, number>,
  totalBudget: number,
  totalSpent: number,
  colors: Record<string, string>
): ChartSlice[] {
  const slices: ChartSlice[] = categoryNames
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
}

function BudgetPieBlock({
  label,
  categoryNames,
  spentByCategory,
  budgetByCategory,
  colors,
}: {
  label: string;
  categoryNames: string[];
  spentByCategory: Record<string, number>;
  budgetByCategory: Record<string, number>;
  colors: Record<string, string>;
}) {
  const totalBudget = categoryNames.reduce((s, c) => s + budgetByCategory[c], 0);
  const totalSpent = categoryNames.reduce((s, c) => s + spentByCategory[c], 0);
  const percentAllocated =
    totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;
  const chartData = useMemo(
    () =>
      buildChartSlices(
        categoryNames,
        spentByCategory,
        totalBudget,
        totalSpent,
        colors
      ),
    [categoryNames, spentByCategory, totalBudget, totalSpent, colors]
  );

  return (
    <div className="pie-block">
      <h3 className="pie-block-title">{label}</h3>
      <div className="pie-chart-container">
        <ResponsiveContainer width={PIE_SIZE} height={PIE_SIZE}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              innerRadius={58}
              outerRadius={92}
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
        <div className="pie-center-label">
          <div className="pie-center-percent">
            {totalBudget === 0 ? "—" : `${Math.round(percentAllocated)}%`}
          </div>
          <div className="muted pie-center-caption">
            {totalBudget === 0 ? "no budget" : "allocated"}
          </div>
        </div>
      </div>
      <div className="pie-tally">
        {formatUSD(totalSpent)} / {formatUSD(totalBudget)}
      </div>
    </div>
  );
}

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

/** The editable categories available for a given entry type. */
function categoriesForKind(
  kind: EntryKind,
  expenseNames: string[],
  incomeNames: string[],
  savingsNames: string[]
): string[] {
  if (kind === "income") return incomeNames;
  if (kind === "set_aside") return savingsNames;
  return expenseNames;
}

export default function Dashboard() {
  const {
    expenseNames,
    incomeNames,
    savingsNames,
    typeByName,
    colors,
    loading: categoriesLoading,
  } = useCategories();

  const setAsideNames = savingsNames;

  const [selectedKey, setSelectedKey] = useState(() => periodKey(currentPeriod()));
  const [availablePeriods, setAvailablePeriods] = useState<Period[]>(() => [currentPeriod()]);

  const { year, month } = useMemo(() => parsePeriodKey(selectedKey), [selectedKey]);
  const { start, end } = useMemo(() => monthRange(year, month), [year, month]);
  const isCurrentMonth = selectedKey === periodKey(currentPeriod());
  const maxEntryDate = useMemo(
    () => maxEntryDateForMonth(year, month),
    [year, month]
  );

  const [budgetPercents, setBudgetPercents] = useState<Record<string, number>>({});
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [startingBalance, setStartingBalance] = useState(0);
  const [budgetIncome, setBudgetIncome] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activityExpanded, setActivityExpanded] = useState(false);

  const [entry, setEntry] = useState<NewEntry>({
    kind: "expense",
    amount: "",
    category: "",
    title: "",
    description: "",
    date: todayISO(),
  });
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<(NewEntry & { id: string }) | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const namesReady =
    expenseNames.length + incomeNames.length + savingsNames.length > 0;

  useEffect(() => {
    const list = categoriesForKind(
      entry.kind,
      expenseNames,
      incomeNames,
      savingsNames
    );
    if (list.length > 0 && !list.includes(entry.category)) {
      setEntry((p) => ({ ...p, category: list[0] }));
    }
  }, [expenseNames, incomeNames, savingsNames, entry.kind, entry.category]);

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
    const [effective, t, starting, inc] = await Promise.all([
      fetchEffectiveBudgets({ year, month }),
      supabase
        .from("transactions")
        .select("*")
        .gte("occurred_on", start)
        .lte("occurred_on", end)
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false }),
      fetchStartingBalance({ year, month }),
      supabase
        .from("monthly_income")
        .select("amount")
        .eq("year", year)
        .eq("month", month)
        .maybeSingle(),
    ]);
    if (t.error) {
      setError(t.error.message ?? "Load failed");
      setLoading(false);
      return;
    }
    setBudgetPercents(effective.percentByCategory);
    setTransactions((t.data ?? []) as Transaction[]);
    setStartingBalance(starting);
    // Budget income defaults to the month's starting balance until explicitly set.
    setBudgetIncome(inc.data ? Number(inc.data.amount) : starting);
    setLoading(false);
    await refreshPeriods();
  }

  useEffect(() => {
    if (!categoriesLoading && namesReady) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, categoriesLoading, namesReady]);

  useEffect(() => {
    if (!activityExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActivityExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activityExpanded]);

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  const spentByCategory = useMemo(() => {
    const out = zeroMap(expenseNames);
    for (const t of transactions) {
      if (t.kind === "expense" && t.category && t.category in out) {
        out[t.category] += Number(t.amount);
      }
    }
    return out;
  }, [transactions, expenseNames]);

  const savingsSpentByCategory = useMemo(() => {
    const out = zeroMap(savingsNames);
    for (const t of transactions) {
      if (t.kind === "expense" && t.category && t.category in out) {
        out[t.category] += Number(t.amount);
      }
    }
    return out;
  }, [transactions, savingsNames]);

  const monthIncomeTx = useMemo(
    () => transactions.filter((t) => t.kind === "income").reduce((s, t) => s + Number(t.amount), 0),
    [transactions]
  );

  const monthExpenseTotal = useMemo(
    () => transactions.filter((t) => t.kind === "expense").reduce((s, t) => s + Number(t.amount), 0),
    [transactions]
  );

  // Ending balance reflects every transaction to date: the carried-over starting
  // balance plus this month's income, minus this month's spending.
  const endingBalance = useMemo(
    () => startingBalance + monthIncomeTx - monthExpenseTotal,
    [startingBalance, monthIncomeTx, monthExpenseTotal]
  );

  const budgetByCategory = useMemo(() => {
    const out = zeroMap(expenseNames);
    for (const c of expenseNames) {
      out[c] = ((Number(budgetPercents[c]) || 0) / 100) * budgetIncome;
    }
    return out;
  }, [budgetPercents, budgetIncome, expenseNames]);

  const savingsBudgetByCategory = useMemo(() => {
    const out = zeroMap(savingsNames);
    for (const c of savingsNames) {
      out[c] = ((Number(budgetPercents[c]) || 0) / 100) * budgetIncome;
    }
    return out;
  }, [budgetPercents, budgetIncome, savingsNames]);

  const totalBudget = useMemo(
    () => expenseNames.reduce((s, c) => s + budgetByCategory[c], 0),
    [budgetByCategory, expenseNames]
  );
  const totalSpent = useMemo(
    () => expenseNames.reduce((s, c) => s + spentByCategory[c], 0),
    [spentByCategory, expenseNames]
  );

  const totalSetAside = useMemo(
    () => setAsideNames.reduce((s, c) => s + savingsSpentByCategory[c], 0),
    [savingsSpentByCategory, setAsideNames]
  );

  const overBudget = totalSpent > totalBudget && totalBudget > 0;

  const recentTransactions = useMemo(() => {
    return [...transactions].sort((a, b) => {
      const byDate = b.occurred_on.localeCompare(a.occurred_on);
      if (byDate !== 0) return byDate;
      const aEntered = a.created_at ?? "";
      const bEntered = b.created_at ?? "";
      return bEntered.localeCompare(aEntered);
    });
  }, [transactions]);

  async function submitEntry(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(entry.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Amount must be greater than 0");
      return;
    }
    if (!entry.title.trim()) {
      setError("Entry title is required");
      return;
    }
    const list = categoriesForKind(
      entry.kind,
      expenseNames,
      incomeNames,
      savingsNames
    );
    if (list.length === 0) {
      setError("Add at least one category for this entry type in Settings");
      return;
    }
    if (!entry.category) {
      setError("Choose a category");
      return;
    }
    setSubmitting(true);
    setError(null);

    const res = await supabase.from("transactions").insert({
      kind: entry.kind === "income" ? "income" : "expense",
      amount: amt,
      category: entry.category,
      title: entry.title.trim(),
      description: entry.description.trim() || null,
      occurred_on: entry.date,
    });

    setSubmitting(false);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    setEntry((p) => ({
      ...p,
      amount: "",
      title: "",
      description: "",
    }));
    await loadAll();
  }

  function beginEdit(t: Transaction) {
    const uiKind: EntryKind =
      t.kind === "income"
        ? "income"
        : t.category && typeByName[t.category] === "savings"
          ? "set_aside"
          : "expense";
    setEditing({
      id: t.id,
      kind: uiKind,
      amount: String(t.amount),
      category: t.category ?? "",
      title: t.title ?? "",
      description: t.description ?? "",
      date: t.occurred_on,
    });
    setError(null);
  }

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const amt = Number(editing.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Amount must be greater than 0");
      return;
    }
    if (!editing.title.trim()) {
      setError("Entry title is required");
      return;
    }
    setEditSubmitting(true);
    setError(null);

    const res = await supabase
      .from("transactions")
      .update({
        kind: editing.kind === "income" ? "income" : "expense",
        amount: amt,
        category: editing.category || null,
        title: editing.title.trim(),
        description: editing.description.trim() || null,
        occurred_on: editing.date,
      })
      .eq("id", editing.id);

    setEditSubmitting(false);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    setEditing(null);
    await loadAll();
  }

  async function deleteTransaction(id: string) {
    const res = await supabase.from("transactions").delete().eq("id", id);
    if (res.error) setError(res.error.message);
    else await loadAll();
  }

  const pageLoading = categoriesLoading || loading;

  const entryCategories = categoriesForKind(
    entry.kind,
    expenseNames,
    incomeNames,
    savingsNames
  );
  const editCategories = editing
    ? categoriesForKind(editing.kind, expenseNames, incomeNames, savingsNames)
    : [];

  function entryMeta(t: Transaction) {
    const setAside =
      t.kind === "expense" && t.category && typeByName[t.category] === "savings";
    const amtClass =
      t.kind === "income" ? "income" : setAside ? "set_aside" : "expense";
    const categoryLabel =
      t.category ?? (t.kind === "income" ? "Income" : "Uncategorized");
    return { amtClass, categoryLabel };
  }

  // Collapsed view: date, entry type, and amount only — kept skinny so more
  // entries are visible before expanding.
  function renderCompactList() {
    if (recentTransactions.length === 0) {
      return <p className="muted">No entries for {formatMonthYear(year, month)}.</p>;
    }
    return (
      <div className="tx-list tx-list-compact">
        {recentTransactions.map((t) => {
          const { amtClass, categoryLabel } = entryMeta(t);
          return (
            <div className="tx-row tx-row-compact" key={t.id}>
              <span className="date">{t.occurred_on}</span>
              <span className="tx-type">{categoryLabel}</span>
              <span className={`amt ${amtClass}`}>
                {t.kind === "income" ? "+" : "−"}
                {formatUSD(Number(t.amount))}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  // Expanded view: every field. The description takes the remaining width and is
  // truncated with an ellipsis before it would run into the amount.
  function renderFullList() {
    if (recentTransactions.length === 0) {
      return <p className="muted">No entries for {formatMonthYear(year, month)}.</p>;
    }
    return (
      <div className="tx-list">
        {recentTransactions.map((t) => {
          const { amtClass, categoryLabel } = entryMeta(t);
          return (
            <div className="tx-row" key={t.id}>
              <span className="date">{t.occurred_on}</span>
              <span className="tx-label tx-label-full">
                {t.title ? <span className="tx-title">{t.title}</span> : null}
                <span className="tx-category">{categoryLabel}</span>
                {t.description ? (
                  <span className="tx-note tx-note-truncate">{t.description}</span>
                ) : null}
              </span>
              <span className={`amt ${amtClass}`}>
                {t.kind === "income" ? "+" : "−"}
                {formatUSD(Number(t.amount))}
              </span>
              <span className="tx-actions">
                <button
                  className="edit"
                  aria-label="edit"
                  title="Edit"
                  onClick={() => beginEdit(t)}
                >
                  ✎
                </button>
                <button
                  className="del"
                  aria-label="delete"
                  onClick={() => deleteTransaction(t.id)}
                >
                  ✕
                </button>
              </span>
            </div>
          );
        })}
      </div>
    );
  }

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
              <div className="charts-dual">
                <BudgetPieBlock
                  label="Spending"
                  categoryNames={expenseNames}
                  spentByCategory={spentByCategory}
                  budgetByCategory={budgetByCategory}
                  colors={colors}
                />
                <BudgetPieBlock
                  label="Savings & Investments"
                  categoryNames={setAsideNames}
                  spentByCategory={savingsSpentByCategory}
                  budgetByCategory={savingsBudgetByCategory}
                  colors={colors}
                />
              </div>
              <div className="legend-split">
                {expenseNames.length > 0 && (
                  <div className="legend">
                    <div className="legend-heading">Spending</div>
                    {expenseNames.map((c) => {
                      const spent = spentByCategory[c];
                      const budget = budgetByCategory[c];
                      return (
                        <div className="legend-row" key={c}>
                          <span
                            className="legend-swatch"
                            style={{
                              background:
                                spent > 0 ? (colors[c] ?? "#c9a98b") : UNUSED_COLOR,
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
                )}
                {setAsideNames.length > 0 && (
                  <div className="legend">
                    <div className="legend-heading">Savings & Investments</div>
                    {setAsideNames.map((c) => {
                      const spent = savingsSpentByCategory[c];
                      const budget = savingsBudgetByCategory[c];
                      return (
                        <div className="legend-row" key={c}>
                          <span
                            className="legend-swatch"
                            style={{
                              background:
                                spent > 0 ? (colors[c] ?? "#c9a98b") : UNUSED_COLOR,
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
                )}
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
                  <span className="label">Starting Balance</span>
                  <span className={`value ${startingBalance >= 0 ? "success" : "danger"}`}>
                    {formatUSD(startingBalance)}
                  </span>
                </div>
              </div>
              <div className="stat">
                <div className="stat-inner">
                  <span className="label">Spent</span>
                  <span className="value danger">{formatUSD(totalSpent)}</span>
                </div>
              </div>
              {setAsideNames.length > 0 && (
                <div className="stat stat-set-aside">
                  <div className="stat-inner">
                    <span className="label">Savings & Investments</span>
                    <span className="value success">{formatUSD(totalSetAside)}</span>
                  </div>
                </div>
              )}
                <div className="stat stat-set-aside">
                  <div className="stat-inner">
                    <span className="label">Ending Balance</span>
                    <span className={`value ${endingBalance >= 0 ? "success" : "danger"}`}>
                      {formatUSD(endingBalance)}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section className="card recent-activity-card">
              <button
                type="button"
                className="recent-activity-title"
                onClick={() => setActivityExpanded(true)}
                title="Expand Recent Activity"
                aria-haspopup="dialog"
              >
                <span>Recent Activity</span>
                <span className="expand-hint" aria-hidden="true">⤢</span>
              </button>
              <div className="recent-activity-body">
                {renderCompactList()}
              </div>
            </section>
          </div>
          </div>

          <section className="card grid-full">
            <h2>Add Entry</h2>
            <form className="entry-form" onSubmit={submitEntry}>
              <label className="entry-field">
                <span>Entry Type</span>
                <select
                  value={entry.kind}
                  onChange={(e) => {
                    const kind = e.target.value as EntryKind;
                    const list = categoriesForKind(
                      kind,
                      expenseNames,
                      incomeNames,
                      savingsNames
                    );
                    setEntry((p) => ({ ...p, kind, category: list[0] ?? "" }));
                  }}
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                  <option value="set_aside">Savings &amp; Investments</option>
                </select>
              </label>
              <label className="entry-field">
                <span>Category</span>
                <select
                  value={entry.category}
                  onChange={(e) =>
                    setEntry((p) => ({ ...p, category: e.target.value }))
                  }
                  disabled={entryCategories.length === 0}
                >
                  {entryCategories.length === 0 ? (
                    <option value="">No categories — add in Settings</option>
                  ) : (
                    entryCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="entry-field">
                <span>Amount</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={entry.amount}
                  onChange={(e) => setEntry((p) => ({ ...p, amount: e.target.value }))}
                  required
                />
              </label>
              <label className="entry-field">
                <span>Entry Title</span>
                <input
                  type="text"
                  placeholder="Title"
                  value={entry.title}
                  onChange={(e) => setEntry((p) => ({ ...p, title: e.target.value }))}
                  required
                />
              </label>
              <label className="entry-field entry-field-desc">
                <span>Description (optional)</span>
                <input
                  type="text"
                  placeholder="Description"
                  value={entry.description}
                  onChange={(e) =>
                    setEntry((p) => ({ ...p, description: e.target.value }))
                  }
                />
              </label>
              <label className="entry-field">
                <span>Date</span>
                <input
                  type="date"
                  min={start}
                  max={maxEntryDate}
                  value={entry.date}
                  onChange={(e) => setEntry((p) => ({ ...p, date: e.target.value }))}
                />
              </label>
              <div className="entry-controls">
                <button type="submit" disabled={submitting}>
                  {submitting ? "Adding…" : "Add Entry"}
                </button>
              </div>
            </form>
            {error && <div className="error">{error}</div>}
          </section>
        </div>
      )}

      {activityExpanded && (
        <div
          className="activity-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Recent Activity"
          onClick={() => setActivityExpanded(false)}
        >
          <div
            className="activity-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="activity-modal-header">
              <h2>Recent Activity</h2>
              <button
                type="button"
                className="activity-close"
                aria-label="Close"
                onClick={() => setActivityExpanded(false)}
              >
                ✕
              </button>
            </div>
            <div className="activity-modal-body">
              {renderFullList()}
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div
          className="activity-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Edit Entry"
          onClick={() => setEditing(null)}
        >
          <div
            className="activity-modal edit-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="activity-modal-header">
              <h2>Edit Entry</h2>
              <button
                type="button"
                className="activity-close"
                aria-label="Close"
                onClick={() => setEditing(null)}
              >
                ✕
              </button>
            </div>
            <form className="edit-form" onSubmit={submitEdit}>
              <label className="edit-field">
                <span>Entry Type</span>
                <select
                  value={editing.kind}
                  onChange={(e) => {
                    const kind = e.target.value as EntryKind;
                    const list = categoriesForKind(
                      kind,
                      expenseNames,
                      incomeNames,
                      savingsNames
                    );
                    setEditing((p) =>
                      p
                        ? {
                            ...p,
                            kind,
                            category: list.includes(p.category)
                              ? p.category
                              : list[0] ?? "",
                          }
                        : p
                    );
                  }}
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                  <option value="set_aside">Savings &amp; Investments</option>
                </select>
              </label>
              <label className="edit-field">
                <span>Category</span>
                <select
                  value={editing.category}
                  onChange={(e) =>
                    setEditing((p) => (p ? { ...p, category: e.target.value } : p))
                  }
                  disabled={editCategories.length === 0}
                >
                  {editCategories.length === 0 ? (
                    <option value="">No categories</option>
                  ) : (
                    editCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="edit-field">
                <span>Amount</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={editing.amount}
                  onChange={(e) =>
                    setEditing((p) => (p ? { ...p, amount: e.target.value } : p))
                  }
                  required
                />
              </label>
              <label className="edit-field">
                <span>Entry Title</span>
                <input
                  type="text"
                  placeholder="Title"
                  value={editing.title}
                  onChange={(e) =>
                    setEditing((p) => (p ? { ...p, title: e.target.value } : p))
                  }
                  required
                />
              </label>
              <label className="edit-field">
                <span>Description (optional)</span>
                <input
                  type="text"
                  placeholder="Description"
                  value={editing.description}
                  onChange={(e) =>
                    setEditing((p) => (p ? { ...p, description: e.target.value } : p))
                  }
                />
              </label>
              <label className="edit-field">
                <span>Date</span>
                <input
                  type="date"
                  min={start}
                  max={maxEntryDate}
                  value={editing.date}
                  onChange={(e) =>
                    setEditing((p) => (p ? { ...p, date: e.target.value } : p))
                  }
                />
              </label>
              <div className="edit-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
                <button type="submit" disabled={editSubmitting}>
                  {editSubmitting ? "Saving…" : "Save"}
                </button>
              </div>
              {error && <div className="error">{error}</div>}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
