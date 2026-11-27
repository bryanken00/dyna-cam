import { CircleAlert, Loader2, Phone, RotateCcw, Save, UserRound } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

import { useProfilePageHooks } from "./hooks";
import PublicLayout from "../../../components/layout/PublicLayout";
import ResultState from "../../../components/ResultState";
import Spinner from "../../../components/Spinner";
import GoogleSignInButton from "../../../components/player/GoogleSignInButton";
import SportCard from "./components/SportCard";
import { PHONE_MAX_LENGTH, PHONE_PLACEHOLDER, formatPhoneOnChange } from "../../../utils/phoneFormat";

const cardStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

const Required = () => <span style={{ color: "var(--color-error)" }}>*</span>;

/** One name field. */
const NameField = ({ control, name, label, required, placeholder, autoComplete }) => (
  <FormField
    control={control}
    name={name}
    render={({ field }) => (
      <FormItem>
        <FormLabel>
          {label} {required ? <Required /> : <span style={{ color: "var(--color-text-muted)" }}>(optional)</span>}
        </FormLabel>
        <FormControl>
          <Input placeholder={placeholder} className="h-11" autoComplete={autoComplete} maxLength={50} {...field} />
        </FormControl>
        <FormMessage />
      </FormItem>
    )}
  />
);

/**
 * `/me/profile` (PLAN-006) — the player's first name, middle name (optional),
 * last name and phone (optional). Shown right after the first Google sign-in, filled in
 * from Google; booking needs it. Later it's "Your profile" in the account menu.
 */
const ProfilePage = () => {
  const {
    signedIn,
    player,
    firstTime,
    isLoading,
    isFetching,
    loadError,
    refetch,
    form,
    handleSave,
    isSaving,
    saveError,
  } = useProfilePageHooks();

  // PLAN-009: Profile is a tab — a signed-out visitor is asked to sign in here
  if (!signedIn) {
    return (
      <PublicLayout>
        <div className="p-6" style={cardStyle}>
          <ResultState
            status="404"
            icon={<UserRound className="w-6 h-6" strokeWidth={1.8} />}
            title="Your profile"
            description="Sign in with Google to set your name and phone, and to book a court."
            action={<GoogleSignInButton returnPath="/me/profile" />}
          />
        </div>
      </PublicLayout>
    );
  }

  if (isLoading) {
    return (
      <PublicLayout>
        <Spinner className="py-24" tip="Loading your profile…" />
      </PublicLayout>
    );
  }

  if (loadError || !player) {
    return (
      <PublicLayout>
        <ResultState
          status="error"
          title="Couldn't load your profile"
          description="Check your connection and try again."
          action={
            <Button onClick={() => refetch()} disabled={isFetching}>
              <RotateCcw />
              Try again
            </Button>
          }
        />
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <div className="space-y-4">
        <div className="pt-2 pb-1">
          <h1
            className="m-0 font-semibold leading-tight"
            style={{ fontSize: 28, letterSpacing: "-0.5px", color: "var(--color-text-dark)" }}
          >
            {firstTime ? "Complete your profile" : "Your profile"}
          </h1>
          <p className="m-0 mt-1.5" style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
            {firstTime
              ? "We filled in what Google shared. Check your name — the venue sees it on your bookings. A phone number helps them reach you."
              : "The name and phone number on your bookings."}
          </p>
        </div>

        <div className="p-5" style={cardStyle}>
          {/* The Google account it belongs to */}
          <div className="flex items-center gap-3 mb-5">
            <Avatar className="size-10">
              {player.photoUrl && <AvatarImage src={player.photoUrl} alt="" referrerPolicy="no-referrer" />}
              <AvatarFallback>{(player.firstName || player.email).charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>Signed in with Google</div>
              <div className="truncate" style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-dark)" }}>
                {player.email}
              </div>
            </div>
          </div>

          <Form {...form}>
            <form onSubmit={handleSave} noValidate className="space-y-4">
              <NameField
                control={form.control}
                name="firstName"
                label="First name"
                required
                placeholder="e.g., Juan"
                autoComplete="given-name"
              />
              <NameField
                control={form.control}
                name="middleName"
                label="Middle name"
                placeholder="e.g., Santos"
                autoComplete="additional-name"
              />
              <NameField
                control={form.control}
                name="lastName"
                label="Last name"
                required
                placeholder="e.g., dela Cruz"
                autoComplete="family-name"
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Phone number <span style={{ color: "var(--color-text-muted)" }}>(optional)</span>
                    </FormLabel>
                    <div className="relative">
                      <Phone
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                        style={{ color: "var(--color-text-muted)" }}
                      />
                      <FormControl>
                        <Input
                          placeholder={PHONE_PLACEHOLDER}
                          className="h-11 pl-9"
                          inputMode="tel"
                          autoComplete="tel"
                          maxLength={PHONE_MAX_LENGTH}
                          {...field}
                          onChange={(e) => field.onChange(formatPhoneOnChange(e.target.value))}
                        />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {saveError && (
                <p role="alert" className="m-0 flex items-start gap-2" style={{ fontSize: 13.5, color: "var(--color-error)" }}>
                  <CircleAlert className="size-4 shrink-0 mt-0.5" />
                  {saveError}
                </p>
              )}

              <Button type="submit" size="lg" className="w-full h-12" disabled={isSaving}>
                {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
                {firstTime ? "Save and continue" : "Save"}
              </Button>
            </form>
          </Form>
        </div>

        {/* PLAN-009 phase B: level and DUPR — after the first-sign-in profile is done */}
        {!firstTime && <SportCard />}
      </div>
    </PublicLayout>
  );
};

export default ProfilePage;
