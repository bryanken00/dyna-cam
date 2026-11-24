import { useEffect, useState } from "react";
import { Loader2, Minus, Play, Plus, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import PreviewPlayer from "./PreviewPlayer";

/** Handle steps, the shortest save (the API's minimum) and the first pick. */
const STEP_SECONDS = 5;
const MIN_SECONDS = 60;
const DEFAULT_SECONDS = 120;

/** 75 → "1 min 15 s", 120 → "2 min". */
const lengthText = (seconds) => {
  const m = Math.floor(seconds / 60);
  const r = Math.round(seconds % 60);
  return r ? `${m} min ${r} s` : `${m} min`;
};

/** 125 → "2:05", 3725 → "1:02:05" — a point in the game. */
const clockOf = (total) => {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

/** What to say when a save or a preview is refused or can't be sent. */
const errorText = (error, fallback) => {
  if (!error) return null;
  if (!error.response) return "Can't reach DGSports — check your connection and try again.";
  return error.response?.data?.message || fallback;
};

/** Re-render every second while `on` (the played time ticks). */
const useNow = (on) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [on]);
  return now;
};

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

const cardStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

/**
 * Two range inputs on one track: only their thumbs take the pointer, so each
 * handle drags on its own. Thumbs in the link colour with a surface ring.
 */
const thumb =
  "pointer-events-none absolute inset-0 w-full h-9 m-0 appearance-none bg-transparent " +
  "[&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-track]:bg-transparent " +
  "[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none " +
  "[&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:rounded-full " +
  "[&::-webkit-slider-thumb]:bg-(--color-link) [&::-webkit-slider-thumb]:border-[3px] " +
  "[&::-webkit-slider-thumb]:border-(--color-surface) [&::-webkit-slider-thumb]:cursor-grab " +
  "[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-5 " +
  "[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-(--color-link) " +
  "[&::-moz-range-thumb]:border-[3px] [&::-moz-range-thumb]:border-(--color-surface) " +
  "[&::-moz-range-thumb]:cursor-grab disabled:opacity-50";

/** One end's fine control: "Start 3:53 [−][+]". */
const Nudge = ({ label, value, onLess, onMore, lessOff, moreOff, disabled }) => (
  <div
    className="flex items-center justify-between gap-2 px-3 py-2"
    style={{ border: "1px solid var(--color-line)", borderRadius: 12 }}
  >
    <div className="min-w-0">
      <div style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>{label}</div>
      <div
        className="font-semibold tabular-nums"
        style={{ fontSize: 15, color: "var(--color-text-dark)" }}
      >
        {value}
      </div>
    </div>
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 rounded-full"
        onClick={onLess}
        disabled={disabled || lessOff}
        aria-label={`${label} ${STEP_SECONDS} seconds earlier`}
      >
        <Minus />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 rounded-full"
        onClick={onMore}
        disabled={disabled || moreOff}
        aria-label={`${label} ${STEP_SECONDS} seconds later`}
      >
        <Plus />
      </Button>
    </div>
  </div>
);

/**
 * CR-029: save any stretch of the game so far — the court device's save
 * (CR-013, on this page since CR-025) with two handles. The track is the game
 * from 0:00 to now; drag the start and the end (5-second steps, at least a
 * minute), or nudge each with − / +. The end stays on "now" and follows the
 * game until it's moved; the start sits 2 minutes before the end until it's
 * moved. Preview plays the stretch from the court's recorder before saving
 * it; Save sends it ({ fromSeconds, toSeconds }). In the first minute the
 * picker shows greyed out, counting down (CR-028).
 *
 * Played time ticks from the API's `playedSeconds` plus the time since that
 * answer (`since`), never from this phone's clock against an API time.
 */
