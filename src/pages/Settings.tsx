import { useEffect, useMemo, useRef, useState } from "react";
import CategoryList from "../components/CategoryList";
import { useCategories } from "../context/CategoriesContext";
import { getCategoryUsage } from "../lib/categories";
import { supabase } from "../lib/supabase";
import { Budget } from "../types";
import { formatMonthYear, formatUSD } from "../lib/format";
import { fetchStartingBalance } from "../lib/periods";

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
    reorderCategoryList,
    refresh: refreshCategories,
  } = useCategories();

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const [loading, setLoading] = useState(true);
  const budgetsLoadedOnce = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [incomeDraft, setIncomeDraft] = useState("0");
  const [draft, setDraft] = useState<DraftMap>({});

  const incomeValue = Number(incomeDraft) || 0;

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

  const categorySetKey = useMemo(
    () => [...names].sort().join("\0"),
    [names]
  );

  async function loadBudgets(options?: { background?: boolean }) {
    const background = options?.background ?? false;
    if (!background) setLoading(true);
    setError(null);
    const [budgetsRes, incomeRes, starting] = await Promise.all([
      supabase.from("budgets").select("*").eq("year", year).eq("month", month),
      supabase
        .from("monthly_income")
        .select("amount")
        .eq("year", year)
        .eq("month", month)
        .maybeSingle(),
      fetchStartingBalance({ year, month }),
    ]);
    if (budgetsRes.error) {
      setError(budgetsRes.error.message);
      if (!background) setLoading(false);
      return;
    }
    const next: DraftMap = {};
    for (const n of names) next[n] = "0";
    for (const row of (budgetsRes.data ?? []) as Budget[]) {
      if (names.includes(row.category)) {
        next[row.category] = String(Math.round(Number(row.percent)));
      }
    }
    setDraft(next);
    // Default to the month's starting balance (last month's ending balance)
    // until an income has been explicitly saved for this month.
    setIncomeDraft(
      String(incomeRes.data ? Number(incomeRes.data.amount) : starting)
    );
    budgetsLoadedOnce.current = true;
    if (!background) setLoading(false);
  }

  useEffect(() => {
    if (!categoriesLoading && names.length > 0) {
      loadBudgets({ background: budgetsLoadedOnce.current });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, categoriesLoading, categorySetKey]);

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
    const [budgetRes, incomeRes] = await Promise.all([
      supabase.from("budgets").upsert(rows, { onConflict: "year,month,category" }),
      supabase
        .from("monthly_income")
        .upsert({ year, month, amount: incomeValue }, { onConflict: "year,month" }),
    ]);
    setSaving(false);
    if (budgetRes.error || incomeRes.error) {
      setError(budgetRes.error?.message ?? incomeRes.error?.message ?? "Save failed");
    } else {
      setSavedAt(new Date());
    }
  }

  function estimatedDollars(percentStr: string): number {
    return (Number(percentStr) || 0) * incomeValue / 100;
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
    else await loadBudgets({ background: true });
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
    else await loadBudgets({ background: true });
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
      await loadBudgets({ background: true });
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
          Add, rename, recolor, drag to reorder, or remove categories. Names with Savings
          or Investment in them are tracked under Savings & Investments on the Dashboard, not
          as expenses.
        </p>
        {categoriesLoading ? (
          <p className="muted">Loading categoriesâ€¦</p>
        ) : categoriesError ? (
          <div className="error">
            {categoriesError}
            <button className="secondary" style={{ marginLeft: "0.75rem" }} onClick={refreshCategories}>
              Retry
            </button>
          </div>
        ) : (
          <>
            <CategoryList
              categories={categories}
              categoryDrafts={categoryDrafts}
              categoryBusy={categoryBusy}
              onDraftChange={(id, draft) =>
                setCategoryDrafts((p) => ({ ...p, [id]: draft }))
              }
              onSave={handleSaveCategory}
              onDelete={handleDeleteCategory}
              onReorder={reorderCategoryList}
              onError={setError}
            />
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
                {categoryBusy === "add" ? "Addingâ€¦" : "Add category"}
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
                    {categoryBusy === deletePrompt.id ? "Deletingâ€¦" : "Move & delete"}
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
          <div className="income-edit">
            <label
              className="muted"
              htmlFor="month-income"
              style={{ fontSize: "0.85rem" }}
            >
              This month's income
            </label>
            <div className="income-input-wrap">
              <span className="income-currency">$</span>
              <input
                id="month-income"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={incomeDraft}
                onChange={(e) => setIncomeDraft(e.target.value)}
                onBlur={() =>
                  setIncomeDraft((v) =>
                    v === "" ? "0" : String(Math.max(0, Number(v) || 0))
                  )
                }
              />
            </div>
          </div>
          <div className="muted" style={{ textAlign: "right", maxWidth: 280 }}>
            Set the income to budget against this month. It resets each month and
            saves together with your budget.
          </div>
        </div>

        <h2>Budget percentage by category</h2>
        {!showBudget ? (
          <p className="muted">Loadingâ€¦</p>
        ) : loading ? (
          <p className="muted">Loading budgetsâ€¦</p>
        ) : (
          <div className="budget-table">
            {names.map((c) => {
              const raw = draft[c] ?? "0";
              return (
                <div className="budget-row" key={c}>
                  <span className="swatch" style={{ background: colors[c] ?? "#c9a98b" }} />
                  <label>{c}</label>
                  <div className="budget-alloc">
                    <span className="percent-suffix">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        aria-label={`${c} budget percent`}
                        value={raw}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "" || /^\d{0,3}$/.test(v)) {
                            setDraft((p) => ({
                              ...p,
                              [c]: v === "" ? "" : String(Math.min(100, parseInt(v, 10))),
                            }));
                          }
                        }}
                        onBlur={() => {
                          setDraft((p) => ({
                            ...p,
                            [c]:
                              p[c] === "" || p[c] === undefined
                                ? "0"
                                : String(Math.min(100, Number(p[c]) || 0)),
                          }));
                        }}
                      />
                    </span>
                    <span className="budget-dollar">
                      {formatUSD(estimatedDollars(raw === "" ? "0" : raw))}
                    </span>
                  </div>
                </div>
              );
            })}
            <div className="budget-row budget-row-total">
              <span />
              <strong>
                Total <span className="muted">({totalPercent}%)</span>
              </strong>
              <div className="budget-alloc">
                <span className="budget-alloc-spacer" aria-hidden />
                <strong className="budget-dollar">
                  {formatUSD(totalPercent * incomeValue / 100)}
                </strong>
              </div>
            </div>
            {overAllocated && (
              <div className="warn">
                Total exceeds 100%. Trim some categories so the budget fits your income.
              </div>
            )}
            {!overAllocated && totalPercent < 100 && (
              <p className="muted">
                {100 - totalPercent}% unallocated â€” room for savings or buffer.
              </p>
            )}
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginTop: "0.5rem" }}>
              <button onClick={saveBudgets} disabled={saving}>
                {saving ? "Savingâ€¦" : "Save budget"}
              </button>
              <button
                className="secondary"
                onClick={() => loadBudgets({ background: true })}
                disabled={saving}
              >
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
