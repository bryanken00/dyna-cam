// A player's own live stream (PLAN-002 Phase G) — no login; the setup code in
// the URL is the credential. See ./courts.js for the axios notes.
//
// The stream key only ever travels in a PUT body: never in a URL, a query
// string or anything that is logged.
import axiosInstance from "../axios";

// { setup: { courtName, venueName, startAt, endAt, sessionStatus, expiresAt,
//   expiresInSeconds }, stream: { platform, status, message, maskedUrl,
//   updatedAt } | null } · 404 unknown / expired code or the session has ended
export const getStreamSetupApi = async (code) => {
  const response = await axiosInstance.get(
    `/api/v1/public/stream-setup/${encodeURIComponent(code)}`,
  );
  return response.data;
};

// { platform: "FACEBOOK"|"YOUTUBE", streamKey } or { platform: "OTHER", url }
// → 200 { stream } · 400 field errors · 404 as above · 409 the session has ended
export const saveStreamSetupApi = async (code, data) => {
  const response = await axiosInstance.put(
    `/api/v1/public/stream-setup/${encodeURIComponent(code)}`,
    data,
  );
  return response.data;
};

// Stop → 200 { stream: null }
export const stopStreamSetupApi = async (code) => {
  const response = await axiosInstance.delete(
    `/api/v1/public/stream-setup/${encodeURIComponent(code)}`,
  );
  return response.data;
};
