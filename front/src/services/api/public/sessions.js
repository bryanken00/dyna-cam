// Player session page — no login, read-only. See ./courts.js for the axios notes.
import axiosInstance from "../axios";

export const getPublicSessionApi = async (shareToken) => {
  const response = await axiosInstance.get(
    `/api/v1/public/sessions/${shareToken}`,
  );
  return response.data;
};
