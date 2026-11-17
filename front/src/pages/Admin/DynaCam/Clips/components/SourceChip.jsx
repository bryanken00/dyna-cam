import { CLIP_SOURCE_LABEL } from "../../../../../utils/dynaCam";

/** A clip's source as a small neutral pill: QR scan / Button / Staff / Session. */
const SourceChip = ({ source }) => (
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
    {CLIP_SOURCE_LABEL[source] || source || "-"}
  </span>
);

export default SourceChip;
