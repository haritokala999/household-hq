import { useEffect, useRef, useState, type ReactNode } from "react";

const baseClass = "rounded-md px-2 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2";

export function EntityActions({ onEdit, onDelete, deleteLabel = "Delete", label = "record", extra }: {
  onEdit?: () => void;
  onDelete: () => void;
  deleteLabel?: string;
  label?: string;
  extra?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) setOpen(false);
    }
    function handleKeys(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button[role=menuitem]") ?? [])];
      if (!items.length) return;
      event.preventDefault();
      const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
      const nextIndex = event.key === "Home" ? 0
        : event.key === "End" ? items.length - 1
          : event.key === "ArrowDown" ? (currentIndex + 1) % items.length
            : (currentIndex <= 0 ? items.length - 1 : currentIndex - 1);
      items[nextIndex].focus();
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", handleKeys);
    menuRef.current?.querySelector<HTMLButtonElement>("button[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", handleKeys);
    };
  }, [open]);

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  return <div ref={rootRef} className="relative flex shrink-0 items-center">
    {extra}
    <button ref={triggerRef} type="button" aria-label={`Actions for ${label}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((visible) => !visible)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-xl leading-none text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" title="Actions">⋯</button>
    {open && <div ref={menuRef} role="menu" aria-label={`Actions for ${label}`} className="absolute right-0 top-full z-30 mt-1 min-w-36 rounded-xl border border-slate-200 bg-white p-1.5 text-left shadow-xl">
      {onEdit && <button type="button" role="menuitem" onClick={() => choose(onEdit)} className={`${baseClass} block w-full px-3 py-2 text-left text-teal-800 hover:bg-teal-50 focus-visible:bg-teal-50 focus-visible:ring-teal-600`}>Edit</button>}
      <button type="button" role="menuitem" onClick={() => choose(onDelete)} className={`${baseClass} block w-full px-3 py-2 text-left text-red-700 hover:bg-red-50 focus-visible:bg-red-50 focus-visible:ring-red-500`}>{deleteLabel}</button>
    </div>}
  </div>;
}

export function ConfirmationDialog({ title, description, isPending, onCancel, onConfirm }: {
  title: string;
  description: string;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    function cancelOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !isPending) {
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
      if (!buttons?.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", cancelOnEscape);
    return () => document.removeEventListener("keydown", cancelOnEscape);
  }, [isPending, onCancel]);

  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isPending) onCancel(); }}>
    <section ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="delete-confirmation-title" aria-describedby="delete-confirmation-description" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
      <h2 id="delete-confirmation-title" className="text-lg font-bold text-slate-900">{title}</h2>
      <p id="delete-confirmation-description" className="mt-2 text-sm leading-6 text-slate-600">{description} This action may not be reversible.</p>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" autoFocus disabled={isPending} onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">Cancel</button>
        <button type="button" disabled={isPending} onClick={onConfirm} className="rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-wait disabled:opacity-60">{isPending ? "Deleting…" : "Delete"}</button>
      </div>
    </section>
  </div>;
}
