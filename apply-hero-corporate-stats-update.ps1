$ErrorActionPreference = 'Stop'

$root = Get-Location
$pagePath = Join-Path $root 'app/page.js'
$cssPath  = Join-Path $root 'app/globals.css'

if (!(Test-Path $pagePath)) { throw "app/page.js tidak dijumpai. Jalankan skrip ini dalam folder repository website." }
if (!(Test-Path $cssPath))  { throw "app/globals.css tidak dijumpai. Jalankan skrip ini dalam folder repository website." }

$page = Get-Content $pagePath -Raw
$css  = Get-Content $cssPath -Raw

$hero = @'
      <section className="hero hero-corporate" id="home">
        <div className="hero-industrial-grid" aria-hidden="true" />
        <div className="container hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">Malaysia’s Industrial Safety & Competency Partner</span>
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
          <article><strong>3</strong><span>Flexible Delivery Modes</span><small>Public · In-house · Onsite</small></article>
          <article><strong>360°</strong><span>Competency Focus</span><small>Theory · Practical · Assessment</small></article>
        </div>
      </section>
'@

$pattern = '(?s)\s*<section className="hero" id="home">.*?</section>'
if ($page -notmatch $pattern) {
  $pattern = '(?s)\s*<section className="hero hero-corporate" id="home">.*?</section>\s*<section className="capability-strip".*?</section>'
}
if ($page -notmatch $pattern) {
  throw 'Hero section semasa tidak dapat dikenal pasti. Pastikan app/page.js ialah versi website terkini.'
}

$page = [regex]::Replace($page, $pattern, "`r`n$hero", 1)
Set-Content -Path $pagePath -Value $page -Encoding UTF8

$marker = '/* ===== Hero Corporate + Capability Statistics Update ===== */'
if ($css.Contains($marker)) {
  $css = $css.Substring(0, $css.IndexOf($marker)).TrimEnd()
}

$cssAddition = @'

/* ===== Hero Corporate + Capability Statistics Update ===== */
.hero-corporate{
  position:relative;
  isolation:isolate;
  overflow:hidden;
  padding:104px 0 92px;
  background:
    radial-gradient(circle at 12% 18%,rgba(225,169,37,.11),transparent 27%),
    linear-gradient(118deg,#f8fbff 0%,#ffffff 48%,#edf3fb 100%);
}
.hero-industrial-grid{
  position:absolute;
  inset:0;
  z-index:-1;
  opacity:.42;
  background-image:
    linear-gradient(rgba(11,44,86,.045) 1px,transparent 1px),
    linear-gradient(90deg,rgba(11,44,86,.045) 1px,transparent 1px);
  background-size:52px 52px;
  mask-image:linear-gradient(90deg,#000,transparent 72%);
}
.hero-corporate .hero-grid{gap:64px;align-items:center}
.hero-corporate .hero-copy{max-width:680px}
.hero-corporate h1{max-width:760px}
.hero-corporate h1 span{display:block;margin-top:5px}
.hero-proof{display:flex;flex-wrap:wrap;gap:10px 18px;margin-top:28px}
.hero-proof span{position:relative;padding-left:17px;color:var(--muted);font-size:13px;font-weight:800}
.hero-proof span:before{content:"";position:absolute;left:0;top:.58em;width:7px;height:7px;border-radius:50%;background:var(--gold);box-shadow:0 0 0 4px rgba(225,169,37,.12)}
.hero-command-panel{
  position:relative;
  min-height:500px;
  padding:36px;
  border:1px solid rgba(255,255,255,.16);
  border-radius:30px;
  color:#fff;
  background:
    linear-gradient(145deg,rgba(5,23,52,.97),rgba(11,44,86,.95)),
    var(--navy);
  box-shadow:0 30px 70px rgba(8,26,58,.24);
  overflow:hidden;
}
.hero-command-panel:after{content:"";position:absolute;width:300px;height:300px;right:-145px;top:-130px;border:1px solid rgba(225,169,37,.28);border-radius:50%}
.hero-panel-label{position:relative;z-index:2;color:#f4c75d;font-size:10px;font-weight:900;letter-spacing:.17em}
.hero-panel-main{position:relative;z-index:2;margin-top:58px;max-width:500px}
.hero-panel-main .visual-kicker{color:#aebfd7}
.hero-panel-main h2{margin:12px 0 14px;color:#fff;font-size:clamp(34px,4vw,50px);line-height:1.06;letter-spacing:-.035em}
.hero-panel-main p{margin:0;color:#d4deec;line-height:1.75}
.hero-panel-services{position:relative;z-index:2;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:46px}
.hero-panel-services article{display:flex;align-items:center;gap:12px;min-height:68px;padding:14px;border:1px solid rgba(255,255,255,.12);border-radius:16px;background:rgba(255,255,255,.055)}
.hero-panel-services strong{display:grid;place-items:center;flex:0 0 34px;width:34px;height:34px;border-radius:10px;background:rgba(225,169,37,.15);color:#f4c75d;font-size:11px}
.hero-panel-services span{font-size:12px;font-weight:800;line-height:1.35}
.capability-strip{padding:0;background:var(--navy);color:#fff}
.capability-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}
.capability-grid article{position:relative;display:grid;grid-template-columns:auto 1fr;column-gap:14px;align-items:center;min-height:132px;padding:26px 24px;border-right:1px solid rgba(255,255,255,.1)}
.capability-grid article:last-child{border-right:0}
.capability-grid strong{grid-row:1/3;color:#f4c75d;font-size:32px;line-height:1;font-weight:900;letter-spacing:-.04em}
.capability-grid span{align-self:end;color:#fff;font-size:14px;font-weight:850;line-height:1.25}
.capability-grid small{align-self:start;color:#9fb0c9;font-size:11px;line-height:1.4}
@media(max-width:920px){
  .hero-corporate{padding:72px 0 70px}
  .hero-corporate .hero-grid{grid-template-columns:1fr;gap:40px}
  .hero-command-panel{min-height:440px}
  .capability-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .capability-grid article:nth-child(2){border-right:0}
  .capability-grid article:nth-child(-n+2){border-bottom:1px solid rgba(255,255,255,.1)}
}
@media(max-width:590px){
  .hero-corporate{padding:48px 0 52px;text-align:center}
  .hero-corporate h1 span{display:inline}
  .hero-proof{justify-content:center}
  .hero-command-panel{display:block !important;height:auto !important;min-height:0 !important;margin-top:32px !important;padding:26px !important;text-align:left}
  .hero-panel-main{margin-top:34px}
  .hero-panel-main h2{font-size:34px}
  .hero-panel-services{grid-template-columns:1fr;margin-top:30px}
  .capability-grid{grid-template-columns:1fr}
  .capability-grid article{border-right:0;border-bottom:1px solid rgba(255,255,255,.1);min-height:108px}
  .capability-grid article:last-child{border-bottom:0}
}
'@

Set-Content -Path $cssPath -Value ($css.TrimEnd() + $cssAddition) -Encoding UTF8
Write-Host 'Hero Section dan Corporate Capability Statistics berjaya dikemas kini.' -ForegroundColor Green
Write-Host 'Seterusnya jalankan: npm run build' -ForegroundColor Cyan
