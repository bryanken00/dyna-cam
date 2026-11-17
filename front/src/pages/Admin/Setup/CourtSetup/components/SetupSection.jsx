/**
 * One section card on the court setup page: title + short description on
 * the left, an optional status/aside on the right, then the content.
 */
const SetupSection = ({ id, title, description, aside, children }) => (
  <section
    id={id}
    className="scroll-mt-6"
    style={{
      background: "var(--color-surface)",
      border: "1px solid var(--color-line)",
      borderRadius: "var(--radius-card)",
    }}
  >
    <div
      className="flex items-start justify-between gap-3 flex-wrap px-5 py-4"
      style={{ borderBottom: "1px solid var(--color-line)" }}
    >
      <div className="min-w-0">
        <h2
          className="m-0 font-semibold"
          style={{ fontSize: 16, color: "var(--color-text-dark)" }}
        >
          {title}
        </h2>
        {description && (
          <p
            className="m-0 mt-0.5"
            style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
          >
            {description}
          </p>
        )}
      </div>
      {aside && <div className="shrink-0">{aside}</div>}
    </div>
    <div className="p-5">{children}</div>
  </section>
);

export default SetupSection;
