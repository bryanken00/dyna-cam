// Player clip page — no login, read-only. See ./courts.js for the axios notes.
import axiosInstance from "../axios";

export const getPublicClipApi = async (shareToken) => {
  const response = await axiosInstance.get(
    `/api/v1/public/clips/${shareToken}`,
  );
  return response.data;
};
