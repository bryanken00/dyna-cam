import { useEffect, useRef, useState } from "react";
import {
  ChevronsRight,
  Loader2,
  RotateCcw,
  Video,
  Volume2,
  VolumeX,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  liveExpiryMs,
  liveIdentity,
  liveUrlFor,
} from "../../../../utils/liveLink";

/** After a playback error, try the same link again this often. */
const RETRY_MS = 15000;
/** Swap to a fresh link this long before the playing one expires. */
const RENEW_BEFORE_MS = 2 * 60 * 1000;
/** How long a live link works once signed (the API's LIVE_LINK_MINUTES). */
const LINK_LIFETIME_MS = 15 * 60 * 1000;
/** CR-014: each ⟲ goes back this far, up to REWIND_MAX_SECONDS (the box lists about a minute). */
const REWIND_STEP_SECONDS = 10;
const REWIND_MAX_SECONDS = 50;

/**
 * The link to play, kept STABLE across polls. The game page polls every 10 s
 * and each answer carries a freshly signed link to the same stream; handing
 * each one to the player would restart the video. It changes only when the
 * stream changes (other camera, the box moved), the playing link is about to
 * expire, or the link appears / goes away.
 */
const useStableLink = (url) => {
  const [link, setLink] = useState(null);
  const [seenUrl, setSeenUrl] = useState(null);
  // Adjust while rendering when the polled link changes (no effect needed)
  if (url !== seenUrl) {
    setSeenUrl(url);
    const next = url
      ? { url, identity: liveIdentity(url), expiresMs: liveExpiryMs(url) }
      : null;
    // Still good when the new link outlives it by less than its renew margin
    // (each link lives LINK_LIFETIME_MS from when it was signed)
    const stillGood =
      link &&
      next &&
      (link.expiresMs == null ||
        next.expiresMs == null ||
        next.expiresMs - link.expiresMs < LINK_LIFETIME_MS - RENEW_BEFORE_MS);
    if (!next || !link || link.identity !== next.identity || !stillGood) {
      setLink(next);
    }
  }
  return link;
};

/**
 * A plain-HTTP box link can't play on an HTTPS page (the browser blocks it as
 * mixed content) — the box needs its certificate (CERT_PATH) for that.
 */
const blockedByPage = (url) =>
  window.location.protocol === "https:" && String(url).startsWith("http:");

/**
 * True only where hls.js can't run (no Media Source — older iPhones), so the
 * browser's own HLS is the one way to play. Not `canPlayType()` alone: Edge
 * and Chrome on Windows answer "maybe" for HLS and then fail the box's stream
 * (BUG-005), so hls.js goes first wherever it works.
 */
const nativeHlsOnly = (video) =>
  !("MediaSource" in window) &&
  !("ManagedMediaSource" in window) &&
  Boolean(video.canPlayType("application/vnd.apple.mpegurl"));

/**
 * BUG-006: the box numbers the live playlist's discontinuities from the epoch
 * second (`#EXT-X-DISCONTINUITY-SEQUENCE:1795176505`). hls.js keeps
 * per-discontinuity state in arrays indexed by that number, so each array is
 * ~1.8 billion entries long and every playlist reload / fragment froze the
 * page for seconds. This playlist loader rebases the number to count from 0
 * for one player (the first value it sees is 0) — the same breaks, small
 * numbers. Any box works with it; none needs an update.
 */
const rebasedPlaylistLoader = (Hls) => {
  let base = null;
  const rebase = (text) =>
    text.replace(/^#EXT-X-DISCONTINUITY-SEQUENCE:(\d+)/m, (_match, n) => {
      if (base === null) base = Number(n);
      return `#EXT-X-DISCONTINUITY-SEQUENCE:${Math.max(0, Number(n) - base)}`;
    });
  return class extends Hls.DefaultConfig.loader {
    load(context, config, callbacks) {
      super.load(context, config, {
        ...callbacks,
        onSuccess: (response, stats, ctx, networkDetails) => {
          if (typeof response.data === "string") {
            response.data = rebase(response.data);
          }
          callbacks.onSuccess(response, stats, ctx, networkDetails);
        },
      });
    }
  };
};

