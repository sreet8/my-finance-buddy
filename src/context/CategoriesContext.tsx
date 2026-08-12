import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  addCategory,
  categoryColorMap,
  deleteCategory,
  fetchCategories,
  reorderCategories,
  seedDefaultCategories,
  updateCategory,
} from "../lib/categories";
import type { CategoryRow, CategoryType } from "../types";

type CategoriesContextValue = {
  categories: CategoryRow[];
  names: string[];
  expenseNames: string[];
  incomeNames: string[];
  savingsNames: string[];
  budgetNames: string[];
  typeByName: Record<string, CategoryType>;
  colors: Record<string, string>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createCategory: (
    name: string,
    color: string,
    type: CategoryType
  ) => Promise<string | null>;
  saveCategory: (
    id: string,
    oldName: string,
    name: string,
    color: string
  ) => Promise<string | null>;
  removeCategory: (id: string, name: string, moveToName?: string) => Promise<string | null>;
  reorderCategoryList: (orderedIds: string[]) => Promise<string | null>;
};

const CategoriesContext = createContext<CategoriesContextValue | null>(null);

export function CategoriesProvider({ children }: { children: ReactNode }) {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    let { data, error: err } = await fetchCategories();
    if (err) {
      setError(err);
      setLoading(false);
      return;
    }
    if (!data?.length) {
      const seedErr = await seedDefaultCategories();
      if (seedErr) {
        setError(seedErr);
        setLoading(false);
        return;
      }
      ({ data, error: err } = await fetchCategories());
      if (err) {
        setError(err);
        setLoading(false);
        return;
      }
    }
    setCategories(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const names = useMemo(() => categories.map((c) => c.name), [categories]);
  const namesOfType = useCallback(
    (type: CategoryType) =>
      categories.filter((c) => c.type === type).map((c) => c.name),
    [categories]
  );
  const expenseNames = useMemo(() => namesOfType("expense"), [namesOfType]);
  const incomeNames = useMemo(() => namesOfType("income"), [namesOfType]);
  const savingsNames = useMemo(() => namesOfType("savings"), [namesOfType]);
  // Categories that carry a budget percentage: spending plus savings, never income.
  const budgetNames = useMemo(
    () => categories.filter((c) => c.type !== "income").map((c) => c.name),
    [categories]
  );
  const typeByName = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.name, c.type])) as Record<string, CategoryType>,
    [categories]
  );
  const colors = useMemo(() => categoryColorMap(categories), [categories]);

  const createCategory = useCallback(
    async (name: string, color: string, type: CategoryType) => {
      const sameType = categories.filter((c) => c.type === type);
      const sortOrder =
        sameType.length === 0
          ? 0
          : Math.max(...sameType.map((c) => c.sort_order)) + 1;
      const { data, error: err } = await addCategory(name, color, sortOrder, type);
      if (err) return err;
      if (data) setCategories((prev) => [...prev, data]);
      return null;
    },
    [categories]
  );

  const saveCategory = useCallback(
    async (id: string, oldName: string, name: string, color: string) => {
      const updates: { name?: string; color?: string } = {};
      const row = categories.find((c) => c.id === id);
      if (!row) return "Category not found";
      if (name.trim() !== oldName) updates.name = name.trim();
      if (color !== row.color) updates.color = color;
      const err = await updateCategory(id, updates);
      if (err) return err;
      await refresh();
      return null;
    },
    [categories, refresh]
  );

  const removeCategory = useCallback(
    async (id: string, name: string, moveToName?: string) => {
      const err = await deleteCategory(id, name, moveToName);
      if (err) return err;
      setCategories((prev) => prev.filter((c) => c.id !== id));
      return null;
    },
    []
  );

  const reorderCategoryList = useCallback(async (orderedIds: string[]) => {
    const err = await reorderCategories(orderedIds);
    if (err) return err;
    const byId = new Map(categories.map((c) => [c.id, c]));
    setCategories(
      orderedIds
        .map((id, i) => {
          const row = byId.get(id);
          return row ? { ...row, sort_order: i } : null;
        })
        .filter((c): c is CategoryRow => c !== null)
    );
    return null;
  }, [categories]);

  const value: CategoriesContextValue = {
    categories,
    names,
    expenseNames,
    incomeNames,
    savingsNames,
    budgetNames,
    typeByName,
    colors,
    loading,
    error,
    refresh,
    createCategory,
    saveCategory,
    removeCategory,
    reorderCategoryList,
  };

  return (
    <CategoriesContext.Provider value={value}>{children}</CategoriesContext.Provider>
  );
}

export function useCategories(): CategoriesContextValue {
  const ctx = useContext(CategoriesContext);
  if (!ctx) throw new Error("useCategories must be used within CategoriesProvider");
  return ctx;
}
