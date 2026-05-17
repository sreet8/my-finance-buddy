export const UNUSED_COLOR = "#eaddd0";

export type CategoryRow = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
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
  note: string | null;
  occurred_on: string;
};

export type SavingsContribution = {
  id: string;
  amount: number;
  note: string | null;
  occurred_on: string;
};
