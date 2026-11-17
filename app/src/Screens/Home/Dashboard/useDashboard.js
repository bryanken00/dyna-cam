import usePermissions from "@/hooks/usePermissions";
import { useGetClips } from "@/services/requests/clips";
import { useGetDevices } from "@/services/requests/devices";
import { useGetSessions } from "@/services/requests/sessions";
import { manilaNow } from "@/utils/dynaCam";

/**
 * The Dashboard's four numbers, each read from a list endpoint's
 * `pagination.total` with `pageSize: 1` — there is no dashboard endpoint for
 * the app (the web's `/dashboard` is a different permission and shape). Each
 * query runs only if the user may read that list, and each card fails on
 * its own: one error never blanks the others.
 *
 *  • Clips today        GET /clips?dateFrom=today&dateTo=today  (Manila date)
 *  • Awaiting payment   GET /clips?status=Ready&paymentStatus=Unpaid
 *  • Recording now      GET /sessions?status=Recording
 *  • Boxes offline      GET /devices (≤100) → Active and not online
 *
 * `value` is null while loading or after an error, so the card shows "–".
 */
const countOf = (query) =>
  query.isSuccess ? (query.data?.data?.pagination?.total ?? 0) : null;

export const useDashboard = () => {
  const perms = usePermissions();
  const canClips = perms.can("clips");
  const canDevices = perms.can("venues", "devices");
  const today = manilaNow().date;

  const clipsToday = useGetClips(
    { page: 1, pageSize: 1, dateFrom: today, dateTo: today },
    { enabled: canClips },
  );
  const awaitingPayment = useGetClips(
    { page: 1, pageSize: 1, status: "Ready", paymentStatus: "Unpaid" },
    { enabled: canClips },
  );
  const recording = useGetSessions(
    { page: 1, pageSize: 1, status: "Recording" },
    { enabled: canClips },
  );
  const devices = useGetDevices(
    { page: 1, pageSize: 100 },
    { enabled: canDevices },
  );

  const deviceRows = devices.data?.data?.devices ?? [];
  const boxesOffline = devices.isSuccess
    ? deviceRows.filter((d) => d.status === "Active" && !d.online).length
    : null;

  const queries = [clipsToday, awaitingPayment, recording, devices];

  return {
    permissionsLoading: perms.isLoading,
    permissionsError: perms.isError,
    can: perms.can,
    canClips,
    canDevices,
    clipsToday: countOf(clipsToday),
    awaitingPayment: countOf(awaitingPayment),
    recordingNow: countOf(recording),
    boxesOffline,
    boxesTotal: devices.isSuccess ? deviceRows.length : null,
    anyError: queries.some((q) => q.isError),
    isRefreshing: queries.some((q) => q.isRefetching) || perms.isRefetching,
    refresh: () => {
      perms.refetch();
      queries.forEach((q) => {
        // A disabled query's refetch would run it anyway — skip those
        if (!q.isPending || q.fetchStatus !== "idle") q.refetch();
      });
    },
  };
};

export default useDashboard;
