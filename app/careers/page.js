import SiteHeader from "../../components/SiteHeader";
import SiteFooter from "../../components/SiteFooter";
import CareersApplicationForm from "../../components/CareersApplicationForm";
import { vacancies, internships } from "../../data/careers";

const process = [
  ["01", "Apply", "Submit your application and resume or portfolio link through the form on this page."],
  ["02", "Review", "Our team reviews applications against current and upcoming role requirements."],
  ["03", "Interview", "Shortlisted candidates are contacted to arrange an interview."],
  ["04", "Offer", "Successful candidates receive an offer with role details and next steps."],
];
const benefits = [
  "Hands-on involvement in real industrial safety training and consultancy work.",
  "Exposure to safety-critical industries such as oil & gas, construction and manufacturing.",
  "Structured, on-the-job development alongside experienced trainers and assessors.",
  "A collaborative, safety-first working culture.",
];

export default function CareersPage() {
  return (
    <main className="utility-page careers-page">
      <SiteHeader />
      <div className="container utility-container">
        <span className="eyebrow">Careers</span>
        <h1>Build your career around real industrial impact.</h1>
        <p className="utility-lead">Join a team focused on practical industrial safety training, technical competency development and workforce solutions.</p>
      </div>

      <section className="careers-vacancies-section" aria-labelledby="vacancies-title">
        <div className="container">
          <div className="section-heading"><span className="eyebrow">Current Vacancies</span><h2 id="vacancies-title">Open positions</h2></div>
          {vacancies.length ? (
            <div className="careers-vacancy-grid">
              {vacancies.map((role) => (
                <article className="careers-vacancy-card" key={role.title}>
                  <span className="eyebrow">{role.type} &middot; {role.location}</span>
                  <h3>{role.title}</h3>
                  <p>{role.summary}</p>
                  <ul>{role.requirements.map((item) => <li key={item}>{item}</li>)}</ul>
                  <a href="#apply" className="btn btn-outline">Apply Now</a>
                </article>
              ))}
            </div>
          ) : (
            <div className="verified-empty" role="status">
              <h3>No current vacancies published</h3>
              <p>We do not have any open positions listed right now. You are welcome to submit a general application below and our team will keep it on file for future opportunities.</p>
            </div>
          )}
        </div>
      </section>

      <section className="careers-vacancies-section soft-section" aria-labelledby="internships-title">
        <div className="container">
          <div className="section-heading"><span className="eyebrow">Internship</span><h2 id="internships-title">Internship opportunities</h2></div>
          {internships.length ? (
            <div className="careers-vacancy-grid">
              {internships.map((role) => (
                <article className="careers-vacancy-card" key={role.title}>
                  <span className="eyebrow">{role.type} &middot; {role.location}</span>
                  <h3>{role.title}</h3>
                  <p>{role.summary}</p>
                  <ul>{role.requirements.map((item) => <li key={item}>{item}</li>)}</ul>
                  <a href="#apply" className="btn btn-outline">Apply Now</a>
                </article>
              ))}
            </div>
          ) : (
            <div className="verified-empty" role="status">
              <h3>No internship openings published</h3>
              <p>Internship opportunities will be listed here once confirmed. Submit a general application below to express your interest.</p>
            </div>
          )}
        </div>
      </section>

      <section className="careers-process-section" aria-labelledby="process-title">
        <div className="container">
          <div className="section-heading"><span className="eyebrow">Recruitment Process</span><h2 id="process-title">What to expect when you apply.</h2></div>
          <div className="training-process-grid">{process.map(([number, title, text]) => <article key={title}><span>{number}</span><h3>{title}</h3><p>{text}</p></article>)}</div>
        </div>
      </section>

      <section className="careers-benefits-section soft-section" aria-labelledby="benefits-title">
        <div className="container">
          <div className="section-heading"><span className="eyebrow">Why Join Us</span><h2 id="benefits-title">What you can expect.</h2></div>
          <ul className="industry-benefits-list">{benefits.map((item) => <li key={item}><span aria-hidden="true">&#10003;</span>{item}</li>)}</ul>
        </div>
      </section>

      <section id="apply" className="careers-apply-section" aria-labelledby="apply-title">
        <div className="container">
          <div className="section-heading"><span className="eyebrow">Apply</span><h2 id="apply-title">Submit your application</h2></div>
          <CareersApplicationForm />
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
