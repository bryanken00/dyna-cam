/**
 * Request hooks — Recorder boxes (read-only; permission venues / devices)
 *
 * Demo mode: resolves from `constants/demo.js`, in the API's exact envelope.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { IS_DEMO } from "../../constants";
import { DEMO_DEVICES, demoDelay, demoPage } from "../../constants/demo";
import { getDevicesApi } from "../api/devices";

const KEY = "devices";

const demoList = ({ venueId, search, ...paging } = {}) => {
  const q = search?.toLowerCase();
  const rows = DEMO_DEVICES.filter(
    (d) =>
      (!venueId || d.venueId === venueId) &&
      (!q ||
        d.name.toLowerCase().includes(q) ||
        d.venueName.toLowerCase().includes(q)),
  );
  return demoPage("devices", "Recorder boxes retrieved successfully", rows, paging);
};

// ─────────────────────────────────────────────────────────────────────────────
// useGetDevices
// ─────────────────────────────────────────────────────────────────────────────
export const useGetDevices = (params = {}, options = {}) => {
  return useQuery({
    queryKey: [KEY, params],
    queryFn: async () => {
      if (IS_DEMO) {
        await demoDelay();
        return demoList(params);
      }
      return getDevicesApi(params);
    },
    placeholderData: keepPreviousData,
    ...options,
  });
};
