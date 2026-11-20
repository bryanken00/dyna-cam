import { useEffect, useState } from "react";
import { Loader2, Minus, Plus, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Steps of 15 seconds, from 1 minute (the API's minimum) up to the time played. */
const STEP_SECONDS = 15;
const MIN_SECONDS = 60;
/** What the player picks first: the last 2 minutes (or less, early in the game). */
const DEFAULT_SECONDS = 120;

/** 75 → "1 min 15 s", 120 → "2 min". */
const lengthText = (seconds) => {
  const m = Math.floor(seconds / 60);
  const r = seconds % 60;
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

/** What to say when a save is refused or can't be sent. */
const saveErrorText = (error) => {
  if (!error) return null;
  if (!error.response)
    return "Can't reach Dyna Cam — check your connection and try again.";
  return error.response?.data?.message || "Couldn't save — try again.";
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

const cardStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

const roundButton = "h-11 w-11 rounded-full shrink-0";

/**
 * CR-025: "Save the last …" on the game page — the court device's control
 * (CR-013). Pick how much of the end of the game to keep (15-second steps
 * from 1 minute up to the time played) and Save: it becomes its own video
 * under "Your saves", made by the recorder box one at a time. Up to the
 * game's limit; deleting a save stays on the court device.
 *
 * Played time ticks from the API's `playedSeconds` plus the time since that
 * answer (`since`), never from this phone's clock against an API time.
 */
const SaveLastMinutes = ({ capture, since, save }) => {
  const now = useNow(Boolean(capture?.available));
  const played =
    Number(capture?.playedSeconds || 0) +
    Math.max(0, Math.floor((now - (since || now)) / 1000));
  // Whole 15-second steps of the time played
  const maxSeconds = Math.floor(played / STEP_SECONDS) * STEP_SECONDS;
  const [chosen, setChosen] = useState(DEFAULT_SECONDS);
  const seconds = Math.min(
    Math.max(MIN_SECONDS, chosen),
    Math.max(MIN_SECONDS, maxSeconds),
  );
  const maxSaves = capture?.maxPerGame ?? 5;
  const used = capture?.used ?? 0;
  const full = used >= maxSaves;
  const canSave = Boolean(capture?.available) && maxSeconds >= MIN_SECONDS;
  const error = saveErrorText(save.error);

  const step = (delta) =>
    setChosen(Math.min(maxSeconds, Math.max(MIN_SECONDS, seconds + delta)));

  const onSave = () => {
    if (save.isPending) return;
    save.reset();
    save.mutate(seconds);
  };

  const muted = { fontSize: 12.5, color: "var(--color-text-muted)" };

  return (
    <div className="mt-4 p-4" style={cardStyle}>
      <div className="flex items-center gap-2">
        <Scissors
          className="w-4 h-4 shrink-0"
          style={{ color: "var(--color-link)" }}
        />
        <span
          className="font-semibold flex-1"
          style={{ fontSize: 15.5, color: "var(--color-text-dark)" }}
        >
          Save the last…
        </span>
        <span
          style={{
            fontSize: 13,
            color: full ? "var(--color-error)" : "var(--color-text-muted)",
          }}
          aria-label={`${used} of ${maxSaves} saves used`}
        >
          {used} of {maxSaves} saves
        </span>
      </div>

      {canSave ? (
        <>
          <div className="flex items-center justify-between gap-3 mt-3">
            <Button
              variant="outline"
              size="icon"
              className={roundButton}
              onClick={() => step(-STEP_SECONDS)}
              disabled={seconds <= MIN_SECONDS}
              aria-label="15 seconds less"
            >
              <Minus />
            </Button>
            <div className="text-center">
              <div
                className="font-bold"
                style={{
                  fontSize: 26,
                  letterSpacing: "-0.5px",
                  color: "var(--color-text-dark)",
                }}
              >
                {lengthText(seconds)}
              </div>
              <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                {clockOf(Math.max(0, played - seconds))} – {clockOf(played)}
              </div>
            </div>
            <Button
              variant="outline"
              size="icon"
              className={roundButton}
              onClick={() => step(STEP_SECONDS)}
              disabled={seconds >= maxSeconds}
              aria-label="15 seconds more"
            >
              <Plus />
            </Button>
          </div>

          {/* The game so far: further left = more of it saved */}
          <input
            type="range"
            className="w-full mt-3 cursor-pointer"
            style={{ accentColor: "var(--color-link)", direction: "rtl" }}
            min={MIN_SECONDS}
            max={Math.max(MIN_SECONDS, maxSeconds)}
            step={STEP_SECONDS}
            value={seconds}
            onChange={(e) => setChosen(Number(e.target.value))}
            aria-label="How much of the game to save"
            aria-valuetext={`The last ${lengthText(seconds)}`}
          />
          <div className="flex justify-between" style={muted}>
            <span>0:00</span>
            <span>{clockOf(played)} now</span>
          </div>

          <Button
            size="lg"
            className="h-12 w-full mt-4"
            onClick={onSave}
            disabled={save.isPending || full}
          >
            {save.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              `Save ${lengthText(seconds)}`
            )}
          </Button>
          <p
            className="m-0 mt-2 text-center"
            role={error ? "alert" : undefined}
            style={{
              fontSize: 12.5,
              color: error ? "var(--color-error)" : "var(--color-text-muted)",
            }}
          >
            {error ??
              (full
                ? `That's ${maxSaves} saves — this game can't take another.`
                : save.isSuccess
                  ? "Saving — it'll appear under Your saves in a few minutes."
                  : "Its own video, on this page in a few minutes. Saves are made one at a time.")}
          </p>
        </>
      ) : (
        <p
          className="m-0 mt-2"
          style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}
        >
          {capture?.available
            ? "You can save once the first minute has been played."
            : "Saving is available while the game is recording."}
        </p>
      )}
    </div>
  );
};

export default SaveLastMinutes;
