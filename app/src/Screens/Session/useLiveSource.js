import { useEffect, useState } from "react";
import { liveExpiryMs, liveIdentity } from "@/utils/dynaCam";

/** Swap to a fresh link this long before the playing one expires. */
const RENEW_BEFORE_MS = 2 * 60 * 1000;

/**
 * The live-video source to play, kept STABLE across polls.
 *
 * GET /app/session is polled every 5 s and each answer may carry a freshly
 * signed `hlsUrl` (same stream, new `exp`/`sig`). Handing every one of those
 * to the player would restart the video every 5 s, so the source only changes
 * when:
 *  • the stream itself changes (another host — the box's LAN address moved —
 *    or another path), or
 *  • the playing link is within 2 minutes of expiring (the box would start
 *    refusing its segments), or
 *  • there was no link and now there is one — or the reverse (`live: null`:
 *    not recording, box offline, or no LAN address).
 *
 * Returns `{ uri, identity, expiresMs } | null`. ⚠️ `uri` carries a secret
 * `sig` — never log it.
 */
export const useLiveSource = (live) => {
  const [source, setSource] = useState(null);
  const hlsUrl = live?.hlsUrl ?? null;
  const expiresAt = live?.expiresAt ?? null;

  useEffect(() => {
    if (!hlsUrl) {
      setSource(null);
      return;
    }
    const next = {
      uri: hlsUrl,
      identity: liveIdentity(hlsUrl),
      expiresMs: liveExpiryMs({ hlsUrl, expiresAt }),
    };
    setSource((cur) => {
      const sameStream = cur && cur.identity === next.identity;
      const stillGood =
        cur && (cur.expiresMs == null || cur.expiresMs - Date.now() > RENEW_BEFORE_MS);
      return sameStream && stillGood ? cur : next;
    });
  }, [hlsUrl, expiresAt]);

  return source;
};

export default useLiveSource;
