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
