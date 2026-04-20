export const CATEGORIES = [
  "Housing",
  "Food",
  "Transport",
  "Utilities",
  "Entertainment",
  "Shopping",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_COLORS: Record<Category, string> = {
  Housing: "#c4a7cc",
  Food: "#f5b88f",
  Transport: "#a8c9a6",
  Utilities: "#b8a5cc",
  Entertainment: "#eeb0c0",
  Shopping: "#a5c2d0",
  Other: "#c9a98b",
};

export const UNUSED_COLOR = "#eaddd0";

export type Budget = {
  id: string;
  year: number;
  month: number;
  category: Category;
  percent: number;
};

export type Transaction = {
  id: string;
  kind: "income" | "expense";
  amount: number;
  category: Category | null;
  note: string | null;
  occurred_on: string;
};

export type SavingsContribution = {
  id: string;
  amount: number;
  note: string | null;
  occurred_on: string;
};
