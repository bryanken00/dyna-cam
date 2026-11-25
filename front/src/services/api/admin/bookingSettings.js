import { createAxiosInstanceWithInterceptor, userTypeAuth } from "../axios";

const api = createAxiosInstanceWithInterceptor("data", userTypeAuth.admin);

// PLAN-003: a venue's booking setup — rules, opening hours, rates, online link

export const getBookingSettingsApi = async (venueId) => {
  const response = await api.get(`/api/v1/admin/booking-settings/${venueId}`);
  return response.data;
};

export const updateBookingSettingsApi = async (venueId, settings) => {
  const response = await api.put(`/api/v1/admin/booking-settings/${venueId}`, settings);
  return response.data;
};

export const issueBookingLinkApi = async (venueId) => {
  const response = await api.post(`/api/v1/admin/booking-settings/${venueId}/link`);
  return response.data;
};

export const turnOffBookingLinkApi = async (venueId) => {
  const response = await api.delete(`/api/v1/admin/booking-settings/${venueId}/link`);
  return response.data;
};

// CR-038: turn the venue's TV court board on / issue a new link → { displayUrl }
export const issueDisplayLinkApi = async (venueId) => {
  const response = await api.post(`/api/v1/admin/booking-settings/${venueId}/display-link`);
  return response.data;
};

// CR-038: turn the TV court board off
export const turnOffDisplayLinkApi = async (venueId) => {
  const response = await api.delete(`/api/v1/admin/booking-settings/${venueId}/display-link`);
  return response.data;
};

// CR-043: confirm the weekly schedule through the end of next week → { schedule }
export const confirmScheduleWeekApi = async (venueId) => {
  const response = await api.post(`/api/v1/admin/booking-settings/${venueId}/confirm-week`);
  return response.data;
};

// CR-043: venues with online booking whose next week isn't confirmed → { reminders }
export const getScheduleRemindersApi = async () => {
  const response = await api.get(`/api/v1/admin/booking-settings/schedule-reminders`);
  return response.data;
};

// CR-043: undo next week's confirmation while nobody has booked it → { schedule }
export const unconfirmScheduleWeekApi = async (venueId) => {
  const response = await api.post(`/api/v1/admin/booking-settings/${venueId}/unconfirm-week`);
  return response.data;
};