/**
 * Plays `link` in `videoRef`: hls.js, loaded on first use, wherever Media
 * Source exists (Chrome, Edge, Firefox, Safari); the browser's own HLS only
 * where it doesn't (older iPhones). Returns the player's state and `reload()`
 * (back to the live edge, or a retry).
 */
const useHlsPlayer = (videoRef, link) => {
  const [state, setState] = useState("idle"); // idle · loading · playing · error
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !link || blockedByPage(link.url)) {
      setState("idle");
      return undefined;
    }
    setState("loading");
    const onPlaying = () => setState("playing");
    const onError = () => setState("error");
    video.addEventListener("playing", onPlaying);

    let hls = null;
    let cancelled = false;
    if (nativeHlsOnly(video)) {
      // No Media Source: the browser plays HLS itself — no hls.js download
      video.addEventListener("error", onError);
      video.src = link.url;
      video.play().catch(() => {});
    } else {
      // hls.js is loaded only here, so the game page stays light otherwise
      import("hls.js")
        .then(({ default: Hls }) => {
          if (cancelled) return;
          if (!Hls.isSupported()) {
            onError();
            return;
          }
          hls = new Hls({
            lowLatencyMode: false,
            liveSyncDurationCount: 3,
            // BUG-006: small discontinuity numbers, or hls.js freezes the page
            pLoader: rebasedPlaylistLoader(Hls),
          });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            // ⚠️ `data` can hold the signed link — never log it
            if (data.fatal) onError();
          });
          hls.loadSource(link.url);
          hls.attachMedia(video);
          video.play().catch(() => {});
        })
        .catch(onError);
    }

    return () => {
      cancelled = true;
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", onError);
      if (hls) hls.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [videoRef, link, attempt]);

  // After an error, retry the same link every so often
  useEffect(() => {
    if (state !== "error" || !link) return undefined;
    const id = setInterval(() => setAttempt((n) => n + 1), RETRY_MS);
    return () => clearInterval(id);
  }, [state, link]);

  return { state, reload: () => setAttempt((n) => n + 1) };
};

/**
 * CR-025: the court's live video on the game page — what the court device
 * shows (PLAN-002 §5.4), straight from the venue's recorder box over the
 * venue Wi-Fi, about 5 s behind. Muted at first, with a sound toggle; Cam 1 |
 * Cam 2 on a two-camera court (CR-007); ⟲ 10 s and Back to live (CR-014).
 * None of it touches the recording. Off the venue Wi-Fi (or the box is
 * offline) a calm panel says so and the page goes on working.
 *
 * The video surface is black in both themes on purpose (letterboxing), with
 * dark scrim chips over it (`bg-black/60`, like the dialog overlay).
 */
