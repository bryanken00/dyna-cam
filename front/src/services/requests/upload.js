import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { uploadImageApi, deleteFileApi } from "../api/upload";

// Mutation: Upload an image. Resolves to { success, message, data: { path, url } }
// — save `data.url` (the signed link) on the record; the API reduces it to the path.
export const useUploadImage = () => {
  return useMutation({
    mutationFn: uploadImageApi,
    onError: (error) => {
      toast.error(error.response?.data?.message || "Failed to upload image");
    },
  });
};

// Mutation: Delete an uploaded file. Best-effort clean-up — no toast either way.
export const useDeleteFile = () => {
  return useMutation({
    mutationFn: deleteFileApi,
  });
};
