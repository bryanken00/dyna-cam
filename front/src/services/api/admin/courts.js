import { createAxiosInstanceWithInterceptor, userTypeAuth } from "../axios";

const api = createAxiosInstanceWithInterceptor("data", userTypeAuth.admin);

export const getCourtsApi = async (filters = {}) => {
  const response = await api.get("/api/v1/admin/courts", { params: filters });
  return response.data;
};

// Live venues for the Courts venue picker/filter (venues/courts permission)
export const getCourtOptionsApi = async () => {
  const response = await api.get("/api/v1/admin/courts/options");
  return response.data;
};

export const getCourtByIdApi = async (courtId) => {
  const response = await api.get(`/api/v1/admin/courts/${courtId}`);
  return response.data;
};

export const createCourtApi = async (courtData) => {
  const response = await api.post("/api/v1/admin/courts", courtData);
  return response.data;
};

export const updateCourtApi = async (courtId, courtData) => {
  const response = await api.put(`/api/v1/admin/courts/${courtId}`, courtData);
  return response.data;
};

export const rotateCourtQrApi = async (courtId) => {
  const response = await api.post(`/api/v1/admin/courts/${courtId}/rotate-qr`);
  return response.data;
};

export const deleteCourtApi = async (courtId) => {
  const response = await api.delete(`/api/v1/admin/courts/${courtId}`);
  return response.data;
};
