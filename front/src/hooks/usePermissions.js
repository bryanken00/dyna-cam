import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { getUserPermissions } from "../services/api/admin/permissions";

/**
 * Hook for checking user permissions. Permissions always come from the API.
 *
 * The helpers and returned object are memoized so consumers (ProtectedRoute, page
 * hooks, sidebar) get stable references and don't re-render / recompute on every render.
 */
export const usePermissions = () => {
  const { data, isLoading, error } = useQuery({
    queryKey: ["userPermissions"],
    queryFn: getUserPermissions,
    staleTime: 10 * 60 * 1000, // 10 minutes
    retry: 1,
  });

  // Stable array reference while `data` is unchanged.
  const permissions = useMemo(() => data?.permissions || [], [data]);

  /**
   * Check if user has specific permission.
   */
  const hasPermission = useCallback(
    (module, submodule = null, accessLevel = "read") => {
      const permission = permissions.find(
        (p) => p.module === module && p.submodule === submodule,
      );

      if (!permission) return false;

      const accessLevels = { none: 0, read: 1, write: 2 };
      return accessLevels[permission.accessLevel] >= accessLevels[accessLevel];
    },
    [permissions],
  );

  /**
   * Check if user has module access
   */
  const hasModuleAccess = useCallback(
    (module) => {
      return permissions.some(
        (p) => p.module === module && p.submodule === null,
      );
    },
    [permissions],
  );

  /**
   * Check if user has any permission in a submodule
   */
  const hasSubmoduleAccess = useCallback(
    (module, submodule) => {
      return permissions.some(
        (p) => p.module === module && p.submodule === submodule,
      );
    },
    [permissions],
  );

  /**
   * Get all permissions for a module
   */
  const getModulePermissions = useCallback(
    (module) => permissions.filter((p) => p.module === module),
    [permissions],
  );

  /**
   * Check if user has any of the specified permissions
   */
  const hasAnyPermission = useCallback(
    (perms) => {
      return perms.some(({ module, submodule, accessLevel }) =>
        hasPermission(module, submodule, accessLevel),
      );
    },
    [hasPermission],
  );

  const role = useMemo(
    () =>
      data
        ? {
            roleId: data.roleId,
            roleName: data.roleName,
            description: data.description,
          }
        : null,
    [data],
  );

  return useMemo(
    () => ({
      permissions,
      role,
      hasPermission,
      hasModuleAccess,
      hasSubmoduleAccess,
      getModulePermissions,
      hasAnyPermission,
      isLoading,
      error,
    }),
    [
      permissions,
      role,
      hasPermission,
      hasModuleAccess,
      hasSubmoduleAccess,
      getModulePermissions,
      hasAnyPermission,
      isLoading,
      error,
    ],
  );
};
