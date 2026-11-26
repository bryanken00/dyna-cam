import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { zPhone } from "../../../utils/phoneFormat";
import { usePlayerSignedIn } from "../../../store/playerStore";
import { useGetPlayerMe, useUpdatePlayerProfile } from "../../../services/requests/public/player";

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
          onSuccess: () => navigate(next, { replace: true }),
          onError: (err) =>
            setSaveError(
              err?.response?.data?.message ||
                (err?.response ? "Couldn't save your profile. Please try again." : "Couldn't reach DGSports — check your connection."),
            ),
        },
      );
    },
    [saveMutation, navigate, next],
  );

  return {
    signedIn,
    player,
    firstTime: !!player && !player.profileComplete,
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
