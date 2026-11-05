import Link from "next/link";
import type { PublicSchedule } from "../../lib/public-content";
import kit from "../premium/premium.module.css";
import inner from "../premium/inner.module.css";
import SectionHead from "../premium/SectionHead";

const statusLabels: Record<string, string> = { open: "Open", full: "Full", cancelled: "Cancelled", completed: "Completed", in_progress: "In progress" };
const pillClass: Record<string, string> = { open: inner.pillOpen, full: inner.pillFull, cancelled: inner.pillCancelled };
const formatDate = (value: string) => new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`));
const formatMoney = (value: number | null) => value == null ? "Fee to be confirmed" : new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(value);

export default function CourseScheduleOptions({ sessions, loadError = false }: { sessions: PublicSchedule[]; loadError?: boolean }) {
  if (loadError) return <section className={kit.sec} aria-labelledby="course-schedule-title"><div className={kit.wrap}><SectionHead id="course-schedule-title" eyebrow="Upcoming Training" title="Training dates are temporarily unavailable.">Please try again shortly or contact TERAS for assistance.</SectionHead><a className={`${kit.btn} ${kit.btnNavy}`} href="/request-proposal">Contact TERAS</a></div></section>;
  if (!sessions.length) return null;
  return <section className={`${kit.sec} ${kit.trust}`} aria-labelledby="course-schedule-title"><div className={kit.wrap}><SectionHead id="course-schedule-title" eyebrow="Public Sessions" title="Choose a training date.">Review the available sessions below. Registration availability is checked from TERAS training records.</SectionHead><ul className={inner.sessions}>{sessions.map((session) => { const active = session.registration_available === true; return <li className={inner.session} key={session.id}><div><strong>{formatDate(session.start_date)}{session.end_date && session.end_date !== session.start_date ? ` – ${formatDate(session.end_date)}` : ""}</strong><span>{[session.delivery_mode, session.venue].filter(Boolean).join(" · ") || "Venue to be confirmed"}</span></div><span>{formatMoney(session.fee ?? null)} per attendee</span><span className={`${inner.pill} ${active ? inner.pillOpen : (pillClass[session.status] ?? "")}`}>{active ? "Registration open" : (statusLabels[session.status] ?? "Unavailable")}</span>{active ? <Link className={`${kit.btn} ${kit.btnNavy}`} href={`/registration/${session.id}`}>Register</Link> : <span className={inner.unavailable}>Not available</span>}</li>; })}</ul></div></section>;
}
