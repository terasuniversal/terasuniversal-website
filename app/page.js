import Image from "next/image";
import ContactForm from "../components/ContactForm";
import MobileNav from "../components/MobileNav";

const pillars = [
  {
    number: "01",
    code: "SAFETY",
    title: "Industrial Safety",
    text: "High-risk safety programmes designed to strengthen hazard recognition, procedural discipline and safe task execution in demanding workplaces.",
    services: ["Working at Height", "Confined Space", "Scaffolding Competency", "Safety Awareness"],
    outcome: "Safer execution and stronger compliance",
  },
  {
    number: "02",
    code: "SKILLS",
    title: "Technical Competency",
    text: "Structured technical pathways that combine knowledge, guided practice and competency assessment for machinery, equipment and specialist work.",
    services: ["Equipment Handling", "Scaffold Inspection", "Machinery Skills", "Competency Assessment"],
    outcome: "Measurable, job-ready technical capability",
  },
  {
    number: "03",
    code: "ADVISORY",
    title: "Industrial Consultancy",
    text: "Practical advisory services that identify operational weaknesses and translate safety or compliance gaps into prioritised improvement actions.",
    services: ["HSE Audit", "Risk Assessment", "Site Inspection", "Safety Advisory"],
    outcome: "Clearer controls and improved audit readiness",
  },
  {
    number: "04",
    code: "WORKFORCE",
    title: "Workforce Development",
    text: "Customised development frameworks that align training investments with job roles, operational requirements and long-term organisational capability.",
    services: ["Upskilling", "Reskilling", "Supervisor Development", "Corporate Training"],
    outcome: "A more capable and adaptable workforce",
  },
];

const programmes = [
  ["01", "Scaffolding Competency", "Core scaffolding knowledge, safe erection practices, inspection awareness and practical competency development."],
  ["02", "Working at Height", "Safe access, fall prevention, equipment awareness and practical control measures for elevated work."],
  ["03", "Confined Space Safety", "Hazard awareness, entry principles, control measures and emergency preparedness for confined-space work."],
  ["04", "Safety Passport", "Essential safety responsibilities, hazard recognition and workplace controls for industry personnel."],
  ["05", "Scaffolding Inspection", "Structured inspection knowledge covering scaffold condition, safe-use requirements and reporting."],
  ["06", "Lifting Awareness", "Fundamental lifting-operation safety, communication, signalling and risk-control awareness."],
  ["07", "Foreign Worker Skills", "Targeted safety and skills development to strengthen understanding, discipline and workplace performance."],
  ["08", "Custom Corporate Training", "Tailored programmes aligned with your workforce profile, project risks and operational objectives."],
];

const reasons = [
  ["Industry-Experienced Trainers", "Relevant technical knowledge, practical exposure and understanding of real industrial environments."],
  ["Practical Training", "Demonstrations, simulations and hands-on exercises that connect theory with workplace execution."],
  ["Competency-Based Learning", "Clear learning outcomes supported by structured knowledge and practical assessments."],
  ["Customised Corporate Solutions", "Programmes tailored to your workforce, procedures, site conditions and business objectives."],
  ["Compliance-Focused Approach", "Solutions designed to strengthen safer operations, audit readiness and organisational compliance."],
  ["Flexible Delivery", "Public, in-house, onsite and project-based delivery options according to programme requirements."],
];

