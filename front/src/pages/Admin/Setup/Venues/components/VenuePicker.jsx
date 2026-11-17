import { Link } from "react-router";
import { ChevronRight, MapPin } from "lucide-react";
import PageHeader from "../../../../../components/PageHeader";
import Spinner from "../../../../../components/Spinner";
import StatusDot from "../../../../../components/StatusDot";
import { decodeHTML } from "../../../../../utils/decode-html";
import { venuePath } from "../../../../../utils/dynaCam";
import { useGetCourtOptions } from "../../../../../services/requests/admin/courts";

/**
 * For users who can manage courts but not venues: pick a venue to open its
 * courts. The list comes from the Courts options (venues/courts read).
 */
const VenuePicker = () => {
  const { data, isLoading } = useGetCourtOptions();
  const venues = data?.data?.venues || [];

  return (
    <div className="p-8 space-y-5">
      <PageHeader
        title="Venues"
        subtitle="Pick a venue to set up its courts and cameras."
      />
      <div
        className="bg-surface overflow-hidden"
        style={{
          border: "1px solid var(--color-line)",
          borderRadius: "var(--radius-card)",
        }}
      >
        {isLoading ? (
          <Spinner className="py-16" />
        ) : venues.length === 0 ? (
          <p
            className="m-0 py-16 text-center"
            style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}
          >
            No venues yet
          </p>
        ) : (
          venues.map((venue, i) => (
            <Link
              key={venue.venueId}
              to={venuePath(venue.venueId)}
              className="flex items-center gap-3 px-4.5 py-3.5 transition-colors hover:bg-(--color-surface-sunken)"
              style={{
                borderTop: i === 0 ? "none" : "1px solid var(--color-line-soft)",
              }}
            >
              <MapPin
                className="w-4 h-4 shrink-0"
                style={{ color: "var(--color-text-muted)" }}
              />
              <span
                className="flex-1 min-w-0 truncate"
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: "var(--color-text-dark)",
                }}
              >
                {decodeHTML(venue.name)}
              </span>
              {venue.status !== "Active" && (
                <StatusDot tone="muted">{venue.status}</StatusDot>
              )}
              <ChevronRight
                className="w-4 h-4 shrink-0"
                style={{ color: "var(--color-text-muted)" }}
              />
            </Link>
          ))
        )}
      </div>
    </div>
  );
};

export default VenuePicker;
