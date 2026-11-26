import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getActivityApi } from "../../api/backoffice/activity";

/** PLAN-008 phase E: the back office's audit trail → data.activity, data.actions, data.pagination */
export const useGetActivity = (params) =>
  useQuery({
    queryKey: ["backoffice", "activity", params],
    queryFn: () => getActivityApi(params),
    placeholderData: keepPreviousData,
  });
