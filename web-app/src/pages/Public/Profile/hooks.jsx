import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { zPhone } from "../../../utils/phoneFormat";
import { usePlayerSignedIn } from "../../../store/playerStore";
import {
  useGetPlayerMe,
  useGetPlayerSports,
  useSavePlayerSport,
  useUpdatePlayerProfile,
} from "../../../services/requests/public/player";
import { NOT_SAID, SKILL_LEVELS } from "../../../utils/venueFacts";

// Mirrors playerProfileSchema: first and last name; the middle name and phone optional
const namePart = (label) =>
  z.string().trim().min(1, `Enter your ${label}`).max(50, `Keep your ${label} under 50 characters`);
const profileSchema = z.object({
  firstName: namePart("first name"),
  middleName: z.string().trim().max(50, "Keep your middle name under 50 characters"),
  lastName: namePart("last name"),
  phone: zPhone,
});

/** Only a player page of this app — never another site. */
const safeNext = (value) =>
  typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/me/games";

/**
 * `/me/profile` (PLAN-006): the player's name and phone. Asked once, right
 * after the first Google sign-in (filled in from Google where it can), and
 * editable later from the account menu. Booking needs it.
 */
export const useProfilePageHooks = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get("next"));

  const signedIn = usePlayerSignedIn();
  const { data, isLoading, error, refetch, isFetching } = useGetPlayerMe();
  const player = data?.data?.player || null;
  const firstTime = !!player && !player.profileComplete;
  const cameFromPage = params.has("next");
  const saveMutation = useUpdatePlayerProfile();
  const [saveError, setSaveError] = useState("");

  const form = useForm({
    resolver: zodResolver(profileSchema),
    defaultValues: { firstName: "", middleName: "", lastName: "", phone: "" },
    mode: "onTouched",
  });

  // Fill the form once the player is loaded (Google's names on a first sign-in)
  const filled = useRef(false);
  useEffect(() => {
    if (!player || filled.current) return;
    filled.current = true;
    form.reset({
      firstName: player.firstName || "",
      middleName: player.middleName || "",
      lastName: player.lastName || "",
      phone: player.phone || "",
    });
  }, [player, form]);

  const handleSave = useCallback(
    (values) => {
      setSaveError("");
      saveMutation.mutate(
        {
          firstName: values.firstName.trim(),
          middleName: values.middleName.trim() || null,
          lastName: values.lastName.trim(),
          phone: values.phone.trim() || null,
        },
        {
          // PLAN-009: Profile is a tab — stay on it unless a sign-in or a page sent the player here
          onSuccess: () => {
            if (firstTime || cameFromPage) navigate(next, { replace: true });
            else toast.success("Profile saved");
          },
          onError: (err) =>
            setSaveError(
              err?.response?.data?.message ||
                (err?.response ? "Couldn't save your profile. Please try again." : "Couldn't reach DGSports — check your connection."),
            ),
        },
      );
    },
    [saveMutation, navigate, next, firstTime, cameFromPage],
  );

  return {
    signedIn,
    player,
    firstTime,
    next,
    isLoading: signedIn && isLoading,
    isFetching,
    loadError: error && error?.response?.status !== 401 ? error : null,
    refetch,
    form,
    handleSave: form.handleSubmit(handleSave),
    isSaving: saveMutation.isPending,
    saveError,
  };
};

// ── PLAN-009 phase B: the sport card (pickleball level and DUPR) ─────────────

// Mirrors playerSportSchema: all optional; a DUPR rating is 2.000–8.000
const sportSchema = z.object({
  skillLevel: z.enum([NOT_SAID, ...SKILL_LEVELS]),
  duprId: z
    .string()
    .trim()
    .refine((v) => v === "" || /^[A-Za-z0-9]{4,20}$/.test(v), "Enter your DUPR ID as it shows in the DUPR app"),
  duprRating: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d(\.\d{1,3})?$/.test(v), "Enter your rating like 3.512")
    .refine((v) => v === "" || (Number(v) >= 2 && Number(v) <= 8), "DUPR ratings run from 2.000 to 8.000"),
});

const sportForm = (sport) => ({
  skillLevel: sport?.skillLevel || NOT_SAID,
  duprId: sport?.duprId || "",
  duprRating: sport?.duprRating === null || sport?.duprRating === undefined ? "" : sport.duprRating.toFixed(3),
});

/** The pickleball card on Profile: the player's own level and (unverified) DUPR. */
export const useSportCardHooks = () => {
  const { data, isLoading } = useGetPlayerSports();
  const sport = (data?.data?.sports || []).find((s) => s.sport === "Pickleball") || null;
  const saveMutation = useSavePlayerSport();
  const [saveError, setSaveError] = useState("");

  const form = useForm({
    resolver: zodResolver(sportSchema),
    defaultValues: sportForm(null),
    mode: "onTouched",
  });

  const filled = useRef(false);
  useEffect(() => {
    if (!sport || filled.current) return;
    filled.current = true;
    form.reset(sportForm(sport));
  }, [sport, form]);

  const handleSave = useCallback(
    (values) => {
      setSaveError("");
      saveMutation.mutate(
        {
          sport: "Pickleball",
          skillLevel: values.skillLevel === NOT_SAID ? "" : values.skillLevel,
          duprId: values.duprId.trim(),
          duprRating: values.duprRating.trim(),
        },
        {
          onSuccess: (response) => {
            const saved = (response?.data?.sports || []).find((s) => s.sport === "Pickleball");
            form.reset(sportForm(saved));
            toast.success("Saved");
          },
          onError: (err) =>
            setSaveError(err?.response?.data?.message || "Couldn't save — check your connection and try again."),
        },
      );
    },
    [saveMutation, form],
  );

  return {
    isLoading,
    sport,
    form,
    handleSave: form.handleSubmit(handleSave),
    isSaving: saveMutation.isPending,
    isDirty: form.formState.isDirty,
    saveError,
  };
};
