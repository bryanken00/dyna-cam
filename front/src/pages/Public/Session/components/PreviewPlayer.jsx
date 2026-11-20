import { useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { blockedByPage, nativeHlsOnly } from "../../../../utils/liveLink";

/**
 * CR-029: plays a stretch of the game before it's saved — the recorder box's
 * finished (VOD) replay playlist, which starts at the stretch (EXT-X-START).
 * Playback stops at the end of the stretch (the box's last segment can run a
 * second or two past it); Play again goes back to its start. Cam 1 | Cam 2 on
 * a two-camera court. ⚠️ The link carries a secret `sig` — never log it.
 *
 * Props: `{ preview: { hlsUrl, cameras? }, lengthSeconds, onClose }`
 */
const PreviewPlayer = ({ preview, lengthSeconds, onClose }) => {
  const videoRef = useRef(null);
  const startRef = useRef(null);
  const twoCameras = (preview?.cameras?.length ?? 0) > 1;
  const [camera, setCamera] = useState(1);
  const [state, setState] = useState("loading"); // loading · playing · done · error
  const url =
    preview?.cameras?.find((link) => link.camera === camera)?.hlsUrl ?? preview?.hlsUrl ?? null;
  const blocked = url ? blockedByPage(url) : false;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url || blocked) return undefined;
    setState("loading");
    startRef.current = null;

    const onPlaying = () => {
      // Where the stretch starts in this playlist (EXT-X-START put us there)
      if (startRef.current === null) startRef.current = video.currentTime;
      setState("playing");
    };
    const onTime = () => {
      if (startRef.current !== null && video.currentTime >= startRef.current + lengthSeconds) {
        video.pause();
        setState("done");
      }
    };
    const onEnded = () => setState("done");
    const onError = () => setState("error");
    video.addEventListener("playing", onPlaying);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("ended", onEnded);

    let hls = null;
    let cancelled = false;
    if (nativeHlsOnly(video)) {
      video.addEventListener("error", onError);
      video.src = url;
      video.play().catch(() => {});
    } else {
      import("hls.js")
        .then(({ default: Hls }) => {
          if (cancelled) return;
          if (!Hls.isSupported()) {
            onError();
            return;
          }
          hls = new Hls({ lowLatencyMode: false });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            // ⚠️ `data` can hold the signed link — never log it
            if (data.fatal) onError();
          });
          hls.loadSource(url);
          hls.attachMedia(video);
          video.play().catch(() => {});
        })
        .catch(onError);
    }

    return () => {
      cancelled = true;
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onError);
      if (hls) hls.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [url, blocked, lengthSeconds]);

  const playAgain = () => {
    const video = videoRef.current;
    if (!video || startRef.current === null) return;
    video.currentTime = startRef.current;
    video.play().catch(() => {});
  };

  const message = blocked
    ? "The preview can't play on this secure page until the court's recorder has its certificate. Ask the front desk."
    : state === "error"
      ? "Couldn't play the preview. It plays on the venue Wi-Fi, and the court's recorder may need an update. You can still save."
      : null;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span
          className="font-semibold"
          style={{ fontSize: 13.5, color: "var(--color-text-dark)" }}
        >
          Preview
        </span>
        <div className="flex items-center gap-1">
          {twoCameras &&
            [1, 2].map((n) => (
              <Button
                key={n}
                type="button"
                size="sm"
                variant={camera === n ? "default" : "outline"}
                className="h-8"
                onClick={() => setCamera(n)}
                aria-pressed={camera === n}
              >
                Cam {n}
              </Button>
            ))}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onClose}
            aria-label="Close the preview"
          >
            <X />
          </Button>
        </div>
      </div>

      {message ? (
        <p
          className="m-0 p-3"
          role="status"
          style={{
            fontSize: 13,
            color: "var(--color-text-secondary)",
            background: "var(--color-surface-sunken)",
            border: "1px solid var(--color-line)",
            borderRadius: 12,
          }}
        >
          {message}
        </p>
      ) : (
        // Black in both themes on purpose (letterboxing), like the live view
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video
            ref={videoRef}
            playsInline
            controls
            muted
            className="w-full block"
            style={{ aspectRatio: "16 / 9" }}
          />
          {state === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <Loader2 className="size-6 animate-spin text-white" />
            </div>
          )}
          {state === "done" && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <Button type="button" variant="outline" onClick={playAgain}>
                <RotateCcw />
                Play again
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PreviewPlayer;
