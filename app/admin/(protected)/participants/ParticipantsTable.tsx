"use client";

import { useMemo, useState } from "react";
import { Badge, EmptyState } from "../../../../components/admin/ui";
import { formatMalaysiaDate } from "../../../../lib/date-time";

export function ParticipantsTable({ participants }: { participants: any[] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [year, setYear] = useState("all");
  const years = useMemo(() => [...new Set(participants.map((participant) => participant.course_schedules?.start_date?.slice(0, 4)).filter(Boolean))].sort().reverse(), [participants]);
  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return participants.filter((participant) => {
      const course = participant.course_schedules?.courses?.title ?? "";
      const searchable = [participant.full_name, participant.identity_no, participant.identity_last4, participant.company, course].filter(Boolean).join(" ").toLowerCase();
      return (!keyword || searchable.includes(keyword)) && (status === "all" || participant.status === status) && (year === "all" || participant.course_schedules?.start_date?.startsWith(year));
    });
  }, [participants, search, status, year]);

  return <>
    <div className="ta-toolbar ta-filter-bar">
      <input className="ta-filter-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama, no. IC atau kursus…" aria-label="Cari peserta" />
      <select value={year} onChange={(event) => setYear(event.target.value)} aria-label="Tapis mengikut tahun"><option value="all">Semua tahun</option>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select>
      <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Tapis mengikut status"><option value="all">Semua status</option><option value="registered">Berdaftar</option><option value="active">Aktif</option><option value="inactive">Tidak aktif</option></select>
      <span className="ta-filter-count">{filtered.length} daripada {participants.length} rekod</span>
    </div>
    {filtered.length ? <div className="ta-table-wrap"><table className="ta-table"><thead><tr><th>Peserta</th><th>Syarikat</th><th>Sesi latihan</th><th>Status</th><th>Didaftarkan</th></tr></thead><tbody>{filtered.map((participant) => <tr key={participant.id}><td><strong>{participant.full_name}</strong><div style={{ color: "var(--ta-muted)", fontSize: 12 }}>{participant.identity_last4 ? `ID berakhir ${participant.identity_last4}` : participant.identity_no ?? ""}</div></td><td>{participant.company ?? "—"}</td><td>{participant.course_schedules?.courses?.title ?? "Belum ditetapkan"}{participant.course_schedules?.start_date ? <div style={{ color: "var(--ta-muted)", fontSize: 12 }}>{new Date(`${participant.course_schedules.start_date}T00:00:00`).toLocaleDateString("ms-MY", { day: "numeric", month: "short", year: "numeric" })}</div> : null}</td><td><Badge status={participant.status ?? "registered"} /></td><td style={{ color: "var(--ta-muted)" }}>{participant.created_at ? formatMalaysiaDate(participant.created_at) : "—"}</td></tr>)}</tbody></table></div> : <EmptyState icon="🔎" message="Tiada rekod sepadan dengan carian atau penapis anda." />}
  </>;
}
