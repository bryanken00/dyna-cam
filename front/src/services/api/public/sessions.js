// Player session page — no login, read-only. See ./courts.js for the axios notes.
import axiosInstance from "../axios";

export const getPublicSessionApi = async (shareToken) => {
  const response = await axiosInstance.get(
    `/api/v1/public/sessions/${shareToken}`,
  );
  return response.data;
};

// CR-025: Save the last `seconds` of the game from its page (the same save as
// the court device's) — CR-029: `body` is { seconds } or { fromSeconds,
// toSeconds } (seconds into the game). 201 { repeated: false } — a new save;
// 200 { repeated: true } — a double tap. 409 TOO_EARLY / TOO_MANY /
// NOT_RECORDING; 400 BAD_RANGE.
export const savePublicCaptureApi = async ({ shareToken, body }) => {
  const response = await axiosInstance.post(
    `/api/v1/public/sessions/${shareToken}/captures`,
    body,
  );
  return response.data;
};

// CR-029: a signed link to replay the stretch from → to (seconds into the
// game) from the court's recorder → { preview: { hlsUrl, cameras?, fromSeconds,
// toSeconds } }. 503 when no recorder can serve it. ⚠️ The link is a secret.
export const getPublicPreviewApi = async ({ shareToken, from, to }) => {
  const response = await axiosInstance.get(
    `/api/v1/public/sessions/${shareToken}/preview`,
    { params: { from, to } },
  );
  return response.data;
};

// CR-028: the courtside device's controls on the game's page (the share link
// is the credential).

// End game — the game so far is saved. 409 once it has ended.
export const endPublicGameApi = async (shareToken) => {
  const response = await axiosInstance.post(
    `/api/v1/public/sessions/${shareToken}/end`,
  );
  return response.data;
};

// Delete Save N. `savedAt` is the save's savedAt as the page shows it — a save
// whose number moved (deleted elsewhere) answers 404 and nothing is deleted.
export const deletePublicCaptureApi = async ({ shareToken, number, savedAt }) => {
  const response = await axiosInstance.delete(
    `/api/v1/public/sessions/${shareToken}/captures/${number}`,
    { params: { savedAt } },
  );
  return response.data;
};

// A fresh setup link for the player's own Facebook / YouTube stream → { url }
export const getPublicStreamLinkApi = async (shareToken) => {
  const response = await axiosInstance.post(
    `/api/v1/public/sessions/${shareToken}/stream-link`,
  );
  return response.data;
};

// Stop the player's stream (the recording goes on)
export const stopPublicStreamApi = async (shareToken) => {
  const response = await axiosInstance.post(
    `/api/v1/public/sessions/${shareToken}/stream/stop`,
  );
  return response.data;
};
