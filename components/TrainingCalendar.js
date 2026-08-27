"use client";

import { useMemo, useState } from "react";
import { enquiryHref } from "./public/PrimaryCtaGroup";

// Data-driven training calendar. Sessions come from the live CMS
// (course_schedules) via the parent server page — this component never
// hardcodes dates, so nothing here can drift out of date or fabricate
// sessions that don't exist in the source of truth.

const STATUS_LABELS = {
  open: "Open",
  full: "Full",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const todayString = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const dateLabel = (date, options = {}) =>
  new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", ...options }).format(new Date(`${date}T00:00:00`));

const timeLabel = (time) =>
  new Intl.DateTimeFormat("en-MY", { hour: "numeric", minute: "2-digit" }).format(new Date(`2000-01-01T${time}`));

const seatsLabel = (session) => {
  if (session.status === "cancelled") return "Cancelled";
  if (session.status === "full" || (session.capacity > 0 && session.available_seats <= 0)) return "Full";
  if (session.capacity > 0) return `${session.available_seats} seats available`;
  return null;
};

const sessionUrl = (session) => (session.slug ? `/training/${session.slug}` : enquiryHref({ source: "calendar", session: session.start_date }));
const sessionCta = (session) => (session.slug ? "View Course Details" : "Enquire About This Session");

function isUpcoming(session) {
  return session.start_date >= todayString();
}

function isLiveStatus(session) {
  return session.status !== "cancelled" && session.status !== "completed";
}

function SessionList({ sessions }) {
  if (!sessions.length) {
    return (
      <div className="calendar-empty-state">
        <strong>No sessions match this view yet.</strong>
        <p>Public programme dates are confirmed as courses are arranged. Check back soon, or tell us your preferred timing and we will propose a plan.</p>
        <a className="btn btn-primary" href="/request-proposal">Request a Proposal</a>
      </div>
    );
  }

  return (
    <div className="calendar-list">
      {sessions.map((session) => {
        const seats = seatsLabel(session);
        return (
          <article className="calendar-session" key={session.id}>
            <time className="calendar-session-date" dateTime={session.start_date}>
              <strong>{dateLabel(session.start_date)}</strong>
              {session.end_date && session.end_date !== session.start_date && <span>– {dateLabel(session.end_date)}</span>}
              {session.start_time && <small>{timeLabel(session.start_time)}</small>}
            </time>
            <div>
              <h3>{session.title}</h3>
              <p>{[session.delivery_mode, session.venue].filter(Boolean).join(" · ") || "Venue to be confirmed"}</p>
            </div>
            <span className={`calendar-status is-${session.status}`}>{STATUS_LABELS[session.status] ?? session.status}</span>
            <strong className={seats === "Full" || session.status === "cancelled" ? "seats-complete" : "seats-available"}>{seats ?? "Seats to be confirmed"}</strong>
            <a className="btn btn-outline" href={sessionUrl(session)}>{sessionCta(session)}</a>
          </article>
        );
      })}
    </div>
  );
}

function MonthView({ sessions }) {
  const anchor = new Date();
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const monthLabel = new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric" }).format(anchor);
  const startDow = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < startDow; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({
      iso,
      day,
      matches: sessions.filter((session) => session.start_date === iso || session.end_date === iso),
    });
  }

  return (
    <div className="calendar-month-view">
      <div className="calendar-month-heading"><strong>{monthLabel}</strong><span>Scheduled sessions are shown below.</span></div>
      <div className="calendar-month-grid">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span className="calendar-day-name" key={day}>{day}</span>)}
        {cells.map((cell, index) => (
          <div className={`calendar-day ${cell && cell.matches.length ? "has-session" : ""}`} key={cell ? cell.iso : `blank-${index}`}>
            {cell && (
              <>
                <b>{cell.day}</b>
                {cell.matches.slice(0, 2).map((match) => <small key={match.id}>{match.title}</small>)}
                {cell.matches.length > 2 && <small className="calendar-day-more">+{cell.matches.length - 2} more</small>}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function WeekView({ sessions }) {
  const upcoming = sessions.find(isUpcoming);
  const base = upcoming ? new Date(`${upcoming.start_date}T00:00:00`) : new Date();
  const dow = (base.getDay() + 6) % 7;
  const monday = new Date(base.getFullYear(), base.getMonth(), base.getDate() - dow);
  const weekLabel = new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "long", year: "numeric" }).format(monday);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { iso, label: new Intl.DateTimeFormat("en-MY", { weekday: "short", day: "numeric" }).format(d), matches: sessions.filter((s) => s.start_date === iso || s.end_date === iso) };
  });

  return (
    <div className="calendar-week-view">
      <div className="calendar-week-heading"><strong>Week of {weekLabel}</strong><span>Review the next scheduled delivery windows.</span></div>
      <div className="calendar-week-grid">
        {days.map((day) => (
          <div key={day.iso}>
            <span>{day.label}</span>
            {day.matches.length ? day.matches.map((match) => (
              <article key={match.id}><b>{match.title}</b><small>{match.delivery_mode ?? "Training session"}</small></article>
            )) : <em>No session</em>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TrainingCalendar({ sessions = [], courseSlug }) {
  const [view, setView] = useState("List");
  const [filter, setFilter] = useState("Upcoming");

  const visibleSessions = useMemo(() => {
    const courseSessions = courseSlug ? sessions.filter((session) => session.slug === courseSlug) : sessions;
    if (filter === "All") return courseSessions;
    if (filter === "Completed") return courseSessions.filter((session) => !isUpcoming(session) || session.status === "completed");
    return courseSessions.filter((session) => isUpcoming(session) && isLiveStatus(session));
  }, [courseSlug, filter, sessions]);

  return (
    <section className="calendar-tool" aria-labelledby="calendar-title">
      <div className="calendar-toolbar">
        <div><span className="eyebrow">Training Calendar</span><h2 id="calendar-title">Plan the right learning window.</h2><p>{courseSlug ? "Showing sessions for your selected course." : "Browse scheduled public programmes and use the list as a starting point for corporate planning."}</p></div>
        <div className="calendar-controls">
          <label><span className="sr-only">Session status</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option>Upcoming</option><option>Completed</option><option>All</option></select></label>
          <div className="calendar-view-tabs" role="group" aria-label="Calendar view">{["Month", "Week", "List"].map((item) => <button key={item} type="button" aria-pressed={view === item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item}</button>)}</div>
        </div>
      </div>
      {sessions.length === 0 ? (
        <div className="calendar-empty-state">
          <strong>No training dates published yet.</strong>
          <p>Public programme dates are confirmed as courses are arranged. Check back soon, or tell us your preferred timing and we will propose a plan.</p>
          <a className="btn btn-primary" href="/request-proposal">Request a Proposal</a>
        </div>
      ) : (
        <>
          {view === "Month" && <MonthView sessions={visibleSessions} />}
          {view === "Week" && <WeekView sessions={visibleSessions} />}
          {view === "List" && <SessionList sessions={visibleSessions} />}
        </>
      )}
    </section>
  );
}
