import { createAxiosInstanceWithInterceptor, userTypeAuth } from "../axios";

const api = createAxiosInstanceWithInterceptor("data", userTypeAuth.admin);

export const getDevicesApi = async (filters = {}) => {
  const response = await api.get("/api/v1/admin/devices", { params: filters });
  return response.data;
};

// Live venues for the Devices venue picker/filter (venues/devices permission)
export const getDeviceOptionsApi = async () => {
  const response = await api.get("/api/v1/admin/devices/options");
  return response.data;
};

export const getDeviceByIdApi = async (deviceId) => {
  const response = await api.get(`/api/v1/admin/devices/${deviceId}`);
  return response.data;
};

export const updateDeviceApi = async (deviceId, deviceData) => {
  const response = await api.put(
    `/api/v1/admin/devices/${deviceId}`,
    deviceData,
  );
  return response.data;
};

export const revokeDeviceApi = async (deviceId) => {
  const response = await api.post(`/api/v1/admin/devices/${deviceId}/revoke`);
  return response.data;
};

export const deleteDeviceApi = async (deviceId) => {
  const response = await api.delete(`/api/v1/admin/devices/${deviceId}`);
  return response.data;
};
