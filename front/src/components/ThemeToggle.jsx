import { Monitor, Moon, Sun } from "lucide-react";
import { useThemeStore } from "../store/themeStore";

/** In click order: Auto (follow the OS) → Light → Dark → Auto. */
const OPTIONS = [
  { value: "auto", label: "Auto", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

/**
 * Theme button — each click moves to the next theme (CR-022: Auto → Light →
 * Dark → Auto, no menu). The icon shows the current one. Reads + writes the
 * persisted theme store, which also sets the `.dark` class on <html>. Drop it
 * anywhere (topbar, public pages…).
 */
const ThemeToggle = ({ size = 18 }) => {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const index = Math.max(
    0,
    OPTIONS.findIndex((o) => o.value === mode),
  );
  const current = OPTIONS[index];
  const next = OPTIONS[(index + 1) % OPTIONS.length];
  const CurrentIcon = current.icon;
  const hint = `Theme: ${current.label} — click for ${next.label}`;

  return (
    <button
      type="button"
      onClick={() => setMode(next.value)}
      aria-label={hint}
      title={hint}
      className="icon-btn w-9 h-9 shrink-0"
    >
      <CurrentIcon size={size} />
    </button>
  );
};

export default ThemeToggle;
