import { createAxiosInstanceWithInterceptor, userTypeAuth } from "../axios";

const api = createAxiosInstanceWithInterceptor("data", userTypeAuth.admin);

// PLAN-003: closures — a court or the whole venue can't be booked for a while

export const getClosuresApi = async (filters = {}) => {
  const response = await api.get("/api/v1/admin/closures", { params: filters });
  return response.data;
};

export const createClosureApi = async (closure) => {
  const response = await api.post("/api/v1/admin/closures", closure);
  return response.data;
};

export const updateClosureApi = async (closureId, closure) => {
  const response = await api.put(`/api/v1/admin/closures/${closureId}`, closure);
  return response.data;
};

export const deleteClosureApi = async (closureId) => {
  const response = await api.delete(`/api/v1/admin/closures/${closureId}`);
  return response.data;
};
