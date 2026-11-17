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

// Camera addresses are write-only. cameraRtspUrl / camera2RtspUrl: omitted
// or "" keeps the stored one; removeCamera / removeCamera2: true clears it.
// streamLayout "CAM2" / "STACKED" needs camera 2 (400 otherwise).
export const updateCourtApi = async (courtId, courtData) => {
  const response = await api.put(`/api/v1/admin/courts/${courtId}`, courtData);
  return response.data;
};

// The camera setup page is open: the venue's recorder box sends a preview
// picture of each camera (camera and camera2) every ~30 s for the next 2
// minutes (call again while open)
export const requestCourtPreviewApi = async (courtId) => {
  const response = await api.post(`/api/v1/admin/courts/${courtId}/preview`);
  return response.data;
};

export const rotateCourtQrApi = async (courtId) => {
  const response = await api.post(`/api/v1/admin/courts/${courtId}/rotate-qr`);
  return response.data;
};

// CR-001 Google Drive: returns { url } — Google's consent screen. Google sends
// the browser back to the court setup page with ?drive=connected|cancelled|error
export const connectCourtDriveApi = async (courtId) => {
  const response = await api.post(
    `/api/v1/admin/courts/${courtId}/google-drive/connect`,
  );
  return response.data;
};

// CR-001: stop copying this court's recordings to Google Drive
export const disconnectCourtDriveApi = async (courtId) => {
  const response = await api.delete(
    `/api/v1/admin/courts/${courtId}/google-drive`,
  );
  return response.data;
};

export const deleteCourtApi = async (courtId) => {
  const response = await api.delete(`/api/v1/admin/courts/${courtId}`);
  return response.data;
};
