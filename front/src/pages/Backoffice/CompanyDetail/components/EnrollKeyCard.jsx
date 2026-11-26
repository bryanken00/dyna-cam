import dayjs from "dayjs";
import { KeyRound, Power, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

import SectionLabel from "../../../../components/SectionLabel";

/**
 * PLAN-008 phase F: the company's recorder-box enroll key — on since … / off, and
 * Generate / Regenerate / Turn off. The key itself is never here (shown once in
 * EnrollKeyDialog). Props: `{ enrollKey: { on, createdAt }, onGenerate, onTurnOff, busy }`.
 */
const EnrollKeyCard = ({ enrollKey, onGenerate, onTurnOff, busy }) => {
  const on = Boolean(enrollKey?.on);
  return (
    <div
      className="p-6"
      style={{ background: "var(--color-surface)", border: "1px solid var(--color-line)", borderRadius: "var(--radius-card)" }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <SectionLabel>Box enroll key</SectionLabel>
        <div className="flex items-center gap-2">
          {on && (
            <Button variant="outline" size="sm" onClick={onTurnOff} disabled={busy}>
              <Power />
              Turn off
            </Button>
          )}
          <Button size="sm" onClick={onGenerate} disabled={busy}>
            {on ? <RefreshCw /> : <KeyRound />}
            {on ? "Regenerate" : "Generate key"}
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: on ? "var(--color-success)" : "var(--color-text-muted)",
          }}
        />
        <span style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-dark)" }}>
          {on ? `On since ${dayjs(enrollKey.createdAt).format("MMM D, YYYY h:mm A")}` : "Off"}
        </span>
      </div>
      <p className="m-0 mt-2" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
        {on
          ? "A recorder box with this key enrols into one of this company's venues. The key was shown once when it was made — Regenerate to get a new one (the old one stops; enrolled boxes keep working)."
          : "Make a key to set up this company's recorder boxes. It enrols boxes only into this company's venues."}
      </p>
    </div>
  );
};

export default EnrollKeyCard;
