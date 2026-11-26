import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { ExternalLink, MapPinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import "leaflet/dist/leaflet.css";

/**
 * CR-050: pin a venue on a map — OpenStreetMap tiles through Leaflet (free, no API
 * key; Google doesn't offer a draggable pin without a paid key). Click the map or
 * drag the pin to place it; "Open in Google Maps" checks the spot (a keyless link).
 *
 * When there's no pin yet and the address changes (`focusQuery`, e.g. "San Juan,
 * Taytay, Rizal"), the map moves there using OpenStreetMap's free place search
 * (Nominatim) — only the place name is sent.
 *
 * Props: `{ latitude, longitude, onChange(lat, lng) | onChange(null, null), focusQuery, focusZoom }`
 * — latitude / longitude are numbers or null.
 */

const PHILIPPINES = { center: [12.8797, 121.774], zoom: 5 };
const PIN_ZOOM = 17;

// A pin drawn in CSS (Leaflet's default marker images break under bundlers); token colours
const PIN_ICON = L.divIcon({
  className: "",
  html: `<svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <path d="M15 1C7.3 1 1 7.2 1 14.9 1 25.3 15 39 15 39s14-13.7 14-24.1C29 7.2 22.7 1 15 1z"
      fill="var(--color-brand-blue)" stroke="var(--color-surface)" stroke-width="2"/>
    <circle cx="15" cy="15" r="5" fill="var(--color-surface)"/></svg>`,
  iconSize: [30, 40],
  iconAnchor: [15, 39],
});

const round6 = (n) => Math.round(n * 1e6) / 1e6;

/** Click anywhere → the pin goes there. */
const ClickToPin = ({ onPick }) => {
  useMapEvents({
    click: (e) => onPick(round6(e.latlng.lat), round6(e.latlng.lng)),
  });
  return null;
};

/** The map sits in a sliding drawer: re-measure once it's on screen. */
const FixSize = () => {
  const map = useMap();
  useEffect(() => {
    const id = setTimeout(() => map.invalidateSize(), 350);
    return () => clearTimeout(id);
  }, [map]);
  return null;
};

/** Move to the pin when it's typed in, or to the chosen place while there's no pin. */
const Focus = ({ pin, focusQuery, focusZoom }) => {
  const map = useMap();
  const lastPin = useRef(null);

  useEffect(() => {
    if (!pin) return;
    const key = pin.join(",");
    if (lastPin.current === key) return;
    lastPin.current = key;
    // Only re-centre when the pin is off screen (dragging keeps the view)
    if (!map.getBounds().contains(pin)) map.setView(pin, Math.max(map.getZoom(), 15));
  }, [map, pin]);

  useEffect(() => {
    if (pin || !focusQuery) return undefined;
    const controller = new AbortController();
    const url =
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ph&q=" +
      encodeURIComponent(focusQuery);
    const timer = setTimeout(() => {
      fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } })
        .then((res) => (res.ok ? res.json() : []))
        .then((found) => {
          const hit = Array.isArray(found) ? found[0] : null;
          if (hit) map.flyTo([Number(hit.lat), Number(hit.lon)], focusZoom, { duration: 0.8 });
        })
        .catch(() => {});
    }, 400); // wait for the dropdowns to settle
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [map, pin, focusQuery, focusZoom]);

  return null;
};

const VenueLocationPicker = ({ latitude, longitude, onChange, focusQuery = "", focusZoom = 14 }) => {
  const pin = useMemo(
    () => (Number.isFinite(latitude) && Number.isFinite(longitude) ? [latitude, longitude] : null),
    [latitude, longitude],
  );
  const start = pin ? { center: pin, zoom: PIN_ZOOM } : PHILIPPINES;
  const googleUrl = pin
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${pin[0]},${pin[1]}`)}`
    : null;

  return (
    <div className="space-y-2">
      <div
        className="overflow-hidden"
        style={{ height: 280, borderRadius: 12, border: "1px solid var(--color-line)", isolation: "isolate" }}
      >
        <MapContainer center={start.center} zoom={start.zoom} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
          <FixSize />
          <ClickToPin onPick={onChange} />
          <Focus pin={pin} focusQuery={focusQuery} focusZoom={focusZoom} />
          {pin && (
            <Marker
              position={pin}
              icon={PIN_ICON}
              draggable
              eventHandlers={{
                dragend: (e) => {
                  const p = e.target.getLatLng();
                  onChange(round6(p.lat), round6(p.lng));
                },
              }}
            />
          )}
        </MapContainer>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
          {pin ? "Drag the pin to adjust it." : "Click the map where the venue is to drop a pin."}
        </span>
        <div className="flex gap-2">
          {pin && (
            <Button type="button" variant="outline" size="sm" onClick={() => onChange(null, null)}>
              <MapPinOff />
              Clear pin
            </Button>
          )}
          {googleUrl && (
            <Button type="button" variant="outline" size="sm" asChild>
              <a href={googleUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink />
                Open in Google Maps
              </a>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default VenueLocationPicker;
