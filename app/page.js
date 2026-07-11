const courses = [
  ["🧗","Working at Height","Practical awareness training, safe work procedures and essential controls for work at height."],
  ["🏗️","Scaffolding","Introduction, erection fundamentals, inspection practices and safe scaffolding operations."],
  ["⚠️","Safety Awareness","Hazard identification, risk control and workplace safety culture development."],
  ["🎓","Custom Corporate Training","Tailored programmes designed around your organisation, project and workforce requirements."]
];

export default function HomePage() {
  return (
    <main>
      <header className="site-header">
        <div className="container nav-wrap">
          <a className="brand" href="#home">
            <img src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" />
            <div><strong>TERAS UNIVERSAL</strong><span>INDUSTRIAL SAFETY TRAINING & CONSULTANCY</span></div>
          </a>
          <nav>
            <a href="#about">About</a><a href="#courses">Training</a>
            <a href="#why">Why Us</a><a href="#contact">Contact</a>
            <a className="nav-cta" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp</a>
          </nav>
        </div>
      </header>

      <section className="hero" id="home">
        <div className="container hero-grid">
          <div>
            <span className="badge">TERAS UNIVERSAL SDN. BHD. · 976732-P</span>
            <h1>Building Competence.<br/><span>Creating Opportunities.</span></h1>
            <p>A trusted provider of industrial safety training and consultancy, helping individuals and organisations build a competent, disciplined and industry-ready workforce.</p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="https://wa.me/60195193834?text=I%20would%20like%20to%20know%20more%20about%20TERAS%20UNIVERSAL%20training%20programmes." target="_blank" rel="noreferrer">Register Your Interest</a>
              <a className="btn btn-outline" href="mailto:training@terasuniversal.com.my">Email Training Team</a>
            </div>
          </div>
          <div className="hero-card">
            <img src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" />
            <div className="stat-grid">
              <div><strong>Theory</strong><span>Strong foundation</span></div>
              <div><strong>Practical</strong><span>Hands-on learning</span></div>
              <div><strong>Industry</strong><span>Career focused</span></div>
            </div>
          </div>
        </div>
      </section>

      <section id="about">
        <div className="container">
          <div className="section-heading">
            <span className="badge">About Us</span>
            <h2>Training that builds skills, discipline and confidence.</h2>
            <p>TERAS UNIVERSAL delivers training and consultancy solutions tailored to individuals, companies and industry partners.</p>
          </div>
          <div className="feature-grid">
            <article className="feature-card"><div>🦺</div><h3>Industrial Safety</h3><p>Programmes focused on safe work culture, compliance and operational readiness.</p></article>
            <article className="feature-card"><div>🔩</div><h3>Skills Development</h3><p>Theory and practical learning designed to strengthen workplace competence.</p></article>
            <article className="feature-card"><div>👥</div><h3>Corporate Programmes</h3><p>Custom training aligned with organisational goals and project requirements.</p></article>
            <article className="feature-card"><div>📋</div><h3>Consultancy</h3><p>Support for programme planning, coordination and implementation.</p></article>
          </div>
        </div>
      </section>

      <section id="courses" className="soft-section">
        <div className="container">
          <div className="section-heading">
            <span className="badge">Training Areas</span>
            <h2>Programmes tailored to your operational needs.</h2>
            <p>Training content and duration can be customised according to your objectives, participant profile and workplace requirements.</p>
          </div>
          <div className="feature-grid">
            {courses.map(([icon,title,text]) => <article className="feature-card" key={title}><div>{icon}</div><h3>{title}</h3><p>{text}</p></article>)}
          </div>
        </div>
      </section>

      <section id="why">
        <div className="container split">
          <div>
            <span className="badge">Why TERAS</span>
            <h2>A structured learning experience built around industry expectations.</h2>
            <div className="check-list">
              {["Balanced theory and practical learning","Industry-oriented training modules","Customisable programme structure","End-to-end coordination support"].map(item => <div key={item}><b>✓</b><span>{item}</span></div>)}
            </div>
          </div>
          <aside className="cta-panel">
            <h3>Need a customised training programme?</h3>
            <p>Share your objective, preferred date and number of participants. Our team will help prepare a suitable programme proposal.</p>
            <a className="btn btn-light" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">Discuss via WhatsApp</a>
          </aside>
        </div>
      </section>

      <section><div className="container"><div className="wide-cta">
        <div><h2>Ready to build a more competent workforce?</h2><p>Contact us for training enquiries, corporate programmes or strategic collaboration.</p></div>
        <a className="btn btn-primary" href="mailto:admin@terasuniversal.com.my">Contact TERAS UNIVERSAL</a>
      </div></div></section>

      <section id="contact">
        <div className="container">
          <div className="section-heading"><span className="badge">Contact Us</span><h2>Let us discuss your training requirements.</h2></div>
          <div className="contact-grid">
            <div className="contact-card">
              <h3>TERAS UNIVERSAL SDN. BHD.</h3><p>Industrial Safety Training & Consultancy</p>
              <ul><li><strong>Phone:</strong> +60 19-519 3834</li><li><strong>Administration:</strong> admin@terasuniversal.com.my</li><li><strong>Training:</strong> training@terasuniversal.com.my</li><li><strong>Website:</strong> www.terasuniversal.com.my</li></ul>
            </div>
            <div className="contact-card">
              <h3>Quick Enquiry</h3><p>Contact us on WhatsApp for schedules, fees, sponsored programmes and participant registration.</p>
              <a className="btn btn-primary" href="https://wa.me/60195193834?text=Hello%2C%20I%20would%20like%20to%20enquire%20about%20TERAS%20UNIVERSAL%20training%20programmes." target="_blank" rel="noreferrer">Start WhatsApp Chat</a>
            </div>
          </div>
        </div>
      </section>

      <a className="floating-whatsapp" href="https://wa.me/60195193834" target="_blank" rel="noreferrer" aria-label="WhatsApp">☎</a>
      <footer><div className="container footer-wrap"><div><strong>TERAS UNIVERSAL SDN. BHD.</strong><span>Building Competence. Creating Opportunities.</span></div><small>© 2026 TERAS UNIVERSAL. All rights reserved.</small></div></footer>
    </main>
  );
}
