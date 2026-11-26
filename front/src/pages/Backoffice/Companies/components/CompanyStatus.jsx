/** Suspended / Active dot (tokens only). */
const CompanyStatus = ({ status }) => {
  const active = status === "Active";
  return (
    <span className="inline-flex items-center gap-2" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: active ? "var(--color-success)" : "var(--color-warning)",
        }}
      />
      {status}
    </span>
  );
};

export default CompanyStatus;
