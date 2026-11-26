import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";

import PublicLayout from "../../../components/layout/PublicLayout";
import ResultState from "../../../components/ResultState";
import Spinner from "../../../components/Spinner";
import GoogleSignInButton from "../../../components/player/GoogleSignInButton";
import {
  useGetPlayerMe,
  useProfileRedirect,
  useStartPlayerSession,
} from "../../../services/requests/public/player";

/** Only a player page of this app — never another site. */
const safeNext = (value) =>
  typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/me/games";

/** Why the API sent the player back without a sign-in. */
const ERRORS = {
  cancelled: {
    title: "Sign-in cancelled",
    description: "You didn't finish signing in with Google. Nothing changed.",
  },
  refused: {
    title: "We can't sign you in with this account",
    description:
      "Use a Google account with a confirmed email address, or ask the venue for help. You can still book at the desk.",
  },
  expired: {
    title: "That sign-in took too long",
    description: "Please sign in again.",
  },
  off: {
    title: "Signing in isn't available right now",
    description: "Please try again later, or call the venue to book.",
  },
  failed: {
    title: "Couldn't sign you in",
    description: "Google didn't answer as expected. Please try again.",
  },
};

/**
 * `/signed-in` (PLAN-006): where Google's sign-in lands (via the API). With a
 * `code`, trade it for a session and go on to `next` (the page the player
 * started from); with an `error`, say why and offer to try again. A first
 * sign-in goes to the profile first (name and phone), then on to `next`.
 */
const SignedInPage = () => {
  const [params] = useSearchParams();
  const start = useStartPlayerSession();
  const started = useRef(false);
  const [signedIn, setSignedIn] = useState(false);

  const code = params.get("code");
  const next = safeNext(params.get("next"));
  const error = code ? null : ERRORS[params.get("error")] || ERRORS.failed;
  // Once signed in: the profile first if it's not complete (first sign-in), else `next`
  const { data: me, isError: meFailed, isFetching: meLoading } = useGetPlayerMe();
  const profilePath = useProfileRedirect(next);

  useEffect(() => {
    // Once: the code works a single time (React's development double-run included)
    if (!code || started.current) return;
    started.current = true;
    start.mutate(code, { onSuccess: () => setSignedIn(true) });
  }, [code, start]);

  if (signedIn && !meLoading && (me || meFailed)) {
    return <Navigate to={profilePath || next} replace />;
  }

  const failed = error || (start.isError && ERRORS.expired);

  return (
    <PublicLayout>
      {failed ? (
        <ResultState
          status="error"
          title={failed.title}
          description={failed.description}
          action={
            <div className="flex flex-col items-center gap-2">
              <GoogleSignInButton returnPath={next} />
              <Button asChild variant="ghost">
                <Link to={next} replace>
                  <ArrowLeft />
                  Go back
                </Link>
              </Button>
            </div>
          }
        />
      ) : (
        <Spinner className="py-24" tip="Signing you in…" />
      )}
    </PublicLayout>
  );
};

export default SignedInPage;
