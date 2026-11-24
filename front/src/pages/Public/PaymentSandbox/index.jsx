import dayjs from "dayjs";
import { ArrowLeft, CircleAlert, CircleCheck, CreditCard, FlaskConical, Loader2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

import { usePaymentSandboxPageHooks } from "./hooks";
import PublicLayout from "../../../components/layout/PublicLayout";
import ResultState from "../../../components/ResultState";
import Spinner from "../../../components/Spinner";
import { formatPeso } from "../../../utils/dynaCam";

const FOOTER = "Payment sandbox — for trying DGSports out. No real money moves.";

const cardStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

/**
 * `/payment-sandbox/:checkoutId` (CR-033) — the test checkout the booking pages
 * open instead of Xendit's while the API runs with PAYMENT_SANDBOX=true.
 */
const PaymentSandboxPage = () => {
  const { checkout, isLoading, isFetching, notFound, loadError, refetch, handlePay, isPaying, payError, goBack } =
    usePaymentSandboxPageHooks();

  if (isLoading) {
    return (
      <PublicLayout footer={FOOTER}>
        <Spinner className="py-24" tip="Loading…" />
      </PublicLayout>
    );
  }

  if (notFound) {
    return (
      <PublicLayout footer={FOOTER}>
        <ResultState
          status="404"
          title="This checkout doesn't exist"
          description="It may be out of date, or test payments are switched off. Go back to your booking and tap Pay again."
        />
      </PublicLayout>
    );
  }

  if (loadError || !checkout) {
    return (
      <PublicLayout footer={FOOTER}>
        <ResultState
          status="error"
          title="Couldn't load the checkout"
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

  const backButton = (
    <Button variant="outline" onClick={goBack}>
      <ArrowLeft />
      Back to my booking
    </Button>
  );

  if (checkout.status === "PAID") {
    return (
      <PublicLayout footer={FOOTER}>
        <ResultState
          icon={<CircleCheck className="w-6 h-6" strokeWidth={1.8} style={{ color: "var(--color-success)" }} />}
          title="Already paid"
          description={`${formatPeso(checkout.amount)} was paid on this test checkout.`}
          action={backButton}
        />
      </PublicLayout>
    );
  }

  if (checkout.status !== "PENDING") {
    return (
      <PublicLayout footer={FOOTER}>
        <ResultState
          status="404"
          title="This checkout has closed"
          description="It ran out of time, or the booking changed. Go back to your booking to see what's next."
          action={backButton}
        />
      </PublicLayout>
    );
  }

  return (
    <PublicLayout footer={FOOTER}>
      <div className="space-y-4">
        <div className="p-6 flex flex-col items-center gap-2 text-center" style={cardStyle}>
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1"
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.4px",
              textTransform: "uppercase",
              color: "var(--color-warning)",
              border: "1px solid var(--color-line)",
              borderRadius: 999,
              background: "var(--color-surface-sunken)",
            }}
          >
            <FlaskConical className="size-3.5" />
            Test mode
          </span>
          <h1
            className="m-0 font-semibold leading-tight"
            style={{ fontSize: 28, letterSpacing: "-0.5px", color: "var(--color-text-dark)" }}
          >
            Test checkout
          </h1>
          <p className="m-0" style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
            Stands in for the real payment page. Nothing is charged.
          </p>
        </div>

        <div className="p-5" style={cardStyle}>
          <div
            className="p-3.5 mb-5 flex items-center justify-between gap-3"
            style={{
              background: "var(--color-surface-sunken)",
              border: "1px solid var(--color-line)",
              borderRadius: 12,
            }}
          >
            <div className="min-w-0" style={{ fontSize: 13.5, color: "var(--color-text-dark)" }}>
              {checkout.description}
            </div>
            <span style={{ fontSize: 20, fontWeight: 600, color: "var(--color-text-dark)" }}>
              {formatPeso(checkout.amount)}
            </span>
          </div>

          <Button type="button" size="lg" className="w-full h-12" onClick={handlePay} disabled={isPaying}>
            {isPaying ? <Loader2 className="animate-spin" /> : <CreditCard />}
            Pay {formatPeso(checkout.amount)}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full h-12 mt-2"
            onClick={goBack}
            disabled={isPaying}
          >
            <ArrowLeft />
            Go back without paying
          </Button>

          {payError && (
            <p
              role="alert"
              className="m-0 mt-3 flex items-start gap-2"
              style={{ fontSize: 13.5, color: "var(--color-error)" }}
            >
              <CircleAlert className="size-4 shrink-0 mt-0.5" />
              {payError}
            </p>
          )}

          {checkout.expiresAt && (
            <p className="m-0 mt-3 text-center" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
              Pay by {dayjs(checkout.expiresAt).format("h:mm A")}, or the court is released.
            </p>
          )}
        </div>
      </div>
    </PublicLayout>
  );
};

export default PaymentSandboxPage;
