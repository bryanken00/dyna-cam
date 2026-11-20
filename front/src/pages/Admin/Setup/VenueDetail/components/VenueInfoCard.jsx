import { ImageOff } from "lucide-react";
import StatusDot from "../../../../../components/StatusDot";
import VenueIdCopy from "../../../../../components/VenueIdCopy";
import { decodeHTML } from "../../../../../utils/decode-html";
import { formatPhoneDisplay } from "../../../../../utils/phoneFormat";
import { formatPeso } from "../../../../../utils/dynaCam";
import { getImageUrl } from "../../../../../utils/upload";

/** One label/value pair in the info grid. */
const Fact = ({ label, children }) => (
  <div className="min-w-0">
    <div
      className="uppercase"
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: "0.08em",
        color: "var(--color-text-muted)",
      }}
    >
      {label}
    </div>
    <div
      className="mt-1 truncate"
      style={{ fontSize: 14, color: "var(--color-text-dark)" }}
    >
      {children}
    </div>
  </div>
);

/** The venue's details at the top of its page (edit via the venue drawer). */
const VenueInfoCard = ({ venue }) => {
  const logo = getImageUrl(venue.logoUrl);
  const courts = Number(venue.courtCount) || 0;
  const boxes = Number(venue.deviceCount) || 0;
  const price = Number(venue.clipPrice) || 0;

  return (
    <div
      className="flex gap-5 flex-wrap p-5"
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-line)",
        borderRadius: "var(--radius-card)",
      }}
    >
      <span
        className="inline-flex items-center justify-center overflow-hidden shrink-0"
        style={{
          width: 72,
          height: 72,
          borderRadius: 12,
          border: "1px solid var(--color-line)",
          background: "var(--color-surface-sunken)",
          color: "var(--color-text-muted)",
        }}
      >
        {logo ? (
          <img src={logo} alt="" className="w-full h-full object-contain" />
        ) : (
          <ImageOff className="w-5 h-5" strokeWidth={1.6} />
        )}
      </span>

      <div className="flex-1 min-w-60 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-4">
        <Fact label="Address">{decodeHTML(venue.address) || "—"}</Fact>
        <Fact label="Phone">{formatPhoneDisplay(venue.phone) || "—"}</Fact>
        <Fact label="Clip price">{price > 0 ? formatPeso(price) : "Free"}</Fact>
        <Fact label="Keeps videos">
          {venue.clipRetentionDays} {Number(venue.clipRetentionDays) === 1 ? "day" : "days"}
        </Fact>
        <Fact label="Courts">{courts}</Fact>
        <Fact label="Recorder boxes">{boxes} active</Fact>
        <Fact label="Status">
          <StatusDot tone={venue.status === "Active" ? "success" : "muted"}>
            {venue.status}
          </StatusDot>
        </Fact>

        {/* Recorder boxes have no screen: they enrol with this ID */}
        <div className="col-span-full min-w-0">
          <div
            className="uppercase"
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: "0.08em",
              color: "var(--color-text-muted)",
            }}
          >
            Venue ID
          </div>
          <div className="mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap min-w-0">
            <VenueIdCopy venueId={venue.venueId} />
            <span style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
              Put this in the recorder box&apos;s <code className="font-mono">.env</code> as{" "}
              <code className="font-mono">VENUE_ID</code>.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VenueInfoCard;
