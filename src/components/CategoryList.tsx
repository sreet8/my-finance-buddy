import { useState } from "react";
import type { CategoryRow } from "../types";

type CategoryDraft = { name: string; color: string };

type Props = {
  categories: CategoryRow[];
  categoryDrafts: Record<string, CategoryDraft>;
  categoryBusy: string | null;
  onDraftChange: (id: string, draft: CategoryDraft) => void;
  onSave: (id: string, originalName: string) => void;
  onDelete: (id: string, name: string) => void;
  onReorder: (orderedIds: string[]) => Promise<string | null>;
  onError: (message: string) => void;
};

function reorderRows(rows: CategoryRow[], dragId: string, targetId: string): CategoryRow[] {
  const from = rows.findIndex((c) => c.id === dragId);
  const to = rows.findIndex((c) => c.id === targetId);
  if (from < 0 || to < 0 || from === to) return rows;
  const next = [...rows];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export default function CategoryList({
  categories,
  categoryDrafts,
  categoryBusy,
  onDraftChange,
  onSave,
  onDelete,
  onReorder,
  onError,
}: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  async function finishReorder(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    const reordered = reorderRows(categories, draggedId, targetId);
    setReordering(true);
    const err = await onReorder(reordered.map((c) => c.id));
    setReordering(false);
    if (err) onError(err);
  }

  return (
    <div className="category-list">
      {categories.map((c) => {
        const d = categoryDrafts[c.id] ?? { name: c.name, color: c.color };
        const isDragging = dragId === c.id;
        const isOver = overId === c.id && dragId !== c.id;
        return (
          <div
            key={c.id}
            className={`category-row${isDragging ? " dragging" : ""}${isOver ? " drag-over" : ""}`}
            draggable={!reordering && categoryBusy !== c.id}
            onDragStart={(e) => {
              setDragId(c.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", c.id);
            }}
            onDragEnd={() => {
              setDragId(null);
              setOverId(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dragId && dragId !== c.id) setOverId(c.id);
            }}
            onDragLeave={() => {
              if (overId === c.id) setOverId(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const dragged = dragId ?? e.dataTransfer.getData("text/plain");
              setDragId(null);
              setOverId(null);
              if (dragged) void finishReorder(dragged, c.id);
            }}
          >
            <span className="category-drag-handle" title="Drag to reorder" aria-hidden>
              ⠿
            </span>
            <input
              type="color"
              aria-label={`Color for ${c.name}`}
              value={d.color}
              onChange={(e) => onDraftChange(c.id, { ...d, color: e.target.value })}
            />
            <input
              type="text"
              value={d.name}
              onChange={(e) => onDraftChange(c.id, { ...d, name: e.target.value })}
            />
            <button
              className="secondary"
              disabled={categoryBusy === c.id || reordering}
              onClick={() => onSave(c.id, c.name)}
            >
              {categoryBusy === c.id ? "Saving…" : "Save"}
            </button>
            <button
              className="secondary"
              disabled={categoryBusy === c.id || categories.length <= 1 || reordering}
              onClick={() => onDelete(c.id, c.name)}
              title={categories.length <= 1 ? "At least one category is required" : undefined}
            >
              Remove
            </button>
          </div>
        );
      })}
    </div>
  );
}
