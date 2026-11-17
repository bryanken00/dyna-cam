import usePermissions from "@/hooks/usePermissions";
import {
  useCancelSession,
  useEndSession,
  useGetSession,
} from "@/services/requests/sessions";
import { sessionActionsFor } from "../useSessionsModule";

/**
 * State for one session: the session with its parts, and cancel / end
 * (gated on clips write and on the API's own timing rules).
 */
export const useSessionDetail = (sessionId) => {
  const { can } = usePermissions();
  const query = useGetSession(sessionId);
  const cancel = useCancelSession();
  const end = useEndSession();

  const session = query.data?.data?.session ?? null;
  const canWrite = can("clips", null, "write");
  const actions = sessionActionsFor(session);

  return {
    session,
    parts: session?.parts ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    errorMessage: query.error?.response?.data?.message,
    isRefreshing: query.isRefetching,
    refresh: query.refetch,
    canCancel: canWrite && actions.canCancel,
    canEnd: canWrite && actions.canEnd,
    busy: cancel.isPending || end.isPending,
    cancelSession: (id) => cancel.mutate(id),
    endSession: (id) => end.mutate(id),
  };
};

export default useSessionDetail;
