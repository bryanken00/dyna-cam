import {
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  CircleAlert,
  KeyRound,
  Loader2,
  Mail,
  Phone,
  Play,
  Radio,
  RotateCcw,
  User,
  VideoOff,
} from "lucide-react";

import { Link } from "react-router";

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

import { useCourtPageHooks } from "./hooks";
import GameTimeFields from "../../../components/GameTimeFields";
import PublicLayout from "../../../components/layout/PublicLayout";
import ResultState from "../../../components/ResultState";
import SectionLabel from "../../../components/SectionLabel";
import Spinner from "../../../components/Spinner";
import { getImageUrl } from "../../../utils/upload";
import { PHONE_MAX_LENGTH, PHONE_PLACEHOLDER, formatPhoneOnChange } from "../../../utils/phoneFormat";

const PRIVACY_NOTE = "Your game is recorded from Start game until its time is up.";

/** One-tap game times, in minutes. */
const GAME_TIME_PRESETS = [30, 60, 90, 120];

const cardStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

const iconPrefix = "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2";
const mutedIcon = { color: "var(--color-text-muted)" };

/** A notice under the court name: the court is busy, or its camera is offline. */
const Notice = ({ icon: Icon, children }) => (
  <div
    role="status"
    className="mt-5 flex items-start gap-2.5 p-3 text-left"
    style={{
      background: "var(--color-surface-sunken)",
      border: "1px solid var(--color-line)",
      borderRadius: 12,
      fontSize: 13.5,
      color: "var(--color-text-dark)",
    }}
  >
    <Icon className="size-4.5 shrink-0 mt-0.5" style={{ color: "var(--color-text-secondary)" }} />
    <span>{children}</span>
  </div>
);

/**
 * `/court/:qrToken` (CR-027) — what a player sees after scanning the court's
 * QR sign: the venue and court, how long they'll play and who's playing, and
 * Start game. The game records the whole time and the player lands on its
 * page (`/session/:shareToken`). Until CR-027 this page saved the last 60
 * seconds instead.
 */
