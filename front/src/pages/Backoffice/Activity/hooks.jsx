import { useCallback, useMemo, useState } from "react";
import dayjs from "dayjs";

import { useGetActivity } from "../../../services/requests/backoffice/activity";
import { useGetAdmins } from "../../../services/requests/backoffice/admins";
import { useGetCompanies } from "../../../services/requests/backoffice/companies";
import { decodeHTML } from "../../../utils/decode-html";

/** "COMPANY_SUSPEND" → "Company suspend" (the filter and the table). */
export const actionLabel = (action) =>
  String(action || "")
    .toLowerCase()
    .split("_")
    .map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");

const EMPTY_FILTERS = { companyId: "", platformAdminId: "", action: "", dateFrom: "", dateTo: "" };

/**
 * PLAN-008 phase E: the back office's Activity page — every super-admin action
 * (sign-ins, company and super-admin changes), newest first, filtered by company,
 * super admin, action and dates.
 */
export const useActivityPage = () => {
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  const { data, isLoading, isFetching, error, refetch } = useGetActivity({
    page: pagination.current,
    pageSize: pagination.pageSize,
    ...filters,
  });
  // Filter choices: every company (first 100) and every super admin
  const companiesQuery = useGetCompanies({ page: 1, pageSize: 100 });
  const adminsQuery = useGetAdmins();

  const handleTableChange = useCallback((next) => {
    setPagination({ current: next.current, pageSize: next.pageSize });
  }, []);
  const handleFilter = useCallback((name, value) => {
    setFilters((prev) => ({ ...prev, [name]: value }));
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, []);
  const handleClearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, []);

  const columns = useMemo(
    () => [
      {
        title: "When",
        dataIndex: "dateCreated",
        key: "dateCreated",
        width: 180,
        render: (value) => (
          <span className="font-mono" style={{ fontSize: 12.5, color: "var(--color-text-secondary)" }}>
            {dayjs(value).format("MMM D, YYYY h:mm A")}
          </span>
        ),
      },
      {
        title: "Action",
        dataIndex: "action",
        key: "action",
        width: 190,
        render: (action) => (
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-dark)" }}>{actionLabel(action)}</span>
        ),
      },
      {
        title: "What",
        dataIndex: "description",
        key: "description",
        render: (description, record) => (
          <div className="min-w-0">
            <div className="truncate" style={{ fontSize: 13.5, color: "var(--color-text-dark)" }}>
              {decodeHTML(description) || "—"}
            </div>
            {record.company && (
              <div className="truncate" style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                {decodeHTML(record.company.name)}
              </div>
            )}
          </div>
        ),
      },
      {
        title: "Super admin",
        key: "admin",
        width: 220,
        render: (_, record) =>
          record.admin ? (
            <div className="min-w-0">
              <div className="truncate" style={{ fontSize: 13, color: "var(--color-text-dark)" }}>
                {decodeHTML(record.admin.name)}
              </div>
              <div className="truncate" style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                {record.admin.email}
              </div>
            </div>
          ) : (
            <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Unknown</span>
          ),
      },
      {
        title: "IP",
        dataIndex: "ipAddress",
        key: "ipAddress",
        width: 140,
        render: (ip) => (
          <span className="font-mono" style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            {ip || "—"}
          </span>
        ),
      },
    ],
    [],
  );

  // apiData = { success, message, data: { activity, actions, pagination } }
  return {
    data: data?.data?.activity || [],
    actions: data?.data?.actions || [],
    companies: companiesQuery.data?.data?.companies || [],
    admins: adminsQuery.data?.data?.admins || [],
    pagination: { ...pagination, total: data?.data?.pagination?.total || 0 },
    filters,
    isLoading,
    isFetching,
    error,
    refetch,
    columns,
    handleTableChange,
    handleFilter,
    handleClearFilters,
  };
};
