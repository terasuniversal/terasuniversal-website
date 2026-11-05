import kit from "../premium/premium.module.css";
import inner from "../premium/inner.module.css";

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

// Course actions on a navy field: gold schedule/register action, two light-outline secondary actions.
export default function PrimaryCtaGroup({ course, source, scheduleHref = "/calendar", hasRegistration = false }) {
  const courseName = course?.title;
  const enquiry = enquiryHref({ course: course?.slug, source });
  const message = courseName ? `Hi TERAS, saya berminat dengan ${courseName}.` : "Hi TERAS, saya ingin bertanya tentang latihan TERAS.";

  return <div className={inner.actions}>
    {course && <a className={kit.btn} href={scheduleHref}>{hasRegistration ? "Register Now" : "View Upcoming Training"}</a>}
    <a className={`${kit.btn} ${kit.btnLight}`} href={enquiry}>{course ? "Enquire About This Course" : "Request Corporate Training"}</a>
    {course && <a className={`${kit.btn} ${kit.btnLight}`} href={whatsappUrl(message)} target="_blank" rel="noreferrer">WhatsApp TERAS<span className="sr-only"> (opens in a new tab)</span></a>}
  </div>;
}
