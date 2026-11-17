import { useCallback, useMemo } from "react";
import { useGetMyPermissions } from "@/services/requests/permissions";

const LEVELS = { none: 0, read: 1, write: 2 };

/**
 * The signed-in user's permissions, with the same check the web portal's
 * `usePermissions().hasPermission` and the API's `checkPermission()` make:
 * a row for exactly (module, submodule) whose accessLevel is at least the
 * one asked for. `submodule` is `null` for whole-module permissions (clips,
 * payments).
 *
 *   const { can } = usePermissions();
 *   can("clips")                       // read
 *   can("clips", null, "write")        // Save clip now, book, cancel
 *   can("venues", "courts")            // Courts screen
 *
 * While loading (or after an error) `can()` is false, so nothing the user may
 * not use is ever shown; the API refuses it anyway.
 */
export const usePermissions = () => {
  const query = useGetMyPermissions();

  const permissions = useMemo(
    () => query.data?.data?.permissions ?? [],
    [query.data],
  );

  const can = useCallback(
    (module, submodule = null, accessLevel = "read") => {
      const row = permissions.find(
        (p) => p.module === module && (p.submodule ?? null) === submodule,
      );
      return Boolean(row) && LEVELS[row.accessLevel] >= LEVELS[accessLevel];
    },
    [permissions],
  );

  return {
    can,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    isRefetching: query.isRefetching,
  };
};

export default usePermissions;
