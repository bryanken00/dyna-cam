import { useRoute } from "@react-navigation/native";
import {
  useGetPairedClip,
  useGetPairedSession,
} from "@/services/requests/pairedApp";
import { describeClip, describeGame } from "./shareStatus";

/**
 * State for the QR screen, for either thing a player can be handed:
 *
 *   params: { kind: "clip" | "session", id, shareUrl?, courtName?, merged? }
 *
 *  • a 60-second clip — GET /app/clips/:id, polled every 3 s while saving;
 *  • a whole game     — GET /app/sessions/:id, polled every 5 s while
 *    Recording or Processing (its parts upload for a few minutes after End).
 *
 * The link comes in with the params (Record / End's response, or the recent
 * row), so the QR draws instantly — the player can photograph it before the
 * footage is ready; the share page fills in as it is saved. Both queries are
 * called every render (hooks can't be conditional); the one that doesn't
 * apply is disabled by its null ID.
 */
export const useShareQr = () => {
  const params = useRoute().params ?? {};
  const isGame = params.kind === "session";
  const id = params.id ?? params.clipId; // `clipId`: older callers

  const clipQuery = useGetPairedClip(isGame ? null : id);
  const gameQuery = useGetPairedSession(isGame ? id : null);
  const query = isGame ? gameQuery : clipQuery;
  const item = isGame ? query.data?.data?.session : query.data?.data?.clip;

  const unpaid =
    !isGame &&
    item?.paymentStatus === "Unpaid" &&
    item.price > 0 &&
    item.payCode
      ? { price: item.price, payCode: item.payCode }
      : null;

  return {
    isGame,
    noun: isGame ? "game" : "clip",
    shareUrl: item?.shareUrl ?? params.shareUrl ?? null,
    courtName: item?.courtName ?? params.courtName,
    merged: Boolean(params.merged),
    status: isGame ? describeGame(item) : describeClip(item),
    unpaid,
    paid: !isGame && item?.paymentStatus === "Paid",
    error: query.error,
    notFound: query.error?.response?.status === 404,
  };
};

export default useShareQr;
