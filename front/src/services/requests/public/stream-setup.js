import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getStreamSetupApi,
  saveStreamSetupApi,
  stopStreamSetupApi,
} from "../../api/public/stream-setup";

const streamSetupKey = (code) => ["streamSetup", code];

/** Put the stream the API answered with straight into the cached setup. */
const storeStream = (queryClient, code, stream) => {
  queryClient.setQueryData(streamSetupKey(code), (old) =>
    old ? { ...old, data: { ...old.data, stream } } : old,
  );
};

// Query: the session a setup code points to, and its stream. Polls every 5 s
// while the page is open (status comes from the recorder box). A 404 —
// unknown, expired or the session has ended — is final.
export const useGetStreamSetup = (code) => {
  return useQuery({
    queryKey: streamSetupKey(code),
    queryFn: () => getStreamSetupApi(code),
    enabled: !!code,
    retry: (count, error) => error?.response?.status !== 404 && count < 2,
    refetchInterval: (query) =>
      query.state.error?.response?.status === 404 ? false : 5 * 1000,
  });
};

// Mutation: save the player's stream. The page shows errors itself (field
// errors, 404, 409). `gcTime: 0` + the caller's `reset()` after a save drop
// the mutation — and the stream key in its variables — from memory.
export const useSaveStreamSetup = (code) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => saveStreamSetupApi(code, data),
    gcTime: 0,
    onSuccess: (response) => {
      storeStream(queryClient, code, response?.data?.stream ?? null);
      queryClient.invalidateQueries({ queryKey: streamSetupKey(code) });
    },
  });
};

// Mutation: stop the player's stream
export const useStopStreamSetup = (code) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => stopStreamSetupApi(code),
    onSuccess: () => {
      storeStream(queryClient, code, null);
      queryClient.invalidateQueries({ queryKey: streamSetupKey(code) });
    },
  });
};