const CourtPage = () => {
  const {
    form,
    court,
    venueName,
    courtName,
    cameraReady,
    busy,
    busyUntilText,
    maxSaves,
    liveWatchUrl,
    bookAheadUrl,
    isLoading,
    isFetching,
    notFound,
    loadError,
    refetch,
    handleStart,
    isStarting,
    startError,
    checkInForm,
    handleCheckIn,
    isCheckingIn,
    checkInError,
    booking,
    bookingText,
    freeUntilText,
  } = useCourtPageHooks();

  if (isLoading) {
    return (
      <PublicLayout>
        <Spinner className="py-24" tip="Loading the court…" />
      </PublicLayout>
    );
  }

  if (notFound) {
    return (
      <PublicLayout footer={PRIVACY_NOTE}>
        <ResultState
          status="404"
          title="This code isn't valid"
          description="The QR code may be out of date, or this court isn't taking games right now. Ask the front desk for help."
        />
      </PublicLayout>
    );
  }

  if (loadError || !court) {
    return (
      <PublicLayout>
        <ResultState
          status="error"
          title="Couldn't load this court"
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

  const logo = getImageUrl(court.venueLogoUrl);
  const canStart = cameraReady && !busy;

  return (
    <PublicLayout footer={PRIVACY_NOTE}>
      <div className="p-6" style={cardStyle}>
        {/* Venue + court */}
        <div className="flex flex-col items-center gap-2.5 text-center">
          {logo && (
            <img
              src={logo}
              alt=""
              className="object-contain"
              style={{ maxHeight: 64, maxWidth: 200 }}
            />
          )}
          <p
            className="m-0"
            style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-secondary)" }}
          >
            {venueName}
          </p>
          <h1
            className="m-0 font-semibold leading-tight"
            style={{ fontSize: 32, letterSpacing: "-0.6px", color: "var(--color-text-dark)" }}
          >
            {courtName}
          </h1>
          <p className="m-0" style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
            Start recording your game — up to {maxSaves} saves of your best moments.
          </p>
        </div>

        {busy && (
          <Notice icon={CircleAlert}>
            This court has a game going
            {busyUntilText ? ` until ${busyUntilText}` : ""}. You can start yours once it ends.
          </Notice>
        )}
        {!busy && !cameraReady && (
          <Notice icon={VideoOff}>
            The camera is offline right now, so a game can&apos;t start. Please tell the front
            desk.
          </Notice>
        )}
        {!busy && booking && (
          <Notice icon={CalendarCheck}>
            This court is booked {bookingText}. Booked it? Enter the code from your booking to
            start your game.
          </Notice>
        )}
        {!busy && !booking && freeUntilText && (
          <Notice icon={CalendarClock}>
            Free until {freeUntilText} — it&apos;s booked after that, so your game has to end by
            then.
          </Notice>
        )}

        {booking ? (
          // PLAN-003 Phase D: booked now → check in with the booking code
          <Form {...checkInForm}>
            <form onSubmit={handleCheckIn} noValidate className="mt-6">
              <FormField
                control={checkInForm.control}
                name="bookingCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Booking code</FormLabel>
                    <div className="relative">
                      <KeyRound className={iconPrefix} style={mutedIcon} />
                      <FormControl>
                        <Input
                          placeholder="e.g., K7Q M2P"
                          className="h-12 pl-9 font-mono uppercase"
                          style={{ fontSize: 18, letterSpacing: "0.1em" }}
                          autoCapitalize="characters"
                          autoComplete="off"
                          maxLength={20}
                          {...field}
                        />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                size="lg"
                className="mt-5 w-full h-16 text-base font-semibold rounded-(--radius-card)"
                disabled={!cameraReady || isCheckingIn}
              >
                {isCheckingIn ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <Play className="size-5" />
                )}
                {isCheckingIn ? "Checking in…" : "Check in and start"}
              </Button>
              {checkInError && (
                <p
                  role="alert"
                  className="m-0 mt-3 text-center"
                  style={{ fontSize: 13.5, color: "var(--color-error)" }}
                >
                  {checkInError}
                </p>
              )}
              <p
                className="m-0 mt-3 text-center"
                style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}
              >
                Your game records for your booked time and stops by itself at the end.
              </p>
            </form>
          </Form>
        ) : (
        <Form {...form}>
          <form onSubmit={handleStart} noValidate className="mt-6">
            <SectionLabel>How long you&apos;ll play</SectionLabel>
            <GameTimeFields form={form} presets={GAME_TIME_PRESETS} />
            <p className="m-0 mt-2" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
              5 minutes to 3 hours. Recording stops by itself at the end.
            </p>

            <div className="mt-6">
              <SectionLabel>Who&apos;s playing (optional)</SectionLabel>
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="playerName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <div className="relative">
                        <User className={iconPrefix} style={mutedIcon} />
                        <FormControl>
                          <Input
                            placeholder="e.g., Juan dela Cruz"
                            className="h-11 pl-9"
                            autoComplete="name"
                            maxLength={100}
                            {...field}
                          />
                        </FormControl>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone number</FormLabel>
                      <div className="relative">
                        <Phone className={iconPrefix} style={mutedIcon} />
                        <FormControl>
                          <Input
                            placeholder={PHONE_PLACEHOLDER}
                            className="h-11 pl-9"
                            maxLength={PHONE_MAX_LENGTH}
                            inputMode="tel"
                            autoComplete="tel"
                            {...field}
                            onChange={(e) => field.onChange(formatPhoneOnChange(e.target.value))}
                          />
                        </FormControl>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <div className="relative">
                        <Mail className={iconPrefix} style={mutedIcon} />
                        <FormControl>
                          <Input
                            type="email"
                            inputMode="email"
                            autoCapitalize="none"
                            autoComplete="email"
                            placeholder="e.g., juan@gmail.com"
                            className="h-11 pl-9"
                            maxLength={255}
                            {...field}
                          />
                        </FormControl>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <p className="m-0 mt-2" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
                The email gets your game&apos;s Google Drive link once the videos are in Drive.
              </p>
            </div>

            <Button
              type="submit"
              size="lg"
              className="mt-7 w-full h-16 text-base font-semibold rounded-(--radius-card)"
              disabled={!canStart || isStarting}
            >
              {isStarting ? <Loader2 className="size-5 animate-spin" /> : <Play className="size-5" />}
              {isStarting ? "Starting…" : "Start game"}
            </Button>

            {startError && (
              <p
                role="alert"
                className="m-0 mt-3 text-center"
                style={{ fontSize: 13.5, color: "var(--color-error)" }}
              >
                {startError}
              </p>
            )}
          </form>
        </Form>
        )}

        {/* The venue streams this court — the API only sends the link while
            streaming is on and the recorder box is online */}
        {liveWatchUrl && (
          <Button
            asChild
            variant="outline"
            size="lg"
            className="mt-3 w-full h-12 text-[15px] rounded-(--radius-card)"
          >
            <a href={liveWatchUrl} target="_blank" rel="noopener noreferrer">
              <Radio className="size-4.5" style={{ color: "var(--color-error)" }} />
              Watch live
            </a>
          </Button>
        )}

        {/* CR-030: reserve this court for another day */}
        {bookAheadUrl && (
          <Button
            asChild
            variant="outline"
            size="lg"
            className="mt-3 w-full h-12 text-[15px] rounded-(--radius-card)"
          >
            <Link to={bookAheadUrl}>
              <CalendarPlus className="size-4.5" />
              Book this court ahead
            </Link>
          </Button>
        )}
      </div>
    </PublicLayout>
  );
};

export default CourtPage;
