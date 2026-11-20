import { useCallback, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import dayjs from "dayjs";
import { z } from "zod";

import { decodeHTML } from "../../../utils/decode-html";
import {
  DEFAULT_GAME_MINUTES,
  SESSION_MAX_MINUTES,
  SESSION_MIN_MINUTES,
} from "../../../utils/dynaCam";
import { fromGameMinutes, gameTimeFields, toGameMinutes } from "../../../utils/gameTime";
import { zPhone } from "../../../utils/phoneFormat";
import {
  useGetPublicCourt,
  useStartPublicGame,
} from "../../../services/requests/public/courts";

// CR-027: the player's game — a game time and, optionally, who's playing. No
// payment (the court was paid with its reservation) and no save limit to pick.
const startSchema = z
  .object({
    ...gameTimeFields,
    playerName: z.string().trim().max(100, "Keep the name under 100 characters"),
    phone: zPhone,
    email: z
      .string()
      .trim()
      .max(255, "Keep the email under 255 characters")
      .refine((v) => v === "" || z.string().email().safeParse(v).success, "Enter a valid email"),
  })
  // Same limits as the API
  .superRefine((values, ctx) => {
    const total = toGameMinutes(values);
    if (total < SESSION_MIN_MINUTES) {
      ctx.addIssue({
        code: "custom",
        path: ["minutes"],
        message: `A game is at least ${SESSION_MIN_MINUTES} minutes`,
      });
    } else if (total > SESSION_MAX_MINUTES) {
      ctx.addIssue({ code: "custom", path: ["hours"], message: "A game is at most 3 hours" });
    }
  });

const defaultValues = () => ({
  ...fromGameMinutes(DEFAULT_GAME_MINUTES),
  playerName: "",
  phone: "",
  email: "",
});

/** Turn a failed start into the sentence the player sees under the button. */
const startErrorMessage = (error) => {
  const status = error?.response?.status;
  const apiMessage = error?.response?.data?.message;
  if (status === 503 || status === 409) {
    return apiMessage || "This court can't start a game right now.";
  }
  if (status === 429) {
    return apiMessage || "Too many tries — wait a minute and try again.";
  }
  if (!error?.response) {
    return "Couldn't reach Dyna Cam — check your connection and try again.";
  }
  return apiMessage || "Something went wrong. Please try again.";
};

export const useCourtPageHooks = () => {
  const { qrToken } = useParams();
  const navigate = useNavigate();

  const { data, isLoading, error, refetch, isFetching } = useGetPublicCourt(qrToken);
  const startMutation = useStartPublicGame();
  const [startError, setStartError] = useState("");

  const form = useForm({
    resolver: zodResolver(startSchema),
    defaultValues: defaultValues(),
    mode: "onTouched",
  });

  const court = data?.data?.court || null;
  const notFound = error?.response?.status === 404;

  const handleStart = useCallback(
    (values) => {
      setStartError("");
      startMutation.mutate(
        {
          qrToken,
          body: {
            durationMinutes: toGameMinutes(values),
            playerName: values.playerName.trim(),
            phone: values.phone.trim(),
            email: values.email.trim(),
          },
        },
        {
          onSuccess: (response) => {
            const shareToken = response?.data?.shareToken;
            if (!shareToken) {
              setStartError("Something went wrong. Please try again.");
              return;
            }
            // The game's page: live view, Save the last …, then the videos.
            // replace: Back shouldn't land on a form that would start another game
            navigate(`/session/${shareToken}`, { replace: true });
          },
          onError: (err) => {
            setStartError(startErrorMessage(err));
            // Busy / offline / gone: refresh the court so the page shows its real state
            if ([404, 409, 503].includes(err?.response?.status)) refetch();
          },
        }
      );
    },
    [qrToken, startMutation, navigate, refetch]
  );

  return {
    form,
    court,
    venueName: decodeHTML(court?.venueName),
    courtName: decodeHTML(court?.name),
    cameraReady: !!court?.cameraReady,
    busy: !!court?.busy,
    busyUntilText: court?.busyUntil ? dayjs(court.busyUntil).format("h:mm A") : null,
    maxSaves: court?.maxSaves || 5,
    // The venue streams this court (only sent while streaming and the box is online)
    liveWatchUrl: court?.liveWatchUrl || null,
    isLoading,
    isFetching,
    notFound,
    loadError: !notFound ? error : null,
    refetch,
    handleStart: form.handleSubmit(handleStart),
    isStarting: startMutation.isPending,
    startError,
  };
};
