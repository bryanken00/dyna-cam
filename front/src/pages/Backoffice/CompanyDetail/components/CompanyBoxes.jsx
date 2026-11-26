import dayjs from "dayjs";

import DataTable from "../../../../components/DataTable";
import SectionLabel from "../../../../components/SectionLabel";
import { decodeHTML } from "../../../../utils/decode-html";

const columns = [
  {
    title: "Box",
    dataIndex: "name",
    key: "name",
    render: (name, record) => (
      <div className="min-w-0">
        <div className="truncate" style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-dark)" }}>
          {decodeHTML(name)}
        </div>
        <div className="truncate" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
          {decodeHTML(record.venueName)}
        </div>
      </div>
    ),
  },
  {
    title: "Status",
    key: "online",
    width: 140,
    render: (_, record) => {
      const label = record.status !== "Active" ? record.status : record.online ? "Online" : "Offline";
      const color = record.status !== "Active"
        ? "var(--color-text-muted)"
        : record.online
          ? "var(--color-success)"
          : "var(--color-warning)";
      return (
        <span className="inline-flex items-center gap-2" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />
          {label}
        </span>
      );
    },
  },
  {
    title: "Last seen",
    dataIndex: "lastSeenAt",
    key: "lastSeenAt",
    width: 190,
    render: (value) => (
      <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
        {value ? dayjs(value).format("MMM D, YYYY h:mm A") : "Never"}
      </span>
    ),
  },
  {
    title: "Agent",
    dataIndex: "agentVersion",
    key: "agentVersion",
    width: 110,
    render: (v) => (
      <span className="font-mono" style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
        {v || "—"}
      </span>
    ),
  },
];

/** PLAN-008 phase F: the company's recorder boxes (venue, online / offline, last seen). */
const CompanyBoxes = ({ boxes = [] }) => (
  <div
    className="overflow-hidden"
    style={{ background: "var(--color-surface)", border: "1px solid var(--color-line)", borderRadius: "var(--radius-card)" }}
  >
    <div className="px-6 pt-5">
      <SectionLabel>Recorder boxes</SectionLabel>
    </div>
    <DataTable
      dataSource={boxes}
      columns={columns}
      rowKey="deviceId"
      scroll={{ x: 640 }}
      emptyText="No boxes yet — make an enroll key and set a box up with it"
    />
  </div>
);

export default CompanyBoxes;
