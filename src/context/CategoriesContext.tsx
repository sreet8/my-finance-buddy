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
import type { CategoryRow } from "../types";

type CategoriesContextValue = {
  categories: CategoryRow[];
  names: string[];
  colors: Record<string, string>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createCategory: (name: string, color: string) => Promise<string | null>;
  saveCategory: (
    id: string,
    oldName: string,
    name: string,
    color: string
  ) => Promise<string | null>;
  removeCategory: (id: string, name: string, moveToName?: string) => Promise<string | null>;
  moveCategory: (id: string, direction: "up" | "down") => Promise<string | null>;
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
  const colors = useMemo(() => categoryColorMap(categories), [categories]);

  const createCategory = useCallback(
    async (name: string, color: string) => {
      const sortOrder =
        categories.length === 0
          ? 0
          : Math.max(...categories.map((c) => c.sort_order)) + 1;
      const { data, error: err } = await addCategory(name, color, sortOrder);
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

  const moveCategory = useCallback(
    async (id: string, direction: "up" | "down") => {
      const index = categories.findIndex((c) => c.id === id);
      if (index < 0) return "Category not found";
      const swapIndex = direction === "up" ? index - 1 : index + 1;
      if (swapIndex < 0 || swapIndex >= categories.length) return null;

      const reordered = [...categories];
      [reordered[index], reordered[swapIndex]] = [reordered[swapIndex], reordered[index]];
      const err = await reorderCategories(reordered.map((c) => c.id));
      if (err) return err;
      setCategories(
        reordered.map((c, i) => ({
          ...c,
          sort_order: i,
        }))
      );
      return null;
    },
    [categories]
  );

  const value: CategoriesContextValue = {
    categories,
    names,
    colors,
    loading,
    error,
    refresh,
    createCategory,
    saveCategory,
    removeCategory,
    moveCategory,
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
