import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Budget, CATEGORIES, CATEGORY_COLORS, Category } from "../types";
import { formatMonthYear, formatUSD, monthRange } from "../lib/format";

type DraftMap = Record<Category, string>;

export default function Settings() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const { start, end } = useMemo(() => monthRange(year, month), [year, month]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [monthIncome, setMonthIncome] = useState(0);
  const [draft, setDraft] = useState<DraftMap>({
    Housing: "0", Food: "0", Transport: "0", Utilities: "0",
    Entertainment: "0", Shopping: "0", Other: "0",
  });

  async function load() {
    setLoading(true);
    setError(null);
    const [budgetsRes, incomeRes] = await Promise.all([
      supabase.from("budgets").select("*").eq("year", year).eq("month", month),
      supabase
        .from("transactions")
        .select("amount")
        .eq("kind", "income")
        .gte("occurred_on", start)
        .lte("occurred_on", end),
    ]);
    if (budgetsRes.error || incomeRes.error) {
      setError(budgetsRes.error?.message ?? incomeRes.error?.message ?? "Load failed");
      setLoading(false);
      return;
    }
    const next: DraftMap = {
      Housing: "0", Food: "0", Transport: "0", Utilities: "0",
      Entertainment: "0", Shopping: "0", Other: "0",
    };
    for (const row of (budgetsRes.data ?? []) as Budget[]) {
      next[row.category] = String(Number(row.percent));
    }
    setDraft(next);
    setMonthIncome(
      (incomeRes.data ?? []).reduce((s: number, r: { amount: number }) => s + Number(r.amount), 0)
    );
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  const totalPercent = useMemo(
    () => CATEGORIES.reduce((s, c) => s + (Number(draft[c]) || 0), 0),
    [draft]
  );
  const overAllocated = totalPercent > 100;

  async function save() {
    setSaving(true);
    setError(null);
    const rows = CATEGORIES.map((c) => ({
      year,
      month,
      category: c,
      percent: Math.min(100, Math.max(0, Number(draft[c]) || 0)),
    }));
    const { error } = await supabase
      .from("budgets")
      .upsert(rows, { onConflict: "year,month,category" });
    setSaving(false);
    if (error) setError(error.message);
    else setSavedAt(new Date());
  }

  function estimatedDollars(percentStr: string): number {
    return (Number(percentStr) || 0) * monthIncome / 100;
  }

  return (
    <div>
      <div className="page-title">
        <h1>Settings</h1>
        <span className="period">Budget for {formatMonthYear(year, month)}</span>
      </div>

      <section className="card">
        <div className="income-banner">
          <div>
            <div className="muted" style={{ fontSize: "0.85rem" }}>
              This month's income
            </div>
            <div className="value">{formatUSD(monthIncome)}</div>
          </div>
          <div className="muted" style={{ textAlign: "right", maxWidth: 280 }}>
            Budget is a % of income. Add income entries on the Dashboard to change this.
          </div>
        </div>

        <h2>Budget percentage by category</h2>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="budget-table">
            {CATEGORIES.map((c) => (
              <div className="budget-row" key={c}>
                <span className="swatch" style={{ background: CATEGORY_COLORS[c] }} />
                <label>{c}</label>
                <span className="percent-suffix">
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    value={draft[c]}
                    onChange={(e) => setDraft((p) => ({ ...p, [c]: e.target.value }))}
                  />
                </span>
                <span className="estimate">≈ {formatUSD(estimatedDollars(draft[c]))}</span>
              </div>
            ))}
            <div className="budget-row">
              <span />
              <strong>Total</strong>
              <strong style={{ textAlign: "right" }}>{totalPercent}%</strong>
              <strong className="estimate">
                ≈ {formatUSD(totalPercent * monthIncome / 100)}
              </strong>
            </div>
            {overAllocated && (
              <div className="warn">
                Total exceeds 100%. Trim some categories so the budget fits your income.
              </div>
            )}
            {!overAllocated && totalPercent < 100 && (
              <div className="muted">
                {100 - totalPercent}% unallocated — room for savings or buffer.
              </div>
            )}
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginTop: "0.5rem" }}>
              <button onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button className="secondary" onClick={load} disabled={saving}>
                Revert
              </button>
              {savedAt && <span className="muted">Saved {savedAt.toLocaleTimeString()}</span>}
            </div>
            {error && <div className="error">{error}</div>}
          </div>
        )}
      </section>

      <div className="spacer" />
      <p className="muted">
        Budgets are per month. Dollar amounts update automatically as this month's income changes.
      </p>
    </div>
  );
}
