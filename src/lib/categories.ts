import { supabase } from "./supabase";
import type { CategoryRow } from "../types";

export const DEFAULT_CATEGORIES: Pick<CategoryRow, "name" | "color" | "sort_order">[] = [
  { name: "Housing", color: "#c4a7cc", sort_order: 0 },
  { name: "Food", color: "#f5b88f", sort_order: 1 },
  { name: "Transport", color: "#a8c9a6", sort_order: 2 },
  { name: "Utilities", color: "#b8a5cc", sort_order: 3 },
  { name: "Entertainment", color: "#eeb0c0", sort_order: 4 },
  { name: "Shopping", color: "#a5c2d0", sort_order: 5 },
  { name: "Other", color: "#c9a98b", sort_order: 6 },
];

export async function fetchCategories(): Promise<{
  data: CategoryRow[] | null;
  error: string | null;
}> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, color, sort_order")
    .order("sort_order", { ascending: true });
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []) as CategoryRow[], error: null };
}

export async function seedDefaultCategories(): Promise<string | null> {
  const { error } = await supabase.from("categories").insert(DEFAULT_CATEGORIES);
  return error?.message ?? null;
}

export async function addCategory(
  name: string,
  color: string,
  sortOrder: number
): Promise<{ data: CategoryRow | null; error: string | null }> {
  const trimmed = name.trim();
  if (!trimmed) return { data: null, error: "Category name is required" };
  const { data, error } = await supabase
    .from("categories")
    .insert({ name: trimmed, color, sort_order: sortOrder })
    .select("id, name, color, sort_order")
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as CategoryRow, error: null };
}

export async function updateCategory(
  id: string,
  updates: { name?: string; color?: string }
): Promise<string | null> {
  const { data: existing, error: fetchErr } = await supabase
    .from("categories")
    .select("name")
    .eq("id", id)
    .single();
  if (fetchErr) return fetchErr.message;

  const oldName = existing.name as string;
  const newName = updates.name?.trim();
  const patch: { name?: string; color?: string } = {};
  if (updates.color !== undefined) patch.color = updates.color;
  if (newName !== undefined) {
    if (!newName) return "Category name is required";
    patch.name = newName;
  }

  if (Object.keys(patch).length === 0) return null;

  const { error: updateErr } = await supabase.from("categories").update(patch).eq("id", id);
  if (updateErr) return updateErr.message;

  if (newName && newName !== oldName) {
    const [{ error: bErr }, { error: tErr }] = await Promise.all([
      supabase.from("budgets").update({ category: newName }).eq("category", oldName),
      supabase.from("transactions").update({ category: newName }).eq("category", oldName),
    ]);
    if (bErr) return bErr.message;
    if (tErr) return tErr.message;
  }

  return null;
}

export type CategoryUsage = {
  transactions: number;
  budgets: number;
};

export async function getCategoryUsage(name: string): Promise<{
  usage: CategoryUsage | null;
  error: string | null;
}> {
  const [tx, budgets] = await Promise.all([
    supabase.from("transactions").select("id", { count: "exact", head: true }).eq("category", name),
    supabase.from("budgets").select("id", { count: "exact", head: true }).eq("category", name),
  ]);
  if (tx.error) return { usage: null, error: tx.error.message };
  if (budgets.error) return { usage: null, error: budgets.error.message };
  return {
    usage: { transactions: tx.count ?? 0, budgets: budgets.count ?? 0 },
    error: null,
  };
}

export async function reassignCategoryData(
  fromName: string,
  toName: string
): Promise<string | null> {
  if (fromName === toName) return "Choose a different category to move data into.";

  const { error: txErr } = await supabase
    .from("transactions")
    .update({ category: toName })
    .eq("category", fromName);
  if (txErr) return txErr.message;

  const { data: oldBudgets, error: fetchErr } = await supabase
    .from("budgets")
    .select("id, year, month, percent")
    .eq("category", fromName);
  if (fetchErr) return fetchErr.message;

  for (const row of oldBudgets ?? []) {
    const { data: target, error: targetErr } = await supabase
      .from("budgets")
      .select("id, percent")
      .eq("year", row.year)
      .eq("month", row.month)
      .eq("category", toName)
      .maybeSingle();
    if (targetErr) return targetErr.message;

    if (target) {
      const merged = Math.min(100, Number(target.percent) + Number(row.percent));
      const { error: mergeErr } = await supabase
        .from("budgets")
        .update({ percent: merged })
        .eq("id", target.id);
      if (mergeErr) return mergeErr.message;
      const { error: delErr } = await supabase.from("budgets").delete().eq("id", row.id);
      if (delErr) return delErr.message;
    } else {
      const { error: moveErr } = await supabase
        .from("budgets")
        .update({ category: toName })
        .eq("id", row.id);
      if (moveErr) return moveErr.message;
    }
  }

  return null;
}

export async function reorderCategories(orderedIds: string[]): Promise<string | null> {
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from("categories").update({ sort_order: index }).eq("id", id)
    )
  );
  const failed = results.find((r) => r.error);
  return failed?.error?.message ?? null;
}

export async function deleteCategory(
  id: string,
  name: string,
  moveToName?: string
): Promise<string | null> {
  const { usage, error: usageErr } = await getCategoryUsage(name);
  if (usageErr) return usageErr;
  const inUse = (usage?.transactions ?? 0) > 0 || (usage?.budgets ?? 0) > 0;

  if (inUse) {
    if (!moveToName) {
      return "This category has existing data. Choose another category to move it to.";
    }
    const reassignErr = await reassignCategoryData(name, moveToName);
    if (reassignErr) return reassignErr;
  }

  const { error } = await supabase.from("categories").delete().eq("id", id);
  return error?.message ?? null;
}

export function categoryColorMap(rows: CategoryRow[]): Record<string, string> {
  return Object.fromEntries(rows.map((c) => [c.name, c.color]));
}
