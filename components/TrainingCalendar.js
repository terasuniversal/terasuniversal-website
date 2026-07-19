"use client";

import { useMemo, useState } from "react";

const sessions = [
  { date: "2026-08-06", course: "Working at Height", location: "Kedah", mode: "Public Programme", seats: 12, status: "Upcoming" },
  { date: "2026-08-14", course: "Scaffolding Competency", location: "Kedah", mode: "Practical Training", seats: 8, status: "Upcoming" },
  { date: "2026-08-21", course: "Confined Space Safety", location: "Client Site", mode: "In-House Training", seats: 20, status: "Upcoming" },
  { date: "2026-07-04", course: "Safety Passport", location: "Kedah", mode: "Public Programme", seats: 0, status: "Completed" },
];

const dateLabel = (date, options = {}) => new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", ...options }).format(new Date(`${date}T00:00:00`));

export default function TrainingCalendar() {
  const [view, setView] = useState("List");
  const [filter, setFilter] = useState("Upcoming");
  const visibleSessions = useMemo(() => sessions.filter((session) => filter === "All" || session.status === filter), [filter]);
  const monthLabel = new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric" }).format(new Date("2026-08-01T00:00:00"));

  return <section className="calendar-tool" aria-labelledby="calendar-title">
    <div className="calendar-toolbar"><div><span className="eyebrow">Training Calendar</span><h2 id="calendar-title">Plan the right learning window.</h2><p>Browse scheduled public programmes and use the list as a starting point for corporate planning.</p></div><div className="calendar-controls"><label><span className="sr-only">Session status</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option>Upcoming</option><option>Completed</option><option>All</option></select></label><div className="calendar-view-tabs" role="tablist" aria-label="Calendar view">{["Month", "Week", "List"].map((item) => <button key={item} type="button" role="tab" aria-selected={view === item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item}</button>)}</div></div></div>
    {view === "Month" && <div className="calendar-month-view"><div className="calendar-month-heading"><strong>{monthLabel}</strong><span>Scheduled sessions are shown below.</span></div><div className="calendar-month-grid">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span className="calendar-day-name" key={day}>{day}</span>)}{Array.from({ length: 31 }, (_, index) => { const day = String(index + 1).padStart(2, "0"); const match = visibleSessions.find((session) => session.date === `2026-08-${day}`); return <div className={`calendar-day ${match ? "has-session" : ""}`} key={day}><b>{index + 1}</b>{match && <small>{match.course}</small>}</div>; })}</div></div>}
    {view === "Week" && <div className="calendar-week-view"><div className="calendar-week-heading"><strong>Week of 3 August 2026</strong><span>Review the next scheduled delivery windows.</span></div><div className="calendar-week-grid">{["Mon 3", "Tue 4", "Wed 5", "Thu 6", "Fri 7", "Sat 8", "Sun 9"].map((day) => <div key={day}><span>{day}</span>{day === "Thu 6" && visibleSessions[0] ? <article><b>{visibleSessions[0].course}</b><small>{visibleSessions[0].mode}</small></article> : <em>No session</em>}</div>)}</div></div>}
    {view === "List" && <div className="calendar-list">{visibleSessions.length ? visibleSessions.map((session) => <article className="calendar-session" key={`${session.date}-${session.course}`}><time dateTime={session.date}>{dateLabel(session.date)}</time><div><h3>{session.course}</h3><p>{session.mode} · {session.location}</p></div><strong className={session.seats > 0 ? "seats-available" : "seats-complete"}>{session.seats > 0 ? `${session.seats} seats available` : "Completed"}</strong><a className="btn btn-outline" href="/request-proposal">Enquire</a></article>) : <p className="calendar-empty">No sessions match this filter yet.</p>}</div>}
  </section>;
}
