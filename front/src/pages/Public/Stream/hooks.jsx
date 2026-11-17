import { useCallback, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { confirm } from "../../../store/confirmStore";
import { decodeHTML } from "../../../utils/decode-html";
import { STREAM_PLATFORM_LABEL } from "../../../utils/dynaCam";
import {
  useGetStreamSetup,
  useStopStreamSetup,
} from "../../../services/requests/public/stream-setup";

export const useStreamPageHooks = () => {
  const { code } = useParams();
  const { data, isLoading, error, refetch, isFetching } = useGetStreamSetup(code);
  const stopMutation = useStopStreamSetup(code);

  // "Change key" shows the form over a saved stream; "Change" on the
  // cameras shows the layout picker in the status card
  const [isChangingKey, setIsChangingKey] = useState(false);
  const [isPickingLayout, setIsPickingLayout] = useState(false);

  const setup = data?.data?.setup || null;
  const stream = data?.data?.stream ?? null;
  const notFound = error?.response?.status === 404;
  const showForm = !stream || isChangingKey;

  const handleChangeKey = useCallback(() => {
    setIsPickingLayout(false);
    setIsChangingKey(true);
  }, []);
  const handlePickLayout = useCallback(() => setIsPickingLayout(true), []);
  const handleLayoutDone = useCallback(() => setIsPickingLayout(false), []);
  const handleLayoutSaved = useCallback(() => {
    setIsPickingLayout(false);
    toast.success("Cameras switched");
  }, []);
  const handleKeepStream = useCallback(() => setIsChangingKey(false), []);
  const handleSaved = useCallback(() => {
    setIsChangingKey(false);
    toast.success("Stream saved");
  }, []);

  const handleStop = useCallback(async () => {
    const where = STREAM_PLATFORM_LABEL[stream?.platform] || "your channel";
    const ok = await confirm({
      title: "Stop streaming",
      description: `Stop streaming this game to ${
        stream?.platform === "OTHER" ? "your stream server" : where
      }? The recording carries on. You can start again with your key while the game is on.`,
      confirmText: "Stop streaming",
      cancelText: "Keep streaming",
      danger: true,
    });
    if (!ok) return;
    stopMutation.mutate(undefined, {
      onSuccess: () => {
        setIsChangingKey(false);
        setIsPickingLayout(false);
        toast.success("Stream stopped");
      },
      onError: (err) => {
        toast.error(
          err?.response?.data?.message || "Couldn't stop the stream. Please try again.",
        );
        refetch();
      },
    });
  }, [stream, stopMutation, refetch]);

  return {
    code,
    setup,
    stream,
    courtName: decodeHTML(setup?.courtName),
    venueName: decodeHTML(setup?.venueName),
    showForm,
    isChangingKey,
    isLoading,
    isFetching,
    notFound,
    // The API says why: expired, unknown, or the session has ended
    notFoundMessage: notFound ? error?.response?.data?.message || null : null,
    loadError: !notFound ? error : null,
    refetch,
    handleChangeKey,
    isPickingLayout,
    handlePickLayout,
    handleLayoutDone,
    handleLayoutSaved,
    handleKeepStream,
    handleSaved,
    handleStop,
    isStopping: stopMutation.isPending,
  };
};
