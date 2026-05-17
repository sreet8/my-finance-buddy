import { useEffect, useMemo, useState } from "react";
import { useCategories } from "../context/CategoriesContext";
import { getCategoryUsage } from "../lib/categories";
import { supabase } from "../lib/supabase";
import { Budget } from "../types";
import { formatMonthYear, formatUSD, monthRange } from "../lib/format";

type DraftMap = Record<string, string>;

type CategoryDraft = {
  name: string;
  color: string;
};

type DeletePrompt = {
  id: string;
  name: string;
  transactions: number;
  budgets: number;
  moveTo: string;
};

export default function Settings() {
  const {
    categories,
    names,
    colors,
    loading: categoriesLoading,
    error: categoriesError,
    createCategory,
    saveCategory,
    removeCategory,
    moveCategory,
    refresh: refreshCategories,
  } = useCategories();

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const { start, end } = useMemo(() => monthRange(year, month), [year, month]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [monthIncome, setMonthIncome] = useState(0);
  const [draft, setDraft] = useState<DraftMap>({});

  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, CategoryDraft>>({});
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#d49b8d");
  const [categoryBusy, setCategoryBusy] = useState<string | null>(null);
  const [deletePrompt, setDeletePrompt] = useState<DeletePrompt | null>(null);

  useEffect(() => {
    const next: Record<string, CategoryDraft> = {};
    for (const c of categories) {
      next[c.id] = { name: c.name, color: c.color };
    }
    setCategoryDrafts(next);
  }, [categories]);

  async function loadBudgets() {
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
    const next: DraftMap = {};
    for (const n of names) next[n] = "0";
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
    if (!categoriesLoading && names.length > 0) loadBudgets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, categoriesLoading, names.join("|")]);

  const totalPercent = useMemo(
    () => names.reduce((s, c) => s + (Number(draft[c]) || 0), 0),
    [draft, names]
  );
  const overAllocated = totalPercent > 100;

  async function saveBudgets() {
    setSaving(true);
    setError(null);
    const rows = names.map((c) => ({
      year,
      month,
      category: c,
      percent: Math.min(100, Math.max(0, Number(draft[c]) || 0)),
    }));
    const { error: saveErr } = await supabase
      .from("budgets")
      .upsert(rows, { onConflict: "year,month,category" });
    setSaving(false);
    if (saveErr) setError(saveErr.message);
    else setSavedAt(new Date());
  }

  function estimatedDollars(percentStr: string): number {
    return (Number(percentStr) || 0) * monthIncome / 100;
  }

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    setCategoryBusy("add");
    setError(null);
    const err = await createCategory(newName, newColor);
    setCategoryBusy(null);
    if (err) setError(err);
    else {
      setNewName("");
      setNewColor("#d49b8d");
    }
  }

  async function handleSaveCategory(id: string, originalName: string) {
    const d = categoryDrafts[id];
    if (!d) return;
    setCategoryBusy(id);
    setError(null);
    const err = await saveCategory(id, originalName, d.name, d.color);
    setCategoryBusy(null);
    if (err) setError(err);
    else await loadBudgets();
  }

  async function handleDeleteCategory(id: string, name: string) {
    setError(null);
    const { usage, error: usageErr } = await getCategoryUsage(name);
    if (usageErr) {
      setError(usageErr);
      return;
    }
    const inUse = (usage?.transactions ?? 0) > 0 || (usage?.budgets ?? 0) > 0;
    if (inUse) {
      const others = categories.filter((c) => c.id !== id);
      if (others.length === 0) {
        setError("At least one other category is required before deleting this one.");
        return;
      }
      setDeletePrompt({
        id,
        name,
        transactions: usage?.transactions ?? 0,
        budgets: usage?.budgets ?? 0,
        moveTo: others[0].name,
      });
      return;
    }
    if (!confirm(`Delete category "${name}"?`)) return;
    setCategoryBusy(id);
    const err = await removeCategory(id, name);
    setCategoryBusy(null);
    if (err) setError(err);
    else await loadBudgets();
  }

  async function confirmDeleteWithMove() {
    if (!deletePrompt) return;
    setCategoryBusy(deletePrompt.id);
    setError(null);
    const err = await removeCategory(deletePrompt.id, deletePrompt.name, deletePrompt.moveTo);
    setCategoryBusy(null);
    if (err) setError(err);
    else {
      setDeletePrompt(null);
      await loadBudgets();
    }
  }

  const showBudget = !categoriesLoading && names.length > 0;

  return (
    <div>
      <div className="page-title">
        <h1>Settings</h1>
        <span className="period">Budget for {formatMonthYear(year, month)}</span>
      </div>

      <section className="card">
        <h2>Categories</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Add, rename, recolor, reorder, or remove expense categories. Changes are saved to your database.
        </p>
        {categoriesLoading ? (
          <p className="muted">Loading categories…</p>
        ) : categoriesError ? (
          <div className="error">
            {categoriesError}
            <button className="secondary" style={{ marginLeft: "0.75rem" }} onClick={refreshCategories}>
              Retry
            </button>
          </div>
        ) : (
          <>
            <div className="category-list">
              {categories.map((c, index) => {
                const d = categoryDrafts[c.id] ?? { name: c.name, color: c.color };
                return (
                  <div className="category-row" key={c.id}>
                    <div className="category-reorder">
                      <button
                        type="button"
                        className="secondary icon-btn"
                        aria-label={`Move ${c.name} up`}
                        disabled={categoryBusy === c.id || index === 0}
                        onClick={async () => {
                          setCategoryBusy(c.id);
                          setError(null);
                          const err = await moveCategory(c.id, "up");
                          setCategoryBusy(null);
                          if (err) setError(err);
                        }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="secondary icon-btn"
                        aria-label={`Move ${c.name} down`}
                        disabled={categoryBusy === c.id || index === categories.length - 1}
                        onClick={async () => {
                          setCategoryBusy(c.id);
                          setError(null);
                          const err = await moveCategory(c.id, "down");
                          setCategoryBusy(null);
                          if (err) setError(err);
                        }}
                      >
                        ↓
                      </button>
                    </div>
                    <input
                      type="color"
                      aria-label={`Color for ${c.name}`}
                      value={d.color}
                      onChange={(e) =>
                        setCategoryDrafts((p) => ({
                          ...p,
                          [c.id]: { ...d, color: e.target.value },
                        }))
                      }
                    />
                    <input
                      type="text"
                      value={d.name}
                      onChange={(e) =>
                        setCategoryDrafts((p) => ({
                          ...p,
                          [c.id]: { ...d, name: e.target.value },
                        }))
                      }
                    />
                    <button
                      className="secondary"
                      disabled={categoryBusy === c.id}
                      onClick={() => handleSaveCategory(c.id, c.name)}
                    >
                      {categoryBusy === c.id ? "Saving…" : "Save"}
                    </button>
                    <button
                      className="secondary"
                      disabled={categoryBusy === c.id || categories.length <= 1}
                      onClick={() => handleDeleteCategory(c.id, c.name)}
                      title={categories.length <= 1 ? "At least one category is required" : undefined}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
            <form className="category-add" onSubmit={handleAddCategory}>
              <input
                type="color"
                aria-label="New category color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
              />
              <input
                type="text"
                placeholder="New category name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
              />
              <button type="submit" disabled={categoryBusy === "add"}>
                {categoryBusy === "add" ? "Adding…" : "Add category"}
              </button>
            </form>
            {deletePrompt && (
              <div className="delete-prompt">
                <p>
                  <strong>{deletePrompt.name}</strong> has {deletePrompt.transactions} transaction
                  {deletePrompt.transactions === 1 ? "" : "s"}
                  {deletePrompt.budgets > 0
                    ? ` and ${deletePrompt.budgets} budget row${deletePrompt.budgets === 1 ? "" : "s"}`
                    : ""}
                  . Move them to:
                </p>
                <div className="delete-prompt-actions">
                  <select
                    value={deletePrompt.moveTo}
                    onChange={(e) =>
                      setDeletePrompt((p) => (p ? { ...p, moveTo: e.target.value } : p))
                    }
                  >
                    {categories
                      .filter((c) => c.id !== deletePrompt.id)
                      .map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                  <button
                    disabled={categoryBusy === deletePrompt.id}
                    onClick={confirmDeleteWithMove}
                  >
                    {categoryBusy === deletePrompt.id ? "Deleting…" : "Move & delete"}
                  </button>
                  <button
                    className="secondary"
                    disabled={categoryBusy === deletePrompt.id}
                    onClick={() => setDeletePrompt(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <div className="spacer" />

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
        {!showBudget ? (
          <p className="muted">Loading…</p>
        ) : loading ? (
          <p className="muted">Loading budgets…</p>
        ) : (
          <div className="budget-table">
            {names.map((c) => (
              <div className="budget-row" key={c}>
                <span className="swatch" style={{ background: colors[c] ?? "#c9a98b" }} />
                <label>{c}</label>
                <span className="percent-suffix">
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    value={draft[c] ?? "0"}
                    onChange={(e) => setDraft((p) => ({ ...p, [c]: e.target.value }))}
                  />
                </span>
                <span className="estimate">≈ {formatUSD(estimatedDollars(draft[c] ?? "0"))}</span>
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
              <p className="muted">
                {100 - totalPercent}% unallocated — room for savings or buffer.
              </p>
            )}
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginTop: "0.5rem" }}>
              <button onClick={saveBudgets} disabled={saving}>
                {saving ? "Saving…" : "Save budget"}
              </button>
              <button className="secondary" onClick={loadBudgets} disabled={saving}>
                Revert
              </button>
              {savedAt && <span className="muted">Saved {savedAt.toLocaleTimeString()}</span>}
            </div>
          </div>
        )}
      </section>

      {error && <div className="error">{error}</div>}

      <div className="spacer" />
      <p className="muted">
        Budgets are per month. Dollar amounts update automatically as this month's income changes.
      </p>
    </div>
  );
}