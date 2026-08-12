import { useEffect, useMemo, useRef, useState } from "react";
import CategoryList from "../components/CategoryList";
import { useCategories } from "../context/CategoriesContext";
import { getCategoryUsage } from "../lib/categories";
import { supabase } from "../lib/supabase";
import type { CategoryType } from "../types";
import { formatMonthYear, formatUSD } from "../lib/format";
import {
  fetchEffectiveBudgets,
  fetchStartingBalance,
  formatPeriodLabel,
  type Period,
} from "../lib/periods";

type DraftMap = Record<string, string>;

type CategoryDraft = {
  name: string;
  color: string;
};

type NewCategoryDraft = {
  name: string;
  color: string;
};

type DeletePrompt = {
  id: string;
  name: string;
  type: CategoryType;
  transactions: number;
  budgets: number;
  moveTo: string;
};

const CATEGORY_GROUPS: { type: CategoryType; label: string; hint: string }[] = [
  {
    type: "expense",
    label: "Spending",
    hint: "Categories you budget against. Each gets a percentage of your income below.",
  },
  {
    type: "income",
    label: "Income",
    hint: "Sources of incoming money. These are not budgeted.",
  },
  {
    type: "savings",
    label: "Savings & Investments",
    hint: "Accounts money is set aside into. Tracked separately from spending.",
  },
];

const DEFAULT_NEW_COLOR = "#d49b8d";

