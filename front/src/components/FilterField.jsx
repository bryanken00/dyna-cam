/**
 * One labelled control in a list page's filter row: the uppercase micro-label
 * over a Select / SearchableSelect / DatePicker.
 */
const FilterField = ({ label, children }) => (
  <div className="flex flex-col gap-1.5">
    <span
      className="uppercase"
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.08em",
        color: "var(--color-text-muted)",
      }}
    >
      {label}
    </span>
    {children}
  </div>
);

export default FilterField;
