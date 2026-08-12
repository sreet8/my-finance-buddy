export const UNUSED_COLOR = "#4a6fa5";

/** How a category is used: budgeted spending, an income source, or savings/investments. */
export type CategoryType = "expense" | "income" | "savings";

export type CategoryRow = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  type: CategoryType;
};

export type Budget = {
  id: string;
  year: number;
  month: number;
  category: string;
  percent: number;
};

export type Transaction = {
  id: string;
  kind: "income" | "expense";
  amount: number;
  category: string | null;
  title: string | null;
  description: string | null;
  occurred_on: string;
  created_at?: string;
};
