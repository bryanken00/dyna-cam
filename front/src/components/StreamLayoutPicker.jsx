import { STREAM_LAYOUTS, STREAM_LAYOUT_LABEL } from "../utils/dynaCam";

const NOTE = { CAM1: "copied", CAM2: "copied", STACKED: "re-encoded" };

/** One camera's picture in the sketch. */
const Frame = ({ n, active }) => (
  <div
    className="flex items-center justify-center font-mono"
    style={{
      width: 44,
      aspectRatio: "16 / 9",
      borderRadius: 3,
      fontSize: 10,
      fontWeight: 600,
      border: "1px solid var(--color-line)",
      background: active ? "var(--color-surface)" : "var(--color-surface-sunken)",
      color: active ? "var(--color-text-dark)" : "var(--color-text-muted)",
    }}
  >
    {n}
  </div>
);

/** The small layout sketch: one 16:9 frame, or Cam 1 above Cam 2. */
const Sketch = ({ layout, active }) => (
  <div className="flex flex-col items-center gap-0.5" aria-hidden="true">
    {layout === "STACKED" ? (
      <>
        <Frame n="1" active={active} />
        <Frame n="2" active={active} />
      </>
    ) : (
      <Frame n={layout === "CAM2" ? "2" : "1"} active={active} />
    )}
  </div>
);

/**
 * Cam 1 / Cam 2 / Both (stacked) for a live stream on a two-camera court,
 * each with a small sketch. Controlled: `value` is "CAM1" | "CAM2" | "STACKED".
 *
 * @param {string} value
 * @param {(layout: string) => void} onChange
 * @param {boolean} [disabled]
 * @param {boolean} [showNotes]  "copied" / "re-encoded" under each label
 */
const StreamLayoutPicker = ({ value, onChange, disabled = false, showNotes = true }) => (
  <div
    role="radiogroup"
    aria-label="Stream layout"
    className="grid grid-cols-3 gap-1 p-1"
    style={{
      background: "var(--color-surface-sunken)",
      border: "1px solid var(--color-line)",
      borderRadius: 12,
    }}
  >
    {STREAM_LAYOUTS.map((layout) => {
      const active = value === layout;
      return (
        <button
          key={layout}
          type="button"
          role="radio"
          aria-checked={active}
          disabled={disabled}
          onClick={() => onChange?.(layout)}
          className="flex flex-col items-center justify-start gap-2 px-1.5 py-2.5 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            minHeight: 96,
            borderRadius: 9,
            border: "none",
            cursor: disabled ? undefined : "pointer",
            background: active ? "var(--color-surface)" : "transparent",
            boxShadow: active ? "0 1px 2px rgba(0,0,0,.06)" : "none",
          }}
        >
          <div className="flex items-center" style={{ minHeight: 52 }}>
            <Sketch layout={layout} active={active} />
          </div>
          <span className="text-center leading-tight">
            <span
              className="block"
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: active ? "var(--color-text-dark)" : "var(--color-text-secondary)",
              }}
            >
              {STREAM_LAYOUT_LABEL[layout]}
            </span>
            {showNotes && (
              <span
                className="block mt-0.5"
                style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}
              >
                {NOTE[layout]}
              </span>
            )}
          </span>
        </button>
      );
    })}
  </div>
);

export default StreamLayoutPicker;