const methodology = [
  { number: "01", code: "ANALYSE", title: "Need Analysis", text: "Identify operational requirements, participant profiles, competency gaps and measurable programme outcomes." },
  { number: "02", code: "DESIGN", title: "Programme Planning", text: "Define the training scope, learning pathway, delivery method, assessment criteria and implementation plan." },
  { number: "03", code: "UNDERSTAND", title: "Theory", text: "Build essential knowledge of principles, hazards, procedures, responsibilities and technical requirements." },
  { number: "04", code: "APPLY", title: "Practical Training", text: "Translate knowledge into performance through demonstrations, guided exercises and workplace-based scenarios." },
  { number: "05", code: "VERIFY", title: "Assessment", text: "Evaluate understanding and practical execution against clearly defined competency and safety criteria." },
  { number: "06", code: "RECOGNISE", title: "Certification", text: "Record successful completion or verified competency according to the requirements of the programme." },
  { number: "07", code: "IMPROVE", title: "Continuous Improvement", text: "Review participant results, client feedback and delivery findings to strengthen future programme effectiveness." },
];
const industries = ["Oil & Gas", "Petrochemical", "Construction", "Power & Utilities", "Manufacturing", "Marine & Offshore", "Heavy Industry", "Government & GLC"];

const facilities = [
  ["01", "Classroom Learning", "A professional learning environment for theory sessions, briefings, group discussions and knowledge assessments.", "Photo placeholder — insert a verified TERAS UNIVERSAL classroom image."],
  ["02", "Practical Training Area", "A controlled setting for demonstrations, guided exercises and practical competency development.", "Photo placeholder — insert a verified practical training image."],
  ["03", "Scaffold Training Yard", "A dedicated space for scaffolding-related learning, inspection awareness and safe-use demonstrations.", "Photo placeholder — insert a verified scaffold yard image."],
  ["04", "Assessment Area", "A designated area for practical demonstrations, performance evaluation and structured competency assessment.", "Photo placeholder — insert a verified assessment image."],
];

