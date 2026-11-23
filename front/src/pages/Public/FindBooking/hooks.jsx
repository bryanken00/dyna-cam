import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useFindMyBooking } from "../../../services/requests/public/bookings";

const PHONE_DIGITS = /^(09\d{9}|639\d{9}|9\d{9})$/;

// Mirrors findBookingSchema: a 4–12 character code ("k7q m2p" works) and a
// phone number (any common PH format) or an email
const findSchema = z.object({
  bookingCode: z
    .string()
    .transform((v) => v.replace(/\s+/g, "").toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{4,12}$/, "Enter the code from your booking")),
  contact: z
    .string()
    .trim()
    .min(1, "Enter the phone number or email you booked with")
    .max(255)
    .refine(
      (v) =>
        v.includes("@")
          ? z.string().email().safeParse(v).success
          : PHONE_DIGITS.test(v.replace(/\D/g, "")),
      "Enter the phone number or email you booked with"
    ),
});

/** A failed lookup → the sentence under the button. */
const findErrorMessage = (error) => {
  const status = error?.response?.status;
  const apiMessage = error?.response?.data?.message;
  if (status === 404 || status === 429) return apiMessage || "No booking matches — check the code.";
  if (!error?.response) return "Couldn't reach Dyna Cam — check your connection and try again.";
  return apiMessage || "Something went wrong. Please try again.";
};

/**
 * `/booking` (CR-030): Find my booking — the code from the booking plus the
 * phone or email it was made with opens the booking's own page.
 */
export const useFindBookingPageHooks = () => {
  const navigate = useNavigate();
  const findMutation = useFindMyBooking();
  const [findError, setFindError] = useState("");

  const form = useForm({
    resolver: zodResolver(findSchema),
    defaultValues: { bookingCode: "", contact: "" },
    mode: "onTouched",
  });

  const handleFind = useCallback(
    (values) => {
      setFindError("");
      findMutation.mutate(
        { bookingCode: values.bookingCode, contact: values.contact.trim() },
        {
          onSuccess: (response) => {
            const token = response?.data?.manageToken;
            if (!token) {
              setFindError("Something went wrong. Please try again.");
              return;
            }
            navigate(`/booking/${token}`);
          },
          onError: (err) => setFindError(findErrorMessage(err)),
        }
      );
    },
    [findMutation, navigate]
  );

  return {
    form,
    handleFind: form.handleSubmit(handleFind),
    isFinding: findMutation.isPending,
    findError,
  };
};