const SaveStretch = ({ capture, since, save, preview }) => {
  const now = useNow(Boolean(capture?.available));
  const played =
    Number(capture?.playedSeconds || 0) +
    Math.max(0, Math.floor((now - (since || now)) / 1000));
  const maxSaves = capture?.maxPerGame ?? 5;
  const used = capture?.used ?? 0;
  const full = used >= maxSaves;
  const canSave = Boolean(capture?.available) && played >= MIN_SECONDS;

  // null = the default: the end on "now", the start 2 minutes before the end
  const [pickedTo, setPickedTo] = useState(null);
  const [pickedFrom, setPickedFrom] = useState(null);
  const atNow = pickedTo === null;
  const to = atNow ? played : clamp(pickedTo, MIN_SECONDS, played);
  const from = clamp(pickedFrom ?? to - DEFAULT_SECONDS, 0, Math.max(0, to - MIN_SECONDS));
  const length = to - from;

  // The preview shown, and the stretch it was made for
  const [shown, setShown] = useState(null);
  const closePreview = () => {
    setShown(null);
    preview.reset();
  };

  const moveFrom = (value) => {
    setPickedFrom(clamp(value, 0, to - MIN_SECONDS));
    if (shown) closePreview();
  };
  const moveTo = (value) => {
    // Within a step of now: back on "now", following the game
    if (value >= played - STEP_SECONDS) setPickedTo(null);
    else setPickedTo(clamp(value, from + MIN_SECONDS, played));
    if (shown) closePreview();
  };

  const onPreview = () => {
    preview.reset();
    preview.mutate(
      { from, to },
      { onSuccess: (response) => setShown(response?.data?.preview || null) },
    );
  };

  const onSave = () => {
    if (save.isPending) return;
    save.reset();
    save.mutate({ fromSeconds: from, toSeconds: to });
  };

  const waitText = `Available in ${clockOf(Math.max(1, MIN_SECONDS - played))}`;
  const error =
    errorText(save.error, "Couldn't save — try again.") ??
    errorText(preview.error, "Couldn't get the preview — try again.");
  const pct = (seconds) => (played > 0 ? `${(seconds / played) * 100}%` : "0%");

  return (
    <div className="mt-4 p-4" style={cardStyle}>
      <div className="flex items-center gap-2">
        <Scissors className="w-4 h-4 shrink-0" style={{ color: "var(--color-link)" }} />
        <span
          className="font-semibold flex-1"
          style={{ fontSize: 15.5, color: "var(--color-text-dark)" }}
        >
          Save a part of your game
        </span>
        <span
          style={{ fontSize: 13, color: full ? "var(--color-error)" : "var(--color-text-muted)" }}
          aria-label={`${used} of ${maxSaves} saves used`}
        >
          {used} of {maxSaves} saves
        </span>
      </div>

      {!capture?.available ? (
        <p className="m-0 mt-2" style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
          Saving is available while the game is recording.
        </p>
      ) : (
        <>
          {/* What's picked */}
          <div className="text-center mt-3" style={{ opacity: canSave ? 1 : 0.5 }}>
            <div
              className="font-bold"
              style={{ fontSize: 26, letterSpacing: "-0.5px", color: "var(--color-text-dark)" }}
            >
              {canSave ? lengthText(length) : lengthText(MIN_SECONDS)}
            </div>
            <div className="tabular-nums" style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
              {canSave
                ? `${clockOf(from)} – ${atNow ? `now (${clockOf(to)})` : clockOf(to)}`
                : `${clockOf(played)} played`}
            </div>
          </div>

          {/* The game so far, with the picked stretch lit between the handles */}
          <div className="relative h-9 mt-2">
            <div
              className="absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 rounded-full"
              style={{ background: "var(--color-surface-sunken)", border: "1px solid var(--color-line)" }}
            />
            {canSave && (
              <div
                className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full"
                style={{ left: pct(from), width: pct(length), background: "var(--color-link)" }}
              />
            )}
            <input
              type="range"
              className={thumb}
              // The start's thumb on top when both sit at the far end
              style={{ zIndex: from > played - MIN_SECONDS * 1.5 ? 3 : 2 }}
              min={0}
              max={Math.max(1, played)}
              step={STEP_SECONDS}
              value={canSave ? from : 0}
              onChange={(e) => moveFrom(Number(e.target.value))}
              disabled={!canSave}
              aria-label="Start of the save"
              aria-valuetext={clockOf(from)}
            />
            <input
              type="range"
              className={thumb}
              style={{ zIndex: 2 }}
              min={0}
              max={Math.max(1, played)}
              step={STEP_SECONDS}
              value={canSave ? to : Math.max(1, played)}
              onChange={(e) => moveTo(Number(e.target.value))}
              disabled={!canSave}
              aria-label="End of the save"
              aria-valuetext={atNow ? "now" : clockOf(to)}
            />
          </div>
          <div className="flex justify-between" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
            <span>0:00</span>
            <span>{clockOf(played)} now</span>
          </div>

          {/* Fine control of each end */}
          <div className="grid grid-cols-2 gap-2 mt-3">
            <Nudge
              label="Start"
              value={canSave ? clockOf(from) : "–"}
              onLess={() => moveFrom(from - STEP_SECONDS)}
              onMore={() => moveFrom(from + STEP_SECONDS)}
              lessOff={from <= 0}
              moreOff={length <= MIN_SECONDS}
              disabled={!canSave}
            />
            <Nudge
              label="End"
              value={canSave ? (atNow ? "now" : clockOf(to)) : "–"}
              onLess={() => moveTo(to - STEP_SECONDS)}
              onMore={() => moveTo(to + STEP_SECONDS)}
              lessOff={length <= MIN_SECONDS}
              moreOff={atNow}
              disabled={!canSave}
            />
          </div>

          {shown && (
            <PreviewPlayer preview={shown} lengthSeconds={length} onClose={closePreview} />
          )}

          <div className="grid grid-cols-2 gap-2 mt-4">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-12"
              onClick={onPreview}
              disabled={!canSave || preview.isPending}
            >
              {preview.isPending ? <Loader2 className="animate-spin" /> : <Play />}
              {shown ? "Preview again" : "Preview"}
            </Button>
            <Button
              type="button"
              size="lg"
              className="h-12"
              onClick={onSave}
              disabled={!canSave || save.isPending || full}
            >
              {save.isPending ? (
                <Loader2 className="animate-spin" />
              ) : canSave ? (
                `Save ${lengthText(length)}`
              ) : (
                waitText
              )}
            </Button>
          </div>
          <p
            className="m-0 mt-2 text-center"
            role={error ? "alert" : undefined}
            style={{
              fontSize: 12.5,
              color: error ? "var(--color-error)" : "var(--color-text-muted)",
            }}
          >
            {error ??
              (!canSave
                ? "You can save once the first minute has been played."
                : full
                  ? `That's ${maxSaves} saves — delete one under Your saves to save another.`
                  : save.isSuccess
                    ? "Saving — it'll appear under Your saves in a few minutes."
                    : "Its own video, on this page in a few minutes. Saves are made one at a time.")}
          </p>
        </>
      )}
    </div>
  );
};

export default SaveStretch;