export default function Settings() {
  const {
    categories,
    budgetNames,
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
  const [rolledOverFrom, setRolledOverFrom] = useState<Period | null>(null);

  const incomeValue = Number(incomeDraft) || 0;

  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, CategoryDraft>>({});
  const [newDrafts, setNewDrafts] = useState<Record<CategoryType, NewCategoryDraft>>({
    expense: { name: "", color: DEFAULT_NEW_COLOR },
    income: { name: "", color: DEFAULT_NEW_COLOR },
    savings: { name: "", color: DEFAULT_NEW_COLOR },
  });
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
    () => budgetNames.slice().sort().join("\0"),
    [budgetNames]
  );

  async function loadBudgets(options?: { background?: boolean }) {
    const background = options?.background ?? false;
    if (!background) setLoading(true);
    setError(null);
    const [effective, incomeRes, starting] = await Promise.all([
      fetchEffectiveBudgets({ year, month }),
      supabase
        .from("monthly_income")
        .select("amount")
        .eq("year", year)
        .eq("month", month)
        .maybeSingle(),
      fetchStartingBalance({ year, month }),
    ]);
    const next: DraftMap = {};
    for (const n of budgetNames) {
      next[n] = String(Math.round(Number(effective.percentByCategory[n] ?? 0)));
    }
    setDraft(next);
    setRolledOverFrom(effective.rolledOverFrom);
    // Default to the month's starting balance (last month's ending balance)
    // until an income has been explicitly saved for this month.
    setIncomeDraft(
      String(incomeRes.data ? Number(incomeRes.data.amount) : starting)
    );
    budgetsLoadedOnce.current = true;
    if (!background) setLoading(false);
  }

  useEffect(() => {
    if (!categoriesLoading && budgetNames.length > 0) {
      loadBudgets({ background: budgetsLoadedOnce.current });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, categoriesLoading, categorySetKey]);

  const totalPercent = useMemo(
    () => budgetNames.reduce((s, c) => s + (Number(draft[c]) || 0), 0),
    [draft, budgetNames]
  );
  const overAllocated = totalPercent > 100;

  async function saveBudgets() {
    setSaving(true);
    setError(null);
    const rows = budgetNames.map((c) => ({
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
      // These percentages now belong to this month; nothing is rolled over anymore.
      setRolledOverFrom(null);
    }
  }

  function estimatedDollars(percentStr: string): number {
    return (Number(percentStr) || 0) * incomeValue / 100;
  }

  async function handleAddCategory(e: React.FormEvent, type: CategoryType) {
    e.preventDefault();
    const d = newDrafts[type];
    setCategoryBusy(`add:${type}`);
    setError(null);
    const err = await createCategory(d.name, d.color, type);
    setCategoryBusy(null);
    if (err) setError(err);
    else {
      setNewDrafts((p) => ({ ...p, [type]: { name: "", color: DEFAULT_NEW_COLOR } }));
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
    const target = categories.find((c) => c.id === id);
    const type = target?.type ?? "expense";
    const { usage, error: usageErr } = await getCategoryUsage(name);
    if (usageErr) {
      setError(usageErr);
      return;
    }
    const inUse = (usage?.transactions ?? 0) > 0 || (usage?.budgets ?? 0) > 0;
    if (inUse) {
      const others = categories.filter((c) => c.id !== id && c.type === type);
      if (others.length === 0) {
        setError(
          "At least one other category of the same type is required before deleting this one."
        );
        return;
      }
      setDeletePrompt({
        id,
        name,
        type,
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

  const showBudget = !categoriesLoading && budgetNames.length > 0;

  return (
    <div>
      <div className="page-title">
        <h1>Settings</h1>
        <span className="period">Budget for {formatMonthYear(year, month)}</span>
      </div>

      <section className="card">
        <h2>Categories</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Add, rename, recolor, drag to reorder, or remove categories in each group.
          Spending categories are budgeted; income sources and savings/investment
          accounts are tracked separately.
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
            {CATEGORY_GROUPS.map((group) => {
              const groupCategories = categories.filter((c) => c.type === group.type);
              const nd = newDrafts[group.type];
              return (
                <div className="category-group" key={group.type}>
                  <div className="category-group-heading">{group.label}</div>
                  <p className="muted category-group-hint">{group.hint}</p>
                  {groupCategories.length > 0 && (
                    <CategoryList
                      categories={groupCategories}
                      categoryDrafts={categoryDrafts}
                      categoryBusy={categoryBusy}
                      onDraftChange={(id, d) =>
                        setCategoryDrafts((p) => ({ ...p, [id]: d }))
                      }
                      onSave={handleSaveCategory}
                      onDelete={handleDeleteCategory}
                      onReorder={reorderCategoryList}
                      onError={setError}
                    />
                  )}
                  <form
                    className="category-add"
                    onSubmit={(e) => handleAddCategory(e, group.type)}
                  >
                    <input
                      type="color"
                      aria-label={`New ${group.label} category color`}
                      value={nd.color}
                      onChange={(e) =>
                        setNewDrafts((p) => ({
                          ...p,
                          [group.type]: { ...nd, color: e.target.value },
                        }))
                      }
                    />
                    <input
                      type="text"
                      placeholder={`New ${group.label.toLowerCase()} category`}
                      value={nd.name}
                      onChange={(e) =>
                        setNewDrafts((p) => ({
                          ...p,
                          [group.type]: { ...nd, name: e.target.value },
                        }))
                      }
                      required
                    />
                    <button type="submit" disabled={categoryBusy === `add:${group.type}`}>
                      {categoryBusy === `add:${group.type}` ? "Adding…" : "Add category"}
                    </button>
                  </form>
                </div>
              );
            })}
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
                      .filter((c) => c.id !== deletePrompt.id && c.type === deletePrompt.type)
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
            Set the income to budget against this month. Your category percentages
            carry over from month to month; the income figure defaults to your
            starting balance until you set it.
          </div>
        </div>

        <h2>Budget percentage by category</h2>
        {rolledOverFrom && (
          <p className="muted" style={{ marginTop: 0 }}>
            Carried over from {formatPeriodLabel(rolledOverFrom)}. Save to keep these
            for {formatMonthYear(year, month)}.
          </p>
        )}
        {!showBudget ? (
          <p className="muted">Loading…</p>
        ) : loading ? (
          <p className="muted">Loading budgets…</p>
        ) : (
          <div className="budget-table">
            {budgetNames.map((c) => {
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
                {100 - totalPercent}% unallocated — room for savings or buffer.
              </p>
            )}
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginTop: "0.5rem" }}>
              <button onClick={saveBudgets} disabled={saving}>
                {saving ? "Saving…" : "Save budget"}
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
        Budgets carry over each month until you change them. Dollar amounts update
        automatically as this month's income changes.
      </p>
    </div>
  );
}
