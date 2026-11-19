"use client";

import { useMemo, useState } from "react";
import { enquiryHref } from "./public/PrimaryCtaGroup";
import { describeSession } from "../lib/session-display";
import { calendarContent } from "../content/en/calendar";
import kit from "./premium/premium.module.css";
import styles from "./calendar/calendar.module.css";

// Data-driven training calendar. Sessions come from the live CMS
// (course_schedules) via the parent server page — this component never
// hardcodes dates, so nothing here can drift out of date or fabricate
// sessions that don't exist in the source of truth.
// Session labels, fee text (zero and missing fees are never shown as a price), venue fallback, availability and the
// Register / Full / Enquire action come from the shared policy in lib/session-display.ts (Phase S3), the same one the
// homepage and the course pages use. Register is offered only when the server's registration_available flag allows it.
// Phase S4A: Hybrid Premium V2 presentation (public kit + calendar.module.css) and copy from content/en/calendar.js; the
// filter, view and data logic is unchanged. The page adds `courseSlug` and `duration` to each session from the catalogue
// (CRM identity first, then the public slug), so links use the public course route.

const todayString = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const sessionCourseSlug = (session) => session.courseSlug ?? session.slug ?? undefined;

const actionHref = (session, view) => {
  if (view.action.type === "register") return view.action.href;
  if (view.action.type === "details") return sessionCourseSlug(session) ? `/training/${sessionCourseSlug(session)}` : null;
  return enquiryHref({ course: sessionCourseSlug(session), session: session.start_date, source: "calendar" });
};

function isUpcoming(session) {
  return session.start_date >= todayString();
}

function isLiveStatus(session) {
  return session.status !== "cancelled" && session.status !== "completed";
}

function StateBox({ state, alert = false }) {
  return (
    <div className={styles.state} role={alert ? "alert" : undefined}>
      <strong>{state.title}</strong>
      <p>{state.text}</p>
      <a className={kit.btn} href={state.cta.href}>{state.cta.label}</a>
    </div>
  );
}

function SessionList({ sessions }) {
  const text = calendarContent.tool;
  if (!sessions.length) return <StateBox state={calendarContent.states.noMatch} />;

  const today = todayString();
  return (
    <ol className={styles.list}>
      {sessions.map((session) => {
        const view = describeSession(session, { today });
        const href = actionHref(session, view);
        const courseSlug = sessionCourseSlug(session);
        return (
          <li key={session.id}>
            <article className={`${styles.session} ${view.state === "closed" ? styles.closed : ""}`}>
              <time className={styles.date} dateTime={session.start_date}>
                <b>{view.dayText}</b>
                <span>{view.dateText}{view.timeText ? ` · ${view.timeText}` : ""}</span>
              </time>
              <div className={styles.course}>
                <h3>{courseSlug ? <a href={`/training/${courseSlug}`}>{session.title}</a> : session.title}</h3>
                <p>{[session.duration, view.state !== "closed" ? view.seatsText : null].filter(Boolean).join(" · ")}</p>
              </div>
              <p className={styles.fact}>{text.venueLabel}<b>{view.venueText}</b></p>
              {view.state !== "closed"
                ? <p className={styles.fact}>{text.feeLabel}<b>{view.feeShort}</b>{view.feeAmount ? view.feeUnit : null}</p>
                : <p className={styles.fact} aria-hidden="true" />}
              <div className={styles.action}>
                <span className={`${styles.pill} ${styles[`pill_${view.statusKey}`] ?? ""}`}>{view.statusLabel}</span>
                {href && <a className={`${kit.btn} ${view.action.type === "register" ? "" : styles.btnLine}`} href={href} aria-label={`${view.action.label}: ${session.title}, ${view.dateText}`}>{view.action.label}</a>}
              </div>
            </article>
          </li>
        );
      })}
    </ol>
  );
}

function MonthView({ sessions }) {
  const text = calendarContent.tool;
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
    <div className={styles.month}>
      <div className={styles.viewHead}><strong>{monthLabel}</strong><span>{text.monthNote}</span></div>
      <div className={styles.monthGrid}>
        {text.weekdays.map((day) => <span className={styles.dayName} key={day}>{day}</span>)}
        {cells.map((cell, index) => (
          <div className={`${styles.day} ${cell && cell.matches.length ? styles.hasSession : ""}`} key={cell ? cell.iso : `blank-${index}`}>
            {cell && (
              <>
                <b>{cell.day}</b>
                {cell.matches.slice(0, 2).map((match) => <small key={match.id}>{match.title}</small>)}
                {cell.matches.length > 2 && <small className={styles.more}>{text.more(cell.matches.length - 2)}</small>}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function WeekView({ sessions }) {
  const text = calendarContent.tool;
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
    <div className={styles.week}>
      <div className={styles.viewHead}><strong>{text.weekPrefix} {weekLabel}</strong><span>{text.weekNote}</span></div>
      <div className={styles.weekGrid}>
        {days.map((day) => (
          <div key={day.iso}>
            <span>{day.label}</span>
            {day.matches.length ? day.matches.map((match) => (
              <article key={match.id}><b>{match.title}</b><small>{match.delivery_mode ?? text.trainingSession}</small></article>
            )) : <em>{text.noSession}</em>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TrainingCalendar({ sessions = [], courseSlug, courseId, loadError = false }) {
  const text = calendarContent.tool;
  const [view, setView] = useState("List");
  const [filter, setFilter] = useState("Upcoming");

  const visibleSessions = useMemo(() => {
    const courseSessions = courseId
      ? sessions.filter((session) => session.course_id === courseId)
      : courseSlug
        ? sessions.filter((session) => session.slug === courseSlug)
        : sessions;
    if (filter === "All") return courseSessions;
    if (filter === "Completed") return courseSessions.filter((session) => !isUpcoming(session) || session.status === "completed");
    return courseSessions.filter((session) => isUpcoming(session) && isLiveStatus(session));
  }, [courseSlug, filter, sessions]);

  return (
    <section id="calendar-sessions" className={`${kit.px} ${kit.tone} ${styles.tool}`} aria-labelledby="calendar-title">
      <div className={kit.wrap}>
        <div className={styles.toolbar}>
          <div>
            <p className={styles.eyebrow}>{text.eyebrow}</p>
            <h2 id="calendar-title">{text.title}</h2>
            <p className={styles.toolText}>{courseSlug ? text.textCourse : text.textAll}</p>
          </div>
          <div className={styles.controls}>
            <label className={styles.filter}>
              <span>{text.filterLabel}</span>
              <select value={filter} onChange={(event) => setFilter(event.target.value)}>{text.filters.map((option) => <option key={option}>{option}</option>)}</select>
            </label>
            <div className={styles.tabs} role="group" aria-label={text.viewsName}>{text.views.map((item) => <button key={item} type="button" aria-pressed={view === item} className={view === item ? styles.tabOn : ""} onClick={() => setView(item)}>{item}</button>)}</div>
          </div>
        </div>
        {loadError ? (
          <StateBox state={calendarContent.states.unavailable} alert />
        ) : sessions.length === 0 ? (
          <StateBox state={calendarContent.states.none} />
        ) : (
          <>
            {view === "Month" && <MonthView sessions={visibleSessions} />}
            {view === "Week" && <WeekView sessions={visibleSessions} />}
            {view === "List" && <SessionList sessions={visibleSessions} />}
          </>
        )}
      </div>
    </section>
  );
}
