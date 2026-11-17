import { useState } from "react";
import { useFinishPairing, useGetDeviceSession } from "@/services/requests/session";

const ENDED_NOTICE = "The session has ended — this device is unpaired.";

/**
 * State for the Ended screen: the finished session (still polled every 5 s,
 * for its saving progress and the remaining grace), Done, and the unpair
 * countdown.
 *
 *  • Done → unpair on the server (best effort), forget the token, back to
 *    "Pair this device". No confirmation — the QR has done its job.
 *  • The countdown reaching 0 → forget the token locally (the server stops
 *    accepting it at the same moment) and say why on the Pair screen.
 */
export const useEndedScreen = () => {
  const query = useGetDeviceSession();
  const finish = useFinishPairing();
  const [leaving, setLeaving] = useState(false);
  const data = query.data?.data ?? null;

  return {
    session: data?.session ?? null,
    unpairInSeconds: data?.unpairInSeconds ?? null,
    since: query.dataUpdatedAt,
    error: query.error,
    leaving,
    done: async () => {
      if (leaving) return;
      setLeaving(true);
      await finish({ notify: true });
    },
    graceOver: () => finish({ notify: false, notice: ENDED_NOTICE }),
  };
};

export default useEndedScreen;
