import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_COLORS } from "../lib/types";

interface Props {
  epicKey: string;
  color: string;
  onChange: (color: string) => void;
}

interface MenuPos {
  top: number;
  left: number;
}

export function EpicColorPicker({ epicKey, color, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) {
      setPos(null);
      return;
    }
    const place = () => {
      const btn = btnRef.current;
      const menu = menuRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const menuW = menu?.offsetWidth || 176;
      const menuH = menu?.offsetHeight || 180;
      const gap = 6;
      let top = r.bottom + gap;
      let left = r.left;
      if (top + menuH > window.innerHeight - 8) {
        top = Math.max(8, r.top - menuH - gap);
      }
      if (left + menuW > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - menuW - 8);
      }
      setPos({ top, left });
    };
    place();
    // Re-measure after paint once menu has real size
    requestAnimationFrame(place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node | null;
      if (btnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="pg-epic-color" data-epic-color={epicKey}>
      <button
        ref={btnRef}
        type="button"
        className="pg-bullet pg-bullet-btn"
        style={{ background: color }}
        title="Change epic color"
        aria-label={`Change color for ${epicKey}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      />
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="pg-epic-color-menu"
            data-epic-color-menu={epicKey}
            style={
              pos
                ? { top: pos.top, left: pos.left, visibility: "visible" }
                : { top: 0, left: 0, visibility: "hidden" }
            }
          >
            <div className="pg-assign-hint">Epic color</div>
            <div className="pg-epic-color-grid">
              {DEFAULT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`pg-epic-swatch${
                    c.toLowerCase() === color.toLowerCase() ? " selected" : ""
                  }`}
                  style={{ background: c }}
                  title={c}
                  aria-label={c}
                  onClick={() => {
                    onChange(c);
                    setOpen(false);
                  }}
                />
              ))}
            </div>
            <label className="pg-epic-color-custom">
              Custom
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#17A0E0"}
                onChange={(e) => onChange(e.target.value)}
              />
            </label>
          </div>,
          document.body,
        )}
    </div>
  );
}
