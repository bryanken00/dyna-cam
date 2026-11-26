import { useCallback, useEffect, useRef, useState } from "react";
import { useCreateStreamLink } from "@/services/requests/session";
import { isConnectionError } from "@/utils/dynaCam";

/** Which stream this is — a different one means the player saved a new key. */
const streamIdentity = (stream) =>
  stream ? `${stream.platform}|${stream.maskedUrl ?? ""}` : null;

/**
 * State for the "Stream to your Facebook / YouTube" sheet (PLAN-002 Phase G).
 *
 *  • Opening it asks for a fresh setup link (each one kills the last, so
 *    only on open and on "New code" — never on a re-render or refetch).
 *  • The link's countdown runs from `expiresInSeconds` and the moment the
 *    answer arrived (device clock only); at 0 the sheet offers "New code".
 *  • It closes by itself once the session reports the player's stream: any
 *    stream if there was none when it opened, or a different one (another
 *    platform or address) when it was opened from "Change stream".
 *
 * ⚠️ `link.url` carries the setup code — never log it.
 *
 * @param {object|null} stream - GET /app/session's `stream`, as polled
 */
export const useStreamSetup = (stream) => {
  const create = useCreateStreamLink();
  const [open, setOpen] = useState(false);
  // { url, expiresInSeconds, receivedAt } — receivedAt is a device-clock ms
  const [link, setLink] = useState(null);
  const [expired, setExpired] = useState(false);
  const openedWith = useRef(null);

  const requestLink = () => {
    setExpired(false);
    setLink(null);
    create.reset();
    create.mutate(undefined, {
      onSuccess: (response) =>
        setLink({
          url: response.data?.url,
          expiresInSeconds: response.data?.expiresInSeconds ?? 0,
          receivedAt: Date.now(),
        }),
    });
  };

  const close = useCallback(() => {
    setOpen(false);
    setLink(null);
    setExpired(false);
  }, []);

  const current = streamIdentity(stream);
  useEffect(() => {
    if (open && current && current !== openedWith.current) close();
  }, [open, current, close]);

  const error = create.error
    ? isConnectionError(create.error)
      ? "Can't reach DGSports — check the Wi-Fi and try again."
      : create.error.response?.data?.message || "Couldn't make a code — try again."
    : null;

  return {
    open,
    openSheet: () => {
      openedWith.current = current;
      setOpen(true);
      requestLink();
    },
    close,
    link,
    loading: create.isPending,
    error,
    expired,
    onExpire: () => setExpired(true),
    newCode: requestLink,
  };
};

export default useStreamSetup;
