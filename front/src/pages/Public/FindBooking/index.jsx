import { Link } from "react-router";
import { CircleAlert, Hash, Loader2, Search, UserRound } from "lucide-react";

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

import { useFindBookingPageHooks } from "./hooks";
import PublicLayout from "../../../components/layout/PublicLayout";
import { PHONE_PLACEHOLDER } from "../../../utils/phoneFormat";

const cardStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

const iconPrefix = "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2";
const mutedIcon = { color: "var(--color-text-muted)" };
const hintStyle = { fontSize: 12.5, color: "var(--color-text-muted)" };

/**
 * `/booking` (CR-030) — Find my booking: for a player without their booking's
 * link (no email, lost it). The code from the booking plus the phone or email
 * it was made with opens `/booking/:manageToken`.
 */
const FindBookingPage = () => {
  const { form, handleFind, isFinding, findError } = useFindBookingPageHooks();

  return (
    <PublicLayout signIn>
      <div className="space-y-4">
        <div className="pt-2 pb-1">
          <h1
            className="m-0 font-semibold leading-tight"
            style={{ fontSize: 28, letterSpacing: "-0.5px", color: "var(--color-text-dark)" }}
          >
            Find my booking
          </h1>
          <p className="m-0 mt-1.5" style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
            Open your booking to pay, check in, move or cancel it.
          </p>
        </div>

        <div className="p-5" style={cardStyle}>
          <Form {...form}>
            <form onSubmit={handleFind} noValidate className="space-y-4">
              <FormField
                control={form.control}
                name="bookingCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Booking code <span style={{ color: "var(--color-error)" }}>*</span>
                    </FormLabel>
                    <div className="relative">
                      <Hash className={iconPrefix} style={mutedIcon} />
                      <FormControl>
                        <Input
                          placeholder="e.g., K7QM2P"
                          className="h-11 pl-9 uppercase"
                          autoComplete="off"
                          autoCapitalize="characters"
                          spellCheck={false}
                          maxLength={16}
                          {...field}
                        />
                      </FormControl>
                    </div>
                    <p className="m-0" style={hintStyle}>
                      On your confirmation email, or ask the front desk.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contact"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Phone or email <span style={{ color: "var(--color-error)" }}>*</span>
                    </FormLabel>
                    <div className="relative">
                      <UserRound className={iconPrefix} style={mutedIcon} />
                      <FormControl>
                        <Input
                          placeholder={`${PHONE_PLACEHOLDER} or you@email.com`}
                          className="h-11 pl-9"
                          autoComplete="email"
                          maxLength={255}
                          {...field}
                        />
                      </FormControl>
                    </div>
                    <p className="m-0" style={hintStyle}>
                      The one you gave when you booked.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {findError && (
                <p
                  role="alert"
                  className="m-0 flex items-start gap-2 p-3"
                  style={{
                    fontSize: 13.5,
                    color: "var(--color-error)",
                    border: "1px solid var(--color-line)",
                    borderRadius: 12,
                    background: "var(--color-surface)",
                  }}
                >
                  <CircleAlert className="size-4 shrink-0 mt-0.5" />
                  {findError}
                </p>
              )}

              <Button type="submit" size="lg" className="w-full h-11" disabled={isFinding}>
                {isFinding ? <Loader2 className="animate-spin" /> : <Search />}
                Find my booking
              </Button>
            </form>
          </Form>
        </div>

        {/* PLAN-006: a signed-in player's bookings are all in My games */}
        <p className="m-0 text-center" style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
          Signed in with Google?{" "}
          <Link to="/me/games" style={{ color: "var(--color-link)", fontWeight: 500 }}>
            See all your bookings in My games
          </Link>
        </p>
        <p className="m-0 text-center" style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
          Not booked yet?{" "}
          <Link to="/book" style={{ color: "var(--color-link)", fontWeight: 500 }}>
            Book a court
          </Link>
        </p>
      </div>
    </PublicLayout>
  );
};

export default FindBookingPage;
