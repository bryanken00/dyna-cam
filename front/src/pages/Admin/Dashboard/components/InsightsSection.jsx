import { Link } from "react-router";

import CategoryBarChart from "../../../../components/charts/CategoryBarChart";
import ChartCard from "../../../../components/charts/ChartCard";
import SectionLabel from "../../../../components/SectionLabel";
import Spinner from "../../../../components/Spinner";
import StatCard from "../../../../components/StatCard";

const PERIODS = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
];

/** Last 7 days / Last 30 days — a two-button switch. */
const PeriodSwitch = ({ value, onChange }) => (
  <div
    role="group"
    aria-label="Period"
    className="inline-flex p-0.5 gap-0.5"
    style={{
      background: "var(--color-surface-sunken)",
      border: "1px solid var(--color-line)",
      borderRadius: 10,
    }}
  >
    {PERIODS.map((p) => {
      const on = p.days === value;
      return (
        <button
          key={p.days}
          type="button"
          aria-pressed={on}
          onClick={() => onChange(p.days)}
          className="px-3 py-1 transition-colors"
          style={{
            fontSize: 12.5,
            fontWeight: on ? 600 : 500,
            borderRadius: 8,
            background: on ? "var(--color-surface)" : "transparent",
            color: on ? "var(--color-text-dark)" : "var(--color-text-secondary)",
            border: on ? "1px solid var(--color-line)" : "1px solid transparent",
          }}
        >
          {p.label}
        </button>
      );
    })}
  </div>
);

/** A stat card that opens a page (e.g. Not paid yet → Sessions, Unpaid). */
const LinkedCard = ({ to, ...card }) => (
  <Link
    to={to}
    className="block h-full no-underline rounded-(--radius-card) transition-shadow hover:ring-2 hover:ring-(--color-line)"
    title="Open these games in Sessions"
  >
    <StatCard {...card} />
  </Link>
);

/**
 * CR-023: how the courts were used over the last 7 or 30 days — five cards
 * (games played, average game length, recorded per day, not paid yet, cash)
 * and three charts (games per day, peak hours, busiest days). Presentational:
 * everything comes from the Dashboard's `useInsights` (hooks.jsx).
 */
const InsightsSection = ({ insights }) => {
  const {
    period,
    setPeriod,
    cards,
    perDay,
    perDayText,
    byHour,
    busiestHourText,
    byWeekday,
    busiestDayText,
    isLoading,
    error,
  } = insights;

  return (
    <section className="space-y-3.5" aria-label="Insights">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <SectionLabel>Insights</SectionLabel>
        <PeriodSwitch value={period} onChange={setPeriod} />
      </div>

      {error ? (
        <p className="m-0" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          {error.response?.data?.message || "Couldn't load the insights."}
        </p>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3.5">
            {cards.map((card) =>
              card.to ? (
                <LinkedCard key={card.title} {...card} />
              ) : (
                <StatCard key={card.title} {...card} />
              )
            )}
          </div>

          <ChartCard title="Games per day" subtitle={perDayText} height={240}>
            <CategoryBarChart data={perDay} valueLabel="games" />
          </ChartCard>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            <ChartCard title="Peak hours" subtitle={busiestHourText} height={220}>
              <CategoryBarChart data={byHour} valueLabel="games started" />
            </ChartCard>
            <ChartCard title="Busiest days" subtitle={busiestDayText} height={220}>
              <CategoryBarChart data={byWeekday} valueLabel="games" />
            </ChartCard>
          </div>
        </>
      )}
    </section>
  );
};

export default InsightsSection;
