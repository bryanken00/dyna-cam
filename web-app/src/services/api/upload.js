import { createAxiosInstanceWithInterceptor, userTypeAuth } from "./axios";

const api = createAxiosInstanceWithInterceptor("data", userTypeAuth.admin);
const apiMultipart = createAxiosInstanceWithInterceptor(
  "multipart",
  userTypeAuth.admin,
);

/**
 * Upload user avatar
 */
export const uploadAvatarApi = async (file) => {
  const formData = new FormData();
  formData.append("avatar", file);
  const response = await apiMultipart.post("/api/v1/upload/avatar", formData);
  return response.data;
};

/**
 * Upload generic image
 */
export const uploadImageApi = async (file) => {
  const formData = new FormData();
  formData.append("file", file);
  const response = await apiMultipart.post("/api/v1/upload/image", formData);
  return response.data;
};

/**
 * Delete uploaded file
 */
export const deleteFileApi = async (filePath) => {
  const response = await api.delete("/api/v1/upload/file", {
    data: { path: filePath },
  });
  return response.data;
};
