import { useState } from "react";
import { playerErrorMessage, useSaveProfile } from "@/services/requests/player";
import { usePlayerStore } from "@/store/usePlayerStore";
import { formatPhoneDisplay, formatPhoneOnChange, isValidPhoneNumber } from "@/utils/phoneFormat";

const NAME_MAX = 50;

/** The API's rules (player.validator.js playerProfileSchema), checked before sending. */
const validate = ({ firstName, lastName, middleName, phone }) => {
  const errors = {};
  if (!firstName.trim()) errors.firstName = "Enter your first name";
  else if (firstName.trim().length > NAME_MAX) errors.firstName = "Up to 50 characters";
  if (!lastName.trim()) errors.lastName = "Enter your last name";
  else if (lastName.trim().length > NAME_MAX) errors.lastName = "Up to 50 characters";
  if (middleName.trim().length > NAME_MAX) errors.middleName = "Up to 50 characters";
  if (phone.trim() && !isValidPhoneNumber(phone)) errors.phone = "Enter a mobile number like 0912 3456 789";
  return errors;
};

/**
 * The profile form (PLAN-006 fields): first, middle (optional), last name and
 * phone (optional), pre-filled from Google / the saved profile.
 * `onSaved` runs after a save (Edit profile goes back; the first sign-in's
 * navigator switches to the tabs by itself).
 */
export const useProfileForm = ({ onSaved } = {}) => {
  const player = usePlayerStore((s) => s.player);
  const save = useSaveProfile();
  const [values, setValues] = useState(() => ({
    firstName: player?.firstName || "",
    middleName: player?.middleName || "",
    lastName: player?.lastName || "",
    phone: formatPhoneDisplay(player?.phone || ""),
  }));
  const [submitted, setSubmitted] = useState(false);

  const errors = submitted ? validate(values) : {};

  const set = (field) => (text) =>
    setValues((v) => ({ ...v, [field]: field === "phone" ? formatPhoneOnChange(text) : text }));

  const submit = () => {
    setSubmitted(true);
    if (Object.keys(validate(values)).length) return;
    save.mutate(
      {
        firstName: values.firstName.trim(),
        middleName: values.middleName.trim(),
        lastName: values.lastName.trim(),
        phone: values.phone.trim(),
      },
      { onSuccess: () => onSaved?.() },
    );
  };

  return {
    email: player?.email || "",
    values,
    errors,
    set,
    submit,
    saving: save.isPending,
    saveError: save.isError ? playerErrorMessage(save.error, "Couldn't save your profile.") : null,
  };
};
