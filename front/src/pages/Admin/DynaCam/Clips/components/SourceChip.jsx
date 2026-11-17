import { CLIP_SOURCE_LABEL } from "../../../../../utils/dynaCam";

/**
 * A clip's source as a small neutral pill: QR scan / Button / Staff /
 * Session. A session part also says which part it is ("Session · part 3").
 */
const SourceChip = ({ source, partIndex }) => {
  const label = CLIP_SOURCE_LABEL[source] || source || "-";
  const isPart =
    source === "SESSION" && partIndex !== null && partIndex !== undefined;
  return (
    <span
      className="inline-flex items-center whitespace-nowrap"
      style={{
        fontSize: 12,
        fontWeight: 500,
        padding: "2px 9px",
        borderRadius: 999,
        border: "1px solid var(--color-line)",
        background: "var(--color-surface-sunken)",
        color: "var(--color-text-secondary)",
      }}
    >
      {isPart ? `${label} · part ${Number(partIndex) + 1}` : label}
    </span>
  );
};

export default SourceChip;