const LivePanel = ({ live }) => {
  const videoRef = useRef(null);
  const twoCameras = (live?.cameras?.length ?? 0) > 1;
  const [camera, setCamera] = useState(1);
  const link = useStableLink(liveUrlFor(live, twoCameras ? camera : null));
  const { state, reload } = useHlsPlayer(videoRef, link);
  const [muted, setMuted] = useState(true);
  const [behind, setBehind] = useState(0);

  // A new link (camera switch, renewed) starts at the live edge
  const [behindLink, setBehindLink] = useState(link);
  if (behindLink !== link) {
    setBehindLink(link);
    setBehind(0);
  }

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  const canPlay = Boolean(link) && !blockedByPage(link.url);
  const showVideo = canPlay && state !== "error";
  const cameraName = twoCameras ? `Cam ${camera}` : null;

  const rewind = () => {
    const video = videoRef.current;
    if (!video || behind >= REWIND_MAX_SECONDS) return;
    video.currentTime = Math.max(0, video.currentTime - REWIND_STEP_SECONDS);
    video.play().catch(() => {});
    setBehind((b) => Math.min(REWIND_MAX_SECONDS, b + REWIND_STEP_SECONDS));
  };
  const goLive = () => {
    setBehind(0);
    // Reloading the live playlist is the dependable way back to its edge
    reload();
  };

  return (
    <div className="mt-4">
      {twoCameras && (
        <div
          className="grid grid-cols-2 gap-2 mb-2"
          role="tablist"
          aria-label="Live camera"
        >
          {[1, 2].map((n) => (
            <Button
              key={n}
              role="tab"
              aria-selected={camera === n}
              variant={camera === n ? "default" : "outline"}
              className="h-10"
              onClick={() => setCamera(n)}
            >
              <Video />
              Cam {n}
            </Button>
          ))}
        </div>
      )}

      <div
        className={`relative overflow-hidden ${showVideo ? "bg-black" : ""}`}
        style={{
          aspectRatio: "16 / 9",
          borderRadius: "var(--radius-card)",
          border: "1px solid var(--color-line)",
          ...(showVideo ? {} : { background: "var(--color-surface)" }),
        }}
      >
        {/* Always mounted so the player keeps its element across polls */}
        <video
          ref={videoRef}
          muted
          autoPlay
          playsInline
          aria-label={
            cameraName
              ? `Live video of the court, ${cameraName}`
              : "Live video of the court"
          }
          className="w-full h-full block"
          style={{
            objectFit: "contain",
            display: showVideo ? "block" : "none",
          }}
        />

        {showVideo && (
          <>
            {state !== "playing" && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-white" />
              </div>
            )}
            <span
              className="absolute left-3 top-3 inline-flex items-center gap-1.5 px-2.5 py-1 font-semibold uppercase bg-black/60 text-white"
              style={{
                borderRadius: 999,
                fontSize: 11,
                letterSpacing: "0.08em",
              }}
            >
              {behind === 0 && (
                <span
                  className="inline-block"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: "var(--color-error)",
                  }}
                />
              )}
              {behind > 0
                ? `${behind} s behind${cameraName ? ` · ${cameraName}` : ""}`
                : cameraName
                  ? `Live · ${cameraName}`
                  : "Live"}
            </span>
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? "Turn sound on" : "Turn sound off"}
              className="absolute bottom-3 right-3 inline-flex items-center justify-center cursor-pointer bg-black/60 text-white"
              style={{ width: 44, height: 44, borderRadius: 999 }}
            >
              {muted ? (
                <VolumeX className="w-5 h-5" />
              ) : (
                <Volume2 className="w-5 h-5" />
              )}
            </button>
          </>
        )}

        {!showVideo && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <Wifi
              className="w-6 h-6"
              style={{ color: "var(--color-text-muted)" }}
            />
            <span
              className="font-medium"
              style={{ fontSize: 15, color: "var(--color-text-dark)" }}
            >
              {link && cameraName
                ? `No live video from ${cameraName} right now`
                : "Live view needs the venue Wi-Fi"}
            </span>
            <span style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
              Recording isn&apos;t affected — the game is still being saved.
            </span>
          </div>
        )}
      </div>

      {/* CR-014: "⟲ 10 s            Live →" */}
      {showVideo && (
        <div className="flex items-center justify-between gap-3 mt-2">
          <Button
            variant="outline"
            className="h-11 rounded-full"
            onClick={rewind}
            disabled={behind >= REWIND_MAX_SECONDS}
            aria-label={`Back ${REWIND_STEP_SECONDS} seconds`}
          >
            <RotateCcw />
            {REWIND_STEP_SECONDS} s
          </Button>
          {behind === 0 ? (
            <span
              className="inline-flex items-center gap-1.5 px-4 font-semibold"
              style={{ fontSize: 14, color: "var(--color-error)" }}
            >
              <span
                className="inline-block"
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: "var(--color-error)",
                }}
              />
              Live
            </span>
          ) : (
            <Button
              className="h-11 rounded-full"
              onClick={goLive}
              aria-label="Back to live"
            >
              Live
              <ChevronsRight />
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export default LivePanel;
