import { ArrowLeft, CircleAlert, KeyRound, Pause, Pencil, Play } from "lucide-react";
import { Link } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import DescriptionList from "../../../components/DescriptionList";
import PageHeader from "../../../components/PageHeader";
import RefreshButton from "../../../components/RefreshButton";
import ResultState from "../../../components/ResultState";
import SectionLabel from "../../../components/SectionLabel";
import Spinner from "../../../components/Spinner";
import StatCard from "../../../components/StatCard";
import { decodeHTML } from "../../../utils/decode-html";
import { formatPhoneDisplay } from "../../../utils/phoneFormat";
import CompanyFormDrawer from "../Companies/components/CompanyFormDrawer";
import TemporaryPasswordDialog from "../Companies/components/TemporaryPasswordDialog";
import CompanyStatus from "../Companies/components/CompanyStatus";
import { useCompanyDetail } from "./hooks";

const card = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "var(--radius-card)",
};

/** PLAN-008 phase B: one company — details, counts, its Owner and the actions. */
const CompanyDetailPage = () => {
  const {
    company,
    isLoading,
    isFetching,
    error,
    notFound,
    refetch,
    editOpen,
    handleEdit,
    handleEditClose,
    handleSuspend,
    handleReactivate,
    handleResetOwner,
    isChangingStatus,
    isResetting,
    shownPassword,
    handleClosePassword,
  } = useCompanyDetail();

  const back = (
    <Link
      to="/backoffice/companies"
      className="inline-flex items-center gap-1.5 hover:underline"
      style={{ fontSize: 13, color: "var(--color-link)" }}
    >
      <ArrowLeft className="w-4 h-4" />
      Companies
    </Link>
  );

  if (isLoading) return <Spinner className="py-24" tip="Loading the company…" />;
  if (notFound) {
    return (
      <div className="p-4 sm:p-8 space-y-4">
        {back}
        <ResultState status="404" title="Company not found" description="It may have been removed." />
      </div>
    );
  }
  if (error || !company) {
    return (
      <div className="p-4 sm:p-8 space-y-4">
        {back}
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Error loading the company</AlertTitle>
          <AlertDescription>{error?.response?.data?.message || error?.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const suspended = company.status === "Suspended";
  const counts = company.counts || {};

  return (
    <div className="p-4 sm:p-8 space-y-5">
      {back}
      <PageHeader
        title={decodeHTML(company.name)}
        subtitle={company.isDefault ? "The default company — everything from before companies existed." : `Link: ${company.slug}`}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <RefreshButton onRefresh={refetch} isFetching={isFetching} />
            <Button variant="outline" onClick={handleEdit}>
              <Pencil />
              Edit
            </Button>
            {suspended ? (
              <Button onClick={handleReactivate} disabled={isChangingStatus}>
                <Play />
                Reactivate
              </Button>
            ) : (
              <Button variant="destructive" onClick={handleSuspend} disabled={isChangingStatus}>
                <Pause />
                Suspend
              </Button>
            )}
          </div>
        }
      />

      {suspended && (
        <Alert>
          <CircleAlert />
          <AlertTitle>Suspended</AlertTitle>
          <AlertDescription>
            Its staff can&apos;t sign in and its venues take no online bookings. Bookings and games already made stay.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
        <StatCard title="Venues" value={counts.venues ?? 0} change="not deleted" />
        <StatCard title="Courts" value={counts.courts ?? 0} change="not deleted" />
        <StatCard title="Boxes online" value={`${counts.boxesOnline ?? 0}/${counts.boxes ?? 0}`} change="recorder boxes" />
        <StatCard title="Bookings" value={counts.bookingsThisMonth ?? 0} change="this month" />
        <StatCard title="Games" value={counts.gamesThisMonth ?? 0} change="this month" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="p-6" style={card}>
          <SectionLabel>Company</SectionLabel>
          <DescriptionList
            items={[
              { label: "Name", value: decodeHTML(company.name) },
              { label: "Link", value: <span className="font-mono">{company.slug}</span> },
              { label: "Status", value: <CompanyStatus status={company.status} /> },
              { label: "Contact email", value: company.contactEmail || "—" },
              { label: "Contact phone", value: company.contactPhone ? formatPhoneDisplay(company.contactPhone) : "—" },
            ]}
          />
        </div>
        <div className="p-6" style={card}>
          <div className="flex items-start justify-between gap-3">
            <SectionLabel>Owner</SectionLabel>
            {company.owner && (
              <Button variant="outline" size="sm" onClick={handleResetOwner} disabled={isResetting}>
                <KeyRound />
                Reset password
              </Button>
            )}
          </div>
          {company.owner ? (
            <DescriptionList
              items={[
                { label: "Name", value: `${decodeHTML(company.owner.firstName)} ${decodeHTML(company.owner.lastName)}` },
                { label: "Email", value: company.owner.email },
                {
                  label: "Password",
                  value: company.owner.mustChangePassword ? "Temporary — not signed in yet" : "Chosen by the Owner",
                },
              ]}
            />
          ) : (
            <p className="m-0" style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>
              This company has no Owner account.
            </p>
          )}
        </div>
      </div>

      <CompanyFormDrawer open={editOpen} entity={company} onClose={handleEditClose} onSuccess={handleEditClose} />
      <TemporaryPasswordDialog
        open={!!shownPassword}
        onClose={handleClosePassword}
        email={shownPassword?.email}
        password={shownPassword?.password}
      />
    </div>
  );
};

export default CompanyDetailPage;
