// CR-038: a venue's TV court board — no login; the display link's token is the
// credential. The plain axiosInstance sends no Authorization header.
import axiosInstance from "../axios";

// Today at the venue → { venue: { name, logoUrl }, date, now, hours,
//   courts: [{ key, name }], bookings: [{ courtKey, status, startAt, endAt }],
//   games: [{ courtKey, status, startAt, endAt, openEnded }], closures: [{ courtKey|null, startAt, endAt }] }
export const getCourtBoardApi = async (displayToken) => {
  const response = await axiosInstance.get(`/api/v1/public/board/${displayToken}`);
  return response.data;
};
