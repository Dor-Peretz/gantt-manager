import { useRef } from "react";

type Axis = "x" | "y";

/**
 * Pointer-drag resize helper. `sign` flips direction (e.g. -1 when dragging
 * the bottom dock upward should increase height).
 */
export function useDragResize(
  axis: Axis,
  onChange: (next: number) => void,
  opts: { min: number; max: number; sign?: number } = { min: 0, max: 9999 },
) {
  const startRef = useRef({ pointer: 0, value: 0 });
  const valueRef = useRef(0);
  const sign = opts.sign ?? 1;

  function begin(e: React.PointerEvent, current: number) {
    e.preventDefault();
    e.stopPropagation();
    const pointer = axis === "x" ? e.clientX : e.clientY;
    startRef.current = { pointer, value: current };
    valueRef.current = current;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    document.body.classList.add(axis === "x" ? "pg-resizing-x" : "pg-resizing-y");

    function onMove(ev: PointerEvent) {
      const p = axis === "x" ? ev.clientX : ev.clientY;
      const delta = (p - startRef.current.pointer) * sign;
      const next = Math.min(opts.max, Math.max(opts.min, startRef.current.value + delta));
      valueRef.current = next;
      onChange(next);
    }
    function onUp() {
      document.body.classList.remove("pg-resizing-x", "pg-resizing-y");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return { begin };
}
