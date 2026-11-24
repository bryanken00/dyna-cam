import { CalendarCheck, CalendarPlus, CircleAlert, KeyRound, Loader2, Play, Radio, RotateCcw, VideoOff } from "lucide-react";

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
import PublicLayout from "../../../components/layout/PublicLayout";
import ResultState from "../../../components/ResultState";
import Spinner from "../../../components/Spinner";
import { getImageUrl } from "../../../utils/upload";

const PRIVACY_NOTE = "Your game is recorded for your booked time, from when you check in.";

const cardStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

const iconPrefix = "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2";
const mutedIcon = { color: "var(--color-text-muted)" };

/** A notice under the court name: a game is on, the camera is offline, or it's booked now. */
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
 * `/court/:qrToken` — what a player sees after scanning the court's QR sign:
 * the venue and court and a **Booking code** box. CR-034: the code is the only
 * way to start a game here (PLAN-003 Phase D check-in); CR-027's walk-in Start
 * game, with its game time and who's playing, is gone. No booking → Book this
 * court, or the front desk.
 */
const CourtPage = () => {
  const {
    court,
    venueName,
    courtName,
    cameraReady,
    busy,
    busyUntilText,
    maxSaves,
    liveWatchUrl,
    bookUrl,
    isLoading,
    isFetching,
    notFound,
    loadError,
    refetch,
    checkInForm,
    handleCheckIn,
    isCheckingIn,
    checkInError,
    bookingText,
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
            Enter your booking code to start recording your game — up to {maxSaves} saves of your
            best moments.
          </p>
        </div>

        {busy && (
          <Notice icon={CircleAlert}>
            This court has a game going
            {busyUntilText ? ` until ${busyUntilText}` : ""}. Booked after it? Check in once it
            ends.
          </Notice>
        )}
        {!busy && !cameraReady && (
          <Notice icon={VideoOff}>
            The camera is offline right now, so a game can&apos;t start. Please tell the front
            desk.
          </Notice>
        )}
        {!busy && cameraReady && bookingText && (
          <Notice icon={CalendarCheck}>This court is booked {bookingText}.</Notice>
        )}

        {/* PLAN-003 Phase D: the booking's code starts its game */}
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
                        className="h-12 pl-9 font-mono uppercase placeholder:normal-case"
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
              {isCheckingIn ? <Loader2 className="size-5 animate-spin" /> : <Play className="size-5" />}
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
              The code is on your booking&apos;s page and in its email.{" "}
              <Link to="/booking" style={{ color: "var(--color-link)" }}>
                Find my booking
              </Link>
            </p>
          </form>
        </Form>
      </div>

      {/* No booking: book this court (CR-030), or ask the desk */}
      <div className="mt-4 p-5 text-center" style={cardStyle}>
        <p className="m-0" style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-dark)" }}>
          No booking?
        </p>
        <p className="m-0 mt-1" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          {bookUrl
            ? "Book this court, then come back and enter your code."
            : "Ask the front desk to book this court for you."}
        </p>
        {bookUrl && (
          <Button asChild size="lg" variant="outline" className="mt-4 w-full h-12 text-[15px] rounded-(--radius-card)">
            <Link to={bookUrl}>
              <CalendarPlus className="size-4.5" />
              Book this court
            </Link>
          </Button>
        )}
      </div>

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
    </PublicLayout>
  );
};

export default CourtPage;
