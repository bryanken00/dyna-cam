import { useState } from "react";
import dayjs from "dayjs";
import { Loader2, Megaphone, Pencil, Shuffle, Trash2, UserMinus, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import SectionLabel from "../../../../../components/SectionLabel";
import StatusDot from "../../../../../components/StatusDot";
import { confirm } from "../../../../../store/confirmStore";
import { decodeHTML } from "../../../../../utils/decode-html";
import { formatPeso } from "../../../../../utils/dynaCam";
import { FORMAT_LABEL } from "../../../../../utils/tournaments";
import {
  useAddStaffTeam,
  useCallMatch,
  useDeleteDivision,
  useGenerateDraw,
  useScheduleMatch,
  useScoreMatch,
  useSetTeamSeed,
  useWithdrawTeam,
} from "../../../../../services/requests/admin/tournaments";

const card = { background: "var(--color-surface)", border: "1px solid var(--color-line)", borderRadius: "var(--radius-card)" };
const NO_COURT = "none";
const TEAM_TONE = { Registered: "success", Pending: "warning", Withdrawn: "muted", Expired: "muted" };
const MATCH_TONE = { Pending: "muted", Ready: "warning", Playing: "success", Done: "muted", Bye: "muted" };

const levelText = (min, max) => (min && max ? `${min} – ${max}` : min ? `${min} and up` : max ? `Up to ${max}` : "All levels");
const roundName = (m, rounds) => {
  if (m.stage === "Group") return `Group ${m.groupNo} · Round ${m.round}`;
  const fromEnd = rounds - m.round;
  return fromEnd === 0 ? "Final" : fromEnd === 1 ? "Semi-final" : fromEnd === 2 ? "Quarter-final" : `Round ${m.round}`;
};

/** One match row: teams, court and time, call, score. */
const MatchRow = ({ m, label, courts, canWrite }) => {
  const schedule = useScheduleMatch();
  const call = useCallMatch();
  const score = useScoreMatch();
  const [a, setA] = useState(m.scoreA ?? "");
  const [b, setB] = useState(m.scoreB ?? "");
  const [when, setWhen] = useState(m.scheduledAt ? m.scheduledAt.slice(0, 16).replace(" ", "T") : "");
  const open = ["Ready", "Playing", "Pending"].includes(m.status);
  const saveSchedule = (courtId, at) =>
    schedule.mutate({ matchId: m.matchId, data: { courtId: courtId === NO_COURT ? null : courtId, scheduledAt: at ? at.replace("T", " ") : null } });

  return (
    <li className="p-3 space-y-2" style={{ border: "1px solid var(--color-line)", borderRadius: 10 }}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text-muted)" }}>{label}</span>
        <StatusDot tone={MATCH_TONE[m.status]}>{m.status === "Ready" ? "Ready to play" : m.status}</StatusDot>
      </div>
      <div style={{ fontSize: 14.5, color: "var(--color-text-dark)" }}>
        <strong style={{ fontWeight: m.winner && m.winner === m.teamA ? 700 : 500 }}>{decodeHTML(m.teamAName || "To be decided")}</strong>
        {m.status === "Bye" ? " · bye" : " vs "}
        {m.status !== "Bye" && (
          <strong style={{ fontWeight: m.winner && m.winner === m.teamB ? 700 : 500 }}>{decodeHTML(m.teamBName || "To be decided")}</strong>
        )}
        {m.status === "Done" && (
          <span className="font-mono" style={{ marginLeft: 8, color: "var(--color-text-secondary)" }}>
            {m.scoreA}–{m.scoreB}
          </span>
        )}
      </div>
      {canWrite && open && (
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={m.courtId || NO_COURT} onValueChange={(v) => saveSchedule(v, when)}>
            <SelectTrigger className="h-9 w-36" aria-label="Court">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_COURT}>No court</SelectItem>
              {courts.map((c) => (
                <SelectItem key={c.courtId} value={c.courtId}>
                  {decodeHTML(c.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="datetime-local"
            aria-label="Time"
            className="h-9 w-52"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            onBlur={() => when !== (m.scheduledAt || "").slice(0, 16).replace(" ", "T") && saveSchedule(m.courtId || NO_COURT, when)}
          />
          {m.status === "Ready" && (
            <Button size="sm" variant="outline" onClick={() => call.mutate({ matchId: m.matchId })} disabled={call.isPending || !m.courtId}>
              <Megaphone />
              Call
            </Button>
          )}
        </div>
      )}
      {canWrite && ["Ready", "Playing", "Done"].includes(m.status) && m.teamA && m.teamB && (
        <div className="flex items-center gap-2">
          <Input aria-label="Score A" inputMode="numeric" className="h-9 w-16 text-center" value={a} onChange={(e) => setA(e.target.value.replace(/\D/g, "").slice(0, 2))} />
          <span>–</span>
          <Input aria-label="Score B" inputMode="numeric" className="h-9 w-16 text-center" value={b} onChange={(e) => setB(e.target.value.replace(/\D/g, "").slice(0, 2))} />
          <Button
            size="sm"
            onClick={() => score.mutate({ matchId: m.matchId, data: { scoreA: Number(a), scoreB: Number(b) } })}
            disabled={score.isPending || a === "" || b === ""}
          >
            {score.isPending && <Loader2 className="animate-spin" />}
            {m.status === "Done" ? "Change score" : "Save score"}
          </Button>
        </div>
      )}
      {m.court && m.scheduledAt && (
        <div style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
          {decodeHTML(m.court)} · {dayjs(m.scheduledAt).format("ddd h:mm A")}
        </div>
      )}
    </li>
  );
};

/**
 * PLAN-009 phase E — one division on the tournament page: its teams (add one,
 * seed, withdraw), the draw, and its matches and group tables.
 * Props: `{ division, courts, canWrite, canRefund, editable, onEdit }`.
 */
const DivisionCard = ({ division: d, courts, canWrite, canRefund, editable, onEdit }) => {
  const draw = useGenerateDraw();
  const remove = useDeleteDivision();
  const addTeam = useAddStaffTeam();
  const withdraw = useWithdrawTeam();
  const seed = useSetTeamSeed();
  const [teamName, setTeamName] = useState("");
  const [names, setNames] = useState(["", ""]);

  const registered = d.teams.filter((t) => t.status === "Registered");
  const rounds = Math.max(0, ...d.matches.filter((m) => m.stage === "Knockout").map((m) => m.round));
  const handleDraw = async () => {
    const ok = await confirm({
      title: "Generate the draw?",
      description: `${registered.length} registered teams go into the draw. Registration for this division closes, and the draw can't be redone.`,
      confirmText: "Generate draw",
      cancelText: "Not yet",
    });
    if (ok) draw.mutate({ divisionId: d.divisionId });
  };
  const handleRemove = async () => {
    const ok = await confirm({ title: "Remove this division?", description: decodeHTML(d.name), confirmText: "Remove", cancelText: "Keep it", danger: true });
    if (ok) remove.mutate({ divisionId: d.divisionId });
  };
  const handleWithdraw = async (t) => {
    const paid = t.paymentStatus === "Paid";
    const ok = await confirm({
      title: paid ? "Withdraw and refund this team?" : "Withdraw this team?",
      description: paid ? `${decodeHTML(t.name)} paid ${formatPeso(t.price)} — it's refunded in full.` : decodeHTML(t.name),
      confirmText: paid ? "Withdraw and refund" : "Withdraw",
      cancelText: "Keep it",
      danger: true,
    });
    if (ok) withdraw.mutate({ tournamentTeamId: t.tournamentTeamId, refund: paid });
  };
  const handleAddTeam = (e) => {
    e.preventDefault();
    const players = names.slice(0, d.teamSize).map((x) => x.trim());
    if (!teamName.trim() || players.some((x) => !x)) return;
    addTeam.mutate(
      { divisionId: d.divisionId, data: { name: teamName.trim(), players } },
      {
        onSuccess: () => {
          setTeamName("");
          setNames(["", ""]);
        },
      },
    );
  };

  return (
    <section className="p-5 space-y-5" style={card}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="m-0 font-semibold" style={{ fontSize: 17, color: "var(--color-text-dark)" }}>
            {decodeHTML(d.name)}
          </h3>
          <p className="m-0 mt-0.5" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            {FORMAT_LABEL[d.format]}
            {d.format === "RoundRobinThenKnockout" ? ` · groups of ${d.groupSize}, top ${d.advancePerGroup} through` : ""} · {d.teamSize === 2 ? "doubles" : "singles"} ·{" "}
            {levelText(d.minLevel, d.maxLevel)} · {d.entryFee > 0 ? `${formatPeso(d.entryFee)} per team` : "free"} · games to {d.pointsToWin}, win by {d.winBy} ·{" "}
            {d.capacity - d.spotsLeft}/{d.capacity} teams
          </p>
        </div>
        {canWrite && (
          <div className="flex gap-2 flex-wrap">
            {!d.drawOut && editable && (
              <>
                <Button size="sm" variant="outline" onClick={() => onEdit(d)}>
                  <Pencil />
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={handleRemove} disabled={remove.isPending}>
                  <Trash2 />
                </Button>
              </>
            )}
            {!d.drawOut && (
              <Button size="sm" onClick={handleDraw} disabled={draw.isPending || registered.length < 2}>
                {draw.isPending ? <Loader2 className="animate-spin" /> : <Shuffle />}
                Generate draw
              </Button>
            )}
          </div>
        )}
      </div>

      <div>
        <SectionLabel>Teams · {registered.length} registered</SectionLabel>
        {d.teams.length === 0 ? (
          <p className="m-0" style={{ fontSize: 13.5, color: "var(--color-text-muted)" }}>
            No teams yet.
          </p>
        ) : (
          <ul className="m-0 p-0 list-none" style={{ border: "1px solid var(--color-line)", borderRadius: 10 }}>
            {d.teams.map((t, i) => (
              <li key={t.tournamentTeamId} className="flex items-center justify-between gap-3 px-3.5 py-2.5" style={{ borderTop: i ? "1px solid var(--color-line)" : "none" }}>
                <span className="min-w-0">
                  <span className="block truncate" style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-dark)" }}>
                    {decodeHTML(t.name)}
                  </span>
                  <span className="block truncate" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
                    {t.players.map((p) => decodeHTML(p.name)).join(" & ") || "—"}
                    {t.players.length < d.teamSize ? " · waiting for partner" : ""} ·{" "}
                    {t.paymentStatus === "Paid" ? `paid ${formatPeso(t.price)}` : t.paymentStatus === "Free" ? "free" : t.paymentStatus.toLowerCase()}
                    {t.addedByStaff ? " · added by staff" : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  {canWrite && !d.drawOut && t.status === "Registered" && (
                    <Input
                      aria-label={`Seed for ${decodeHTML(t.name)}`}
                      placeholder="Seed"
                      inputMode="numeric"
                      className="h-8 w-16 text-center"
                      defaultValue={t.seed ?? ""}
                      onBlur={(e) => {
                        const v = e.target.value.replace(/\D/g, "");
                        if (String(t.seed ?? "") !== v) seed.mutate({ tournamentTeamId: t.tournamentTeamId, data: { seed: v || null } });
                      }}
                    />
                  )}
                  <StatusDot tone={TEAM_TONE[t.status]}>{t.status}</StatusDot>
                  {canWrite && !d.drawOut && ["Pending", "Registered"].includes(t.status) && (t.paymentStatus !== "Paid" || canRefund) && (
                    <Button size="icon-sm" variant="ghost" aria-label={`Withdraw ${decodeHTML(t.name)}`} onClick={() => handleWithdraw(t)}>
                      <UserMinus className="w-4 h-4" />
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canWrite && !d.drawOut && editable && (
          <form onSubmit={handleAddTeam} className="flex gap-2 flex-wrap mt-3">
            <Input className="h-9 w-44" placeholder="Team name" value={teamName} onChange={(e) => setTeamName(e.target.value)} maxLength={60} aria-label="Team name" />
            {Array.from({ length: d.teamSize }, (_, i) => (
              <Input
                key={i}
                className="h-9 w-44"
                placeholder={`Player ${i + 1}`}
                value={names[i]}
                onChange={(e) => setNames((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                maxLength={100}
                aria-label={`Player ${i + 1}`}
              />
            ))}
            <Button type="submit" size="sm" variant="outline" className="h-9" disabled={addTeam.isPending}>
              <UserPlus />
              Add team
            </Button>
          </form>
        )}
      </div>

      {d.tables.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {d.tables.map((g) => (
            <div key={g.groupNo}>
              <SectionLabel>Group {g.groupNo}</SectionLabel>
              <table className="w-full" style={{ fontSize: 13.5, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
                    <th className="text-left font-medium py-1">Team</th>
                    <th className="font-medium">W</th>
                    <th className="font-medium">L</th>
                    <th className="font-medium">+/−</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.teamId} style={{ borderTop: "1px solid var(--color-line)" }}>
                      <td className="py-1.5 truncate">{decodeHTML(r.teamName)}</td>
                      <td className="text-center">{r.wins}</td>
                      <td className="text-center">{r.losses}</td>
                      <td className="text-center font-mono">{r.diff > 0 ? `+${r.diff}` : r.diff}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {d.matches.length > 0 && (
        <div>
          <SectionLabel>Matches</SectionLabel>
          <ul className="m-0 p-0 list-none grid gap-2 lg:grid-cols-2">
            {d.matches.map((m) => (
              <MatchRow key={m.matchId} m={m} label={roundName(m, rounds)} courts={courts} canWrite={canWrite} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

export default DivisionCard;
