const courses = [
  {
    icon: "🧗",
    title: "Working at Height",
    text: "Latihan kesedaran, amalan kerja selamat dan prosedur asas bekerja di tempat tinggi.",
  },
  {
    icon: "🏗️",
    title: "Scaffolding",
    text: "Pengenalan, asas pemasangan, pemeriksaan dan keselamatan kerja perancah.",
  },
  {
    icon: "⚠️",
    title: "Safety Awareness",
    text: "Pengenalpastian bahaya, kawalan risiko dan budaya keselamatan di tempat kerja.",
  },
  {
    icon: "🎓",
    title: "Custom Corporate Training",
    text: "Program tersuai mengikut keperluan organisasi, projek dan kumpulan sasaran.",
  },
];

const strengths = [
  "Gabungan teori dan praktikal",
  "Modul berorientasikan industri",
  "Program boleh disesuaikan",
  "Sokongan penyelarasan menyeluruh",
];

export default function HomePage() {
  return (
    <main>
      <header className="site-header">
        <div className="container nav-wrap">
          <a className="brand" href="#home">
            <img src="/teras-universal-logo.jpg" alt="Logo TERAS UNIVERSAL" />
            <div>
              <strong>TERAS UNIVERSAL</strong>
              <span>INDUSTRIAL SAFETY TRAINING & CONSULTANCY</span>
            </div>
          </a>

          <nav>
            <a href="#about">Tentang</a>
            <a href="#courses">Kursus</a>
            <a href="#why">Kelebihan</a>
            <a href="#contact">Hubungi</a>
            <a
              className="nav-cta"
              href="https://wa.me/60195193834"
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp
            </a>
          </nav>
        </div>
      </header>

      <section className="hero" id="home">
        <div className="container hero-grid">
          <div>
            <span className="badge">TERAS UNIVERSAL SDN. BHD. · 976732-P</span>
            <h1>
              Building Competence.
              <br />
              <span>Creating Opportunities.</span>
            </h1>
            <p>
              Penyedia latihan keselamatan industri dan khidmat konsultansi
              untuk membantu peserta serta organisasi membina tenaga kerja
              kompeten, berdisiplin dan bersedia menghadapi keperluan industri.
            </p>
            <div className="hero-actions">
              <a
                className="btn btn-primary"
                href="https://wa.me/60195193834?text=Saya%20berminat%20untuk%20mengetahui%20kursus%20TERAS%20UNIVERSAL"
                target="_blank"
                rel="noreferrer"
              >
                Daftar Minat Kursus
              </a>
              <a className="btn btn-outline" href="mailto:training@terasuniversal.com.my">
                Email Bahagian Latihan
              </a>
            </div>
          </div>

          <div className="hero-card">
            <img src="/teras-universal-logo.jpg" alt="TERAS UNIVERSAL" />
            <div className="stat-grid">
              <div><strong>Teori</strong><span>Asas kukuh</span></div>
              <div><strong>Praktikal</strong><span>Latihan sebenar</span></div>
              <div><strong>Industri</strong><span>Fokus kerjaya</span></div>
            </div>
          </div>
        </div>
      </section>

      <section id="about">
        <div className="container">
          <div className="section-heading">
            <span className="badge">Tentang Kami</span>
            <h2>Latihan yang membina kemahiran, disiplin dan keyakinan.</h2>
            <p>
              TERAS UNIVERSAL menyediakan penyelesaian latihan dan konsultansi
              yang disesuaikan dengan keperluan peserta, syarikat dan industri.
            </p>
          </div>

          <div className="feature-grid">
            <article className="feature-card">
              <div>🦺</div>
              <h3>Keselamatan Industri</h3>
              <p>Program berorientasikan budaya kerja selamat dan pematuhan.</p>
            </article>
            <article className="feature-card">
              <div>🔩</div>
              <h3>Latihan Kemahiran</h3>
              <p>Pembelajaran teori dan praktikal untuk meningkatkan kompetensi.</p>
            </article>
            <article className="feature-card">
              <div>👥</div>
              <h3>Program Korporat</h3>
              <p>Latihan tersuai mengikut objektif organisasi dan projek.</p>
            </article>
            <article className="feature-card">
              <div>📋</div>
              <h3>Konsultansi</h3>
              <p>Sokongan perancangan, penyelarasan dan pelaksanaan program.</p>
            </article>
          </div>
        </div>
      </section>

      <section id="courses" className="soft-section">
        <div className="container">
          <div className="section-heading">
            <span className="badge">Bidang Latihan</span>
            <h2>Program yang boleh disesuaikan mengikut keperluan.</h2>
            <p>
              Kandungan dan tempoh program boleh diubah suai berdasarkan objektif
              pelanggan dan kumpulan sasaran.
            </p>
          </div>

          <div className="feature-grid">
            {courses.map((course) => (
              <article className="feature-card" key={course.title}>
                <div>{course.icon}</div>
                <h3>{course.title}</h3>
                <p>{course.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="why">
        <div className="container split">
          <div>
            <span className="badge">Mengapa TERAS</span>
            <h2>Pengalaman pembelajaran yang tersusun dan berorientasikan industri.</h2>
            <div className="check-list">
              {strengths.map((item) => (
                <div key={item}>
                  <b>✓</b>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <aside className="cta-panel">
            <h3>Perlukan program latihan khas?</h3>
            <p>
              Maklumkan objektif, jumlah peserta dan tarikh cadangan. Pasukan kami
              akan membantu menyediakan cadangan program yang sesuai.
            </p>
            <a
              className="btn btn-light"
              href="https://wa.me/60195193834"
              target="_blank"
              rel="noreferrer"
            >
              Bincang Melalui WhatsApp
            </a>
          </aside>
        </div>
      </section>

      <section>
        <div className="container">
          <div className="wide-cta">
            <div>
              <h2>Bersedia membina tenaga kerja yang lebih kompeten?</h2>
              <p>Hubungi kami untuk pertanyaan kursus, latihan korporat atau kerjasama program.</p>
            </div>
            <a className="btn btn-primary" href="mailto:admin@terasuniversal.com.my">
              Hubungi TERAS UNIVERSAL
            </a>
          </div>
        </div>
      </section>

      <section id="contact">
        <div className="container">
          <div className="section-heading">
            <span className="badge">Hubungi Kami</span>
            <h2>Mari berbincang tentang keperluan latihan anda.</h2>
          </div>

          <div className="contact-grid">
            <div className="contact-card">
              <h3>TERAS UNIVERSAL SDN. BHD.</h3>
              <p>Industrial Safety Training & Consultancy</p>
              <ul>
                <li><strong>Telefon:</strong> +60 19-519 3834</li>
                <li><strong>Email:</strong> admin@terasuniversal.com.my</li>
                <li><strong>Latihan:</strong> training@terasuniversal.com.my</li>
                <li><strong>Website:</strong> www.terasuniversal.com.my</li>
              </ul>
            </div>

            <div className="contact-card">
              <h3>Pertanyaan Pantas</h3>
              <p>
                Gunakan WhatsApp untuk mendapatkan maklumat berkaitan jadual,
                yuran, program tajaan dan pendaftaran.
              </p>
              <a
                className="btn btn-primary"
                href="https://wa.me/60195193834?text=Assalamualaikum%2C%20saya%20ingin%20bertanya%20tentang%20program%20latihan%20TERAS%20UNIVERSAL."
                target="_blank"
                rel="noreferrer"
              >
                Mulakan WhatsApp
              </a>
            </div>
          </div>
        </div>
      </section>

      <a
        className="floating-whatsapp"
        href="https://wa.me/60195193834"
        target="_blank"
        rel="noreferrer"
        aria-label="WhatsApp"
      >
        ☎
      </a>

      <footer>
        <div className="container footer-wrap">
          <div>
            <strong>TERAS UNIVERSAL SDN. BHD.</strong>
            <span>Building Competence. Creating Opportunities.</span>
          </div>
          <small>© 2026 TERAS UNIVERSAL. Hak cipta terpelihara.</small>
        </div>
      </footer>
    </main>
  );
}
