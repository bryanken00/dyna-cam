import { CircleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import DataTable from "../../../components/DataTable";
import DatePicker from "../../../components/DatePicker";
import FilterField from "../../../components/FilterField";
import PageHeader from "../../../components/PageHeader";
import PaginationFooter from "../../../components/PaginationFooter";
import RefreshButton from "../../../components/RefreshButton";
import { decodeHTML } from "../../../utils/decode-html";
import { actionLabel, useActivityPage } from "./hooks";

const ALL = "all";

/** A Select filter where "all" stands for no filter (Radix items can't be ""). */
const SelectFilter = ({ value, onChange, placeholder, options }) => (
  <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
    <SelectTrigger className="h-10 w-55">
      <SelectValue placeholder={placeholder} />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value={ALL}>{placeholder}</SelectItem>
      {options.map((o) => (
        <SelectItem key={o.value} value={o.value}>
          {o.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

/** PLAN-008 phase E: what super admins did in the back office. */
const ActivityPage = () => {
  const {
    data,
    actions,
    companies,
    admins,
    pagination,
    filters,
    isLoading,
    isFetching,
    error,
    refetch,
    columns,
    handleTableChange,
    handleFilter,
    handleClearFilters,
  } = useActivityPage();
  const hasActiveFilters = Object.values(filters).some(Boolean);

  if (error) {
    return (
      <div className="p-4 sm:p-8">
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Error loading activity</AlertTitle>
          <AlertDescription>{error.response?.data?.message || error.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 space-y-5">
      <PageHeader
        title="Activity"
        subtitle="Every back-office action: sign-ins, company changes and super-admin changes. Company changes also show in that company's own audit trail."
      />

      <div className="bg-surface overflow-hidden" style={{ border: "1px solid var(--color-line)", borderRadius: "var(--radius-card)" }}>
        <div
          className="flex items-end gap-3 flex-wrap px-4.5 py-3.5"
          style={{ borderBottom: "1px solid var(--color-line)" }}
        >
          <FilterField label="Company">
            <SelectFilter
              value={filters.companyId}
              onChange={(v) => handleFilter("companyId", v)}
              placeholder="All companies"
              options={companies.map((c) => ({ value: c.companyId, label: decodeHTML(c.name) }))}
            />
          </FilterField>
          <FilterField label="Super admin">
            <SelectFilter
              value={filters.platformAdminId}
              onChange={(v) => handleFilter("platformAdminId", v)}
              placeholder="Everyone"
              options={admins.map((a) => ({
                value: a.platformAdminId,
                label: `${decodeHTML(a.firstName)} ${decodeHTML(a.lastName)}`,
              }))}
            />
          </FilterField>
          <FilterField label="Action">
            <SelectFilter
              value={filters.action}
              onChange={(v) => handleFilter("action", v)}
              placeholder="All actions"
              options={actions.map((a) => ({ value: a, label: actionLabel(a) }))}
            />
          </FilterField>
          <FilterField label="From">
            <DatePicker
              value={filters.dateFrom}
              max={filters.dateTo || undefined}
              onChange={(e) => handleFilter("dateFrom", e.target.value)}
              placeholder="Any date"
              className="h-10 w-44"
            />
          </FilterField>
          <FilterField label="To">
            <DatePicker
              value={filters.dateTo}
              min={filters.dateFrom || undefined}
              onChange={(e) => handleFilter("dateTo", e.target.value)}
              placeholder="Any date"
              className="h-10 w-44"
            />
          </FilterField>
          <div className="ml-auto flex items-center gap-3">
            {hasActiveFilters && (
              <button
                onClick={handleClearFilters}
                className="h-8 text-[13px] cursor-pointer hover:underline"
                style={{ color: "var(--color-link)" }}
              >
                Clear all
              </button>
            )}
            <RefreshButton onRefresh={refetch} isFetching={isFetching} />
          </div>
        </div>

        <DataTable
          dataSource={data}
          columns={columns}
          rowKey="auditId"
          loading={isLoading}
          scroll={{ x: 1000 }}
          emptyText="No activity matches these filters"
        />
        <PaginationFooter
          pagination={pagination}
          onChange={handleTableChange}
          noun="entry"
          nounPlural="entries"
        />
      </div>
    </div>
  );
};

export default ActivityPage;