export default function HomePage() {
  return (
    <main>
      <header className="site-header">
        <div className="container nav-wrap">
          <a className="brand" href="#home" aria-label="TERAS UNIVERSAL home">
            <Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority />
          </a>
          <nav className="desktop-nav" aria-label="Main navigation">
            <a href="#about">About</a><a href="#services">Services</a><a href="#training">Training</a><a href="#industries">Industries</a><a href="#contact">Contact</a>
            <a className="nav-cta" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp</a>
          </nav>
          <MobileNav />
        </div>
      </header>
      <section className="hero hero-corporate" id="home">
        <div className="hero-industrial-grid" aria-hidden="true" />
        <div className="container hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">Malaysia&apos;s Industrial Safety &amp; Competency Partner</span>
            <h1>
              Building Competence for
              <span> Safer, Stronger Industries.</span>
            </h1>
            <p className="hero-lead">
              TERAS UNIVERSAL delivers competency-based industrial safety training,
              technical development, consultancy and workforce solutions for
              organisations operating in safety-critical environments.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#training">Explore Our Training</a>
              <a className="btn btn-outline" href="#contact">Request a Corporate Proposal</a>
            </div>
            <div className="hero-proof" aria-label="TERAS UNIVERSAL strengths">
              <span>Practical delivery</span>
              <span>Compliance focused</span>
              <span>Custom corporate programmes</span>
            </div>
          </div>

          <div className="premium-visual hero-command-panel" aria-label="TERAS UNIVERSAL capability highlights">
            <div className="hero-panel-label">THE STANDARD OF COMPETENCE</div>
            <div className="hero-panel-main">
              <span className="visual-kicker">Integrated Industrial Solutions</span>
              <h2>Safety. Skills. Compliance.</h2>
              <p>
                Structured learning and practical solutions designed around real
                operational risks, workforce needs and industry expectations.
              </p>
            </div>
            <div className="hero-panel-services">
              <article><strong>01</strong><span>Industrial Safety</span></article>
              <article><strong>02</strong><span>Technical Competency</span></article>
              <article><strong>03</strong><span>Industrial Consultancy</span></article>
              <article><strong>04</strong><span>Workforce Development</span></article>
            </div>
          </div>
        </div>
      </section>

      <section className="capability-strip" aria-label="TERAS UNIVERSAL corporate capabilities">
        <div className="container capability-grid">
          <article><strong>4</strong><span>Core Service Pillars</span><small>Integrated industrial solutions</small></article>
          <article><strong>7</strong><span>Methodology Stages</span><small>From need analysis to improvement</small></article>
          <article><strong>3</strong><span>Flexible Delivery Modes</span><small>Public &middot; In-house &middot; Onsite</small></article>
          <article><strong>360&deg;</strong><span>Competency Focus</span><small>Theory &middot; Practical &middot; Assessment</small></article>
        </div>
      </section>

      <section id="about">
        <div className="container about-grid">
          <div><span className="eyebrow">About TERAS UNIVERSAL</span><h2>The Standard of Competence</h2></div>
          <div className="about-copy"><p>TERAS UNIVERSAL SDN. BHD. is a Malaysian training and industrial consultancy company specialising in occupational safety and health, scaffolding, working at height, confined space, technical competency and workforce development.</p><p>We integrate regulatory compliance, technical knowledge, practical workplace skills and structured assessment to help organisations close skill gaps, strengthen risk controls and build safer, more capable teams.</p></div>
        </div>
        <div className="container value-grid" aria-label="TERAS core values">
          <article><span className="value-letter">T</span><h3>Trust</h3><p>Integrity, transparency and consistent professional delivery.</p></article>
          <article><span className="value-letter">E</span><h3>Excellence</h3><p>High standards in content, delivery, assessment and service.</p></article>
          <article><span className="value-letter">R</span><h3>Responsibility</h3><p>Responsible solutions that consider people, operations and workplace impact.</p></article>
          <article><span className="value-letter">A</span><h3>Accountability</h3><p>Clear ownership of quality, commitments and measurable outcomes.</p></article>
          <article><span className="value-letter">S</span><h3>Safety</h3><p>Risk reduction and workforce protection at the centre of every solution.</p></article>
        </div>
      </section>

      <section id="services" className="soft-section">
        <div className="container">
          <div className="section-heading split-heading pillar-heading">
            <div><span className="eyebrow">Four Core Service Pillars</span><h2>Integrated solutions for competence, compliance and performance.</h2></div>
            <p>Each pillar addresses a specific organisational challenge&mdash;from controlling high-risk work to building long-term workforce capability.</p>
          </div>
          <div className="pillar-grid">
            {pillars.map((pillar)=><article className="pillar-card" key={pillar.title}>
              <div className="pillar-card-top">
                <span className="pillar-number">{pillar.number}</span>
                <span className="pillar-code">{pillar.code}</span>
              </div>
              <h3>{pillar.title}</h3>
              <p className="pillar-description">{pillar.text}</p>
              <div className="pillar-services" aria-label={`${pillar.title} services`}>
                {pillar.services.map(service=><span key={service}>{service}</span>)}
              </div>
              <div className="pillar-outcome"><small>BUSINESS OUTCOME</small><strong>{pillar.outcome}</strong></div>
              <a href="#contact" aria-label={`Discuss ${pillar.title}`}>Discuss this service <span aria-hidden="true">&rarr;</span></a>
            </article>)}
          </div>
        </div>
      </section>

      <section className="why-section" aria-labelledby="why-teras-title">
        <div className="container">
          <div className="section-heading why-heading">
            <span className="eyebrow">Why Choose TERAS</span>
            <h2 id="why-teras-title">Why Organisations Choose TERAS UNIVERSAL</h2>
            <p>We combine practical industry learning, structured competency development and compliance-focused solutions to help organisations build safer, more capable workforces.</p>
          </div>
          <div className="reason-grid">
            {reasons.map(([title,text],index)=><article key={title}>
              <span className="reason-icon" aria-hidden="true">{["EX","PR","CB","CS","CF","FD"][index]}</span>
              <div><h3>{title}</h3><p>{text}</p></div>
            </article>)}
          </div>
        </div>
      </section>

      <section id="training" className="soft-section">
        <div className="container">
          <div className="section-heading split-heading"><div><span className="eyebrow">Featured Training Programmes</span><h2>Practical programmes for safer and stronger workplaces.</h2></div><p>Programme scope and duration can be tailored to participant profiles, site risks and operational objectives.</p></div>
          <div className="programme-grid">{programmes.map(([number,title,text])=><article key={title}><span>{number}</span><h3>{title}</h3><p>{text}</p><a href="#contact">Enquire now <span aria-hidden="true">&rarr;</span></a></article>)}</div>
        </div>
      </section>

      <section id="delivery" className="delivery-section" aria-labelledby="delivery-title">
        <div className="container">
          <div className="section-heading delivery-heading">
            <span className="eyebrow">Training Delivery Options</span>
            <h2 id="delivery-title">Flexible Training Solutions for Your Organisation</h2>
            <p>Our programmes can be delivered according to your workforce profile, operational environment, project requirements and preferred training arrangement.</p>
          </div>
          <div className="delivery-grid">
            <article className="delivery-card">
              <span className="delivery-number">01</span>
              <small>PUBLIC PROGRAMME</small>
              <h3>Public Programme</h3>
              <p>Scheduled programmes for individuals and employees from different organisations.</p>
              <a href="#contact">Discuss your requirements <span aria-hidden="true">&rarr;</span></a>
            </article>
            <article className="delivery-card">
              <span className="delivery-number">02</span>
              <small>IN-HOUSE</small>
              <h3>Corporate In-House Training</h3>
              <p>Customised programmes delivered exclusively for one organisation, department or workforce group.</p>
              <a href="#contact">Discuss your requirements <span aria-hidden="true">&rarr;</span></a>
            </article>
            <article className="delivery-card">
              <span className="delivery-number">03</span>
              <small>ONSITE</small>
              <h3>Onsite Training</h3>
              <p>Training conducted at the client&apos;s workplace, plant, project site or approved operational facility.</p>
              <a href="#contact">Discuss your requirements <span aria-hidden="true">&rarr;</span></a>
            </article>
            <article className="delivery-card">
              <span className="delivery-number">04</span>
              <small>ASSESSMENT</small>
              <h3>Competency Assessment</h3>
              <p>Structured theoretical and practical evaluation based on defined programme and competency requirements.</p>
              <a href="#contact">Discuss your requirements <span aria-hidden="true">&rarr;</span></a>
            </article>
          </div>
        </div>
      </section>
      <section id="facilities" className="facilities-section" aria-labelledby="facilities-title">
        <div className="container">
          <div className="section-heading split-heading facilities-heading">
            <div>
              <span className="eyebrow">Training Facilities</span>
              <h2 id="facilities-title">Learning environments designed for practical development.</h2>
            </div>
            <p>Our training environments are presented here as a structured framework. Verified photographs and facility details can be added as they become available.</p>
          </div>
          <div className="facilities-grid">
            {facilities.map(([number, title, text, placeholder]) => (
              <article className="facility-card" key={title}>
                <div className="facility-media" aria-label={`${title} photo placeholder`}>
                  <span className="facility-media-label">PHOTO PLACEHOLDER</span>
                  <span className="facility-media-note">Verified TERAS UNIVERSAL image to be added</span>
                </div>
                <div className="facility-content">
                  <span className="facility-number">{number}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                  <small>{placeholder}</small>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section id="industries">
        <div className="container">
          <div className="section-heading"><span className="eyebrow">Industries We Serve</span><h2>Supporting Safety-Critical Industries</h2><p>TERAS UNIVERSAL supports organisations operating in environments where safety, technical competence, operational reliability and compliance are essential.</p></div>
          <div className="industry-grid">{industries.map((industry,index)=><article key={industry}><span>{String(index+1).padStart(2,"0")}</span><h3>{industry}</h3></article>)}</div>
        </div>
      </section>
      <section id="methodology" className="method-section" aria-labelledby="methodology-title">
        <div className="container">
          <div className="section-heading split-heading method-heading">
            <div>
              <span className="eyebrow">Training Methodology</span>
              <h2 id="methodology-title">A structured pathway from need to verified competence.</h2>
            </div>
            <p>Every programme follows a disciplined learning cycle designed to connect organisational needs with practical workplace performance.</p>
          </div>

          <div className="method-timeline" aria-label="TERAS UNIVERSAL training methodology">
            {methodology.map((step, index) => (
              <article className="method-step" key={step.title}>
                <div className="method-step-marker"><span>{step.number}</span></div>
                <div className="method-step-content">
                  <small>{step.code}</small>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
                {index < methodology.length - 1 && <span className="method-connector" aria-hidden="true">&rarr;</span>}
              </article>
            ))}
          </div>

          <div className="method-outcome">
            <span>END RESULT</span>
            <strong>Competent people. Safer execution. Stronger organisational performance.</strong>
          </div>
        </div>
      </section>

      <section className="premium-cta-section"><div className="container premium-cta"><div><span>Corporate & Custom Solutions</span><h2>Ready to strengthen your workforce competency?</h2><p>Speak with our team about a training or consultancy solution aligned with your operational requirements.</p></div><a className="btn btn-light" href="#contact">Request a Proposal</a></div></section>

      <section id="contact" className="contact-section">
        <div className="container"><div className="section-heading"><span className="eyebrow">Contact Us</span><h2>Let us discuss your requirements.</h2></div><div className="contact-layout"><ContactForm /><div className="contact-details"><div className="detail-card"><h3>TERAS UNIVERSAL SDN. BHD.</h3><p>Industrial Safety Training &middot; Technical Competency &middot; Consultancy</p><dl><div><dt>Phone</dt><dd><a href="tel:+60195193834">+60 19-519 3834</a></dd></div><div><dt>Training</dt><dd><a href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a></dd></div><div><dt>Administration</dt><dd><a href="mailto:admin@terasuniversal.com.my">admin@terasuniversal.com.my</a></dd></div><div><dt>Address</dt><dd>Lot 1961, Jalan Tanah Merah, Kg Tanah Merah Dalam, 06000 Jitra, Kedah, Malaysia</dd></div></dl></div><div className="map-card"><iframe title="TERAS UNIVERSAL location" src="https://www.google.com/maps?q=Lot%201961%2C%20Jalan%20Tanah%20Merah%2C%20Kg%20Tanah%20Merah%20Dalam%2C%2006000%20Jitra%2C%20Kedah%2C%20Malaysia&output=embed" loading="lazy" referrerPolicy="no-referrer-when-downgrade" /></div></div></div></div>
      </section>

      <a className="floating-whatsapp" href="https://wa.me/60195193834?text=Hello%20TERAS%20UNIVERSAL%2C%20I%20would%20like%20to%20enquire%20about%20your%20training%20and%20consultancy%20services." target="_blank" rel="noreferrer" aria-label="Contact TERAS UNIVERSAL on WhatsApp">WA</a>

      <footer><div className="container footer-grid"><div className="footer-brand"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" width={210} height={135} /><p>Building Competence. Creating Opportunities.</p></div><div><h3>Core Services</h3><p>Industrial Safety<br/>Technical Competency<br/>Industrial Consultancy<br/>Workforce Development</p></div><div><h3>Contact</h3><p><a href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a><br/><a href="tel:+60195193834">+60 19-519 3834</a></p><p>Lot 1961, Jalan Tanah Merah,<br/>Kg Tanah Merah Dalam,<br/>06000 Jitra, Kedah, Malaysia</p></div></div><div className="container footer-bottom"><span>&copy; 2026 TERAS UNIVERSAL SDN. BHD. All rights reserved.</span><span>terasuniversal.com.my</span></div></footer>
    </main>
  );
}






