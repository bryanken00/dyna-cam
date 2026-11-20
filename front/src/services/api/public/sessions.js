// Player session page — no login, read-only. See ./courts.js for the axios notes.
import axiosInstance from "../axios";

export const getPublicSessionApi = async (shareToken) => {
  const response = await axiosInstance.get(
    `/api/v1/public/sessions/${shareToken}`,
  );
  return response.data;
};

// CR-025: Save the last `seconds` of the game from its page (the same save as
// the court device's). 201 { repeated: false } — a new save; 200 { repeated:
// true } — a double tap. 409 TOO_EARLY / TOO_MANY / NOT_RECORDING.
export const savePublicCaptureApi = async ({ shareToken, seconds }) => {
  const response = await axiosInstance.post(
    `/api/v1/public/sessions/${shareToken}/captures`,
    { seconds },
  );
  return response.data;
};
