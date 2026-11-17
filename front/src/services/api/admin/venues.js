import { createAxiosInstanceWithInterceptor, userTypeAuth } from "../axios";

const api = createAxiosInstanceWithInterceptor("data", userTypeAuth.admin);

export const getVenuesApi = async (filters = {}) => {
  const response = await api.get("/api/v1/admin/venues", { params: filters });
  return response.data;
};

export const getVenueByIdApi = async (venueId) => {
  const response = await api.get(`/api/v1/admin/venues/${venueId}`);
  return response.data;
};

export const createVenueApi = async (venueData) => {
  const response = await api.post("/api/v1/admin/venues", venueData);
  return response.data;
};

export const updateVenueApi = async (venueId, venueData) => {
  const response = await api.put(`/api/v1/admin/venues/${venueId}`, venueData);
  return response.data;
};

export const deleteVenueApi = async (venueId) => {
  const response = await api.delete(`/api/v1/admin/venues/${venueId}`);
  return response.data;
};
