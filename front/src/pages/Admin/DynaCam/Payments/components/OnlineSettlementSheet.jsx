import { useState } from "react";
import { CircleAlert, Landmark, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import DatePicker from "../../../../../components/DatePicker";
import FilterField from "../../../../../components/FilterField";
import Spinner from "../../../../../components/Spinner";
import { decodeHTML } from "../../../../../utils/decode-html";
import { formatPeso, manilaNow } from "../../../../../utils/dynaCam";
import { useGetSettlement } from "../../../../../services/requests/admin/payments";

const cell = { fontSize: 13.5, color: "var(--color-text-dark)", padding: "10px 12px", textAlign: "right" };
const head = {
  fontSize: 12,
  fontWeight: 500,
  color: "var(--color-text-muted)",
  padding: "8px 12px",
  textAlign: "right",
  borderBottom: "1px solid var(--color-line)",
};

/**
 * PLAN-003 Phase F — Online settlement: every venue's online (Xendit) booking
 * money paid in a date range. It all lands in Dyna Cam's one Xendit balance,
 * and this is the statement to settle with each venue from. Read-only.
 * Props: `{ open, onClose }`.
 */
const OnlineSettlementSheet = ({ open, onClose }) => {
  const today = manilaNow().date;
  const [dateFrom, setDateFrom] = useState(`${today.slice(0, 8)}01`);
  const [dateTo, setDateTo] = useState(today);

  const { data, isLoading, error } = useGetSettlement({ dateFrom, dateTo }, { enabled: open });
  const statement = data?.data || null;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 p-0 sm:max-w-200"
        style={{ background: "var(--color-surface)" }}
      >
        <SheetTitle className="sr-only">Online settlement</SheetTitle>
        <SheetDescription className="sr-only">
          Online booking payments per venue for a date range
        </SheetDescription>

        <div className="flex h-full flex-col">
          <div className="flex-1 overflow-y-auto p-6">
            <div className="flex items-start justify-between gap-3 mb-6">
              <div className="flex items-center gap-3 min-w-0">
                <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl shrink-0 bg-(image:--gradient-primary)">
                  <Landmark className="w-5.5 h-5.5 text-white" />
                </span>
                <div className="min-w-0">
                  <h2
                    className="m-0 font-semibold leading-tight"
                    style={{ fontSize: 19, color: "var(--color-text-dark)" }}
                  >
                    Online settlement
                  </h2>
                  <p className="m-0 mt-0.5" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                    Bookings paid online through Xendit, per venue — what each venue is owed.
                  </p>
                </div>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close">
                <X />
              </Button>
            </div>

            <div className="flex items-end gap-3 flex-wrap mb-5">
              <FilterField label="From">
                <DatePicker
                  className="w-40"
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </FilterField>
              <FilterField label="To">
                <DatePicker
                  className="w-40"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </FilterField>
            </div>

            {isLoading && <Spinner className="py-16" tip="Loading…" />}
            {error && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle>Couldn&apos;t load the statement</AlertTitle>
                <AlertDescription>
                  {error.response?.data?.message || "Please try again."}
                </AlertDescription>
              </Alert>
            )}

            {statement && statement.venues.length === 0 && (
              <p className="m-0 py-10 text-center" style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>
                No online payments in this period.
              </p>
            )}

            {statement && statement.venues.length > 0 && (
              <div
                className="overflow-x-auto"
                style={{ border: "1px solid var(--color-line)", borderRadius: 10 }}
              >
                <table className="w-full" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ ...head, textAlign: "left" }}>Venue</th>
                      <th style={head}>Payments</th>
                      <th style={head}>Collected</th>
                      <th style={head}>Refunded</th>
                      <th style={head}>Refund failed</th>
                      <th style={head}>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.venues.map((v) => (
                      <tr key={v.venueId} style={{ borderBottom: "1px solid var(--color-line)" }}>
                        <td style={{ ...cell, textAlign: "left", fontWeight: 500 }}>{decodeHTML(v.venueName)}</td>
                        <td style={cell}>{v.payments}</td>
                        <td style={cell}>{formatPeso(v.collected)}</td>
                        <td style={cell}>{formatPeso(v.refunded)}</td>
                        <td
                          style={{
                            ...cell,
                            color: v.refundFailed > 0 ? "var(--color-error)" : "var(--color-text-muted)",
                          }}
                        >
                          {v.refundFailed > 0 ? `${formatPeso(v.refundFailed)} (${v.refundFailedCount})` : "—"}
                        </td>
                        <td style={{ ...cell, fontWeight: 600 }}>{formatPeso(v.net)}</td>
                      </tr>
                    ))}
                    <tr style={{ background: "var(--color-surface-sunken)" }}>
                      <td style={{ ...cell, textAlign: "left", fontWeight: 600 }}>All venues</td>
                      <td style={cell}>{statement.totals.payments}</td>
                      <td style={cell}>{formatPeso(statement.totals.collected)}</td>
                      <td style={cell}>{formatPeso(statement.totals.refunded)}</td>
                      <td style={cell}>
                        {statement.totals.refundFailed > 0 ? formatPeso(statement.totals.refundFailed) : "—"}
                      </td>
                      <td style={{ ...cell, fontWeight: 600 }}>{formatPeso(statement.totals.net)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            <p className="m-0 mt-4" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
              By the date each booking was paid. Net leaves out refunds still owed to players (Refund failed) —
              repay those, then mark them in Payments. Xendit&apos;s own fees aren&apos;t taken off here.
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default OnlineSettlementSheet;
