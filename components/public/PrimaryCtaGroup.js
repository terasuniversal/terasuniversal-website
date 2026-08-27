function whatsappUrl(message) {
  return `https://wa.me/60195193834?text=${encodeURIComponent(message)}`;
}

export function enquiryHref({ course, source, session } = {}) {
  const params = new URLSearchParams();
  if (course) params.set("course", course);
  if (session) params.set("session", session);
  if (source) params.set("source", source);
  const query = params.toString();
  return query ? `/request-proposal?${query}` : "/request-proposal";
}

export default function PrimaryCtaGroup({ course, source, scheduleHref = "/calendar", className = "hero-actions" }) {
  const courseName = course?.title;
  const enquiry = enquiryHref({ course: course?.slug, source });
  const message = courseName ? `Hi TERAS, saya berminat dengan ${courseName}.` : "Hi TERAS, saya ingin bertanya tentang latihan TERAS.";

  return <div className={`${className} ${styles.ctaGroup}`}>
    {course && <a className={`btn btn-primary ${styles.primaryAction}`} href={scheduleHref}>View Upcoming Training</a>}
    <a className={`btn ${course ? "btn-outline" : "btn-primary"} ${course ? styles.enquiryAction : styles.primaryAction}`} href={enquiry}>{course ? "Enquire About This Course" : "Request Corporate Training"}</a>
    {course && <a className="btn btn-outline" href={whatsappUrl(message)} target="_blank" rel="noreferrer">WhatsApp TERAS</a>}
  </div>;
}
import styles from "./public-phase-one.module.css";
