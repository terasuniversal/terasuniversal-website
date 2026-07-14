$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$pagePath = Join-Path $repoRoot 'app\page.js'
$cssPath = Join-Path $repoRoot 'app\globals.css'

if (-not (Test-Path $pagePath) -or -not (Test-Path $cssPath)) {
  throw 'Pastikan fail ini berada di folder utama repository yang mempunyai app\page.js dan app\globals.css.'
}

$page = Get-Content $pagePath -Raw

$newMethodology = @'
const methodology = [
  { number: "01", code: "ANALYSE", title: "Need Analysis", text: "Identify operational requirements, participant profiles, competency gaps and measurable programme outcomes." },
  { number: "02", code: "DESIGN", title: "Programme Planning", text: "Define the training scope, learning pathway, delivery method, assessment criteria and implementation plan." },
  { number: "03", code: "UNDERSTAND", title: "Theory", text: "Build essential knowledge of principles, hazards, procedures, responsibilities and technical requirements." },
  { number: "04", code: "APPLY", title: "Practical Training", text: "Translate knowledge into performance through demonstrations, guided exercises and workplace-based scenarios." },
  { number: "05", code: "VERIFY", title: "Assessment", text: "Evaluate understanding and practical execution against clearly defined competency and safety criteria." },
  { number: "06", code: "RECOGNISE", title: "Certification", text: "Record successful completion or verified competency according to the requirements of the programme." },
  { number: "07", code: "IMPROVE", title: "Continuous Improvement", text: "Review participant results, client feedback and delivery findings to strengthen future programme effectiveness." },
];
'@

$methodPattern = 'const methodology\s*=\s*\[[\s\S]*?\];'
if ($page -match $methodPattern) {
  $page = [regex]::Replace($page, $methodPattern, $newMethodology.Trim(), 1)
} else {
  throw 'Blok const methodology tidak dijumpai dalam app\page.js.'
}

$newSection = @'
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
                {index < methodology.length - 1 && <span className="method-connector" aria-hidden="true">→</span>}
              </article>
            ))}
          </div>

          <div className="method-outcome">
            <span>END RESULT</span>
            <strong>Competent people. Safer execution. Stronger organisational performance.</strong>
          </div>
        </div>
      </section>
'@

$sectionPattern = '(?s)\s*<section id="methodology"[\s\S]*?</section>'
if ($page -match $sectionPattern) {
  $page = [regex]::Replace($page, $sectionPattern, "`r`n" + $newSection.TrimEnd(), 1)
} else {
  throw 'Seksyen Training Methodology tidak dijumpai dalam app\page.js.'
}

Set-Content -Path $pagePath -Value $page -Encoding utf8

$css = Get-Content $cssPath -Raw
$marker = '/* ===== Training Methodology: premium process timeline ===== */'
if (-not $css.Contains($marker)) {
$methodCss = @'

/* ===== Training Methodology: premium process timeline ===== */
.method-section{position:relative;overflow:hidden;background:radial-gradient(circle at 10% 15%,rgba(225,169,37,.13),transparent 28%),radial-gradient(circle at 92% 78%,rgba(35,88,154,.22),transparent 34%),linear-gradient(145deg,#081a3a 0%,#0b2c56 52%,#103d72 100%);color:#fff}
.method-section .container{position:relative;z-index:1}.method-heading{max-width:none;align-items:end;margin-bottom:48px}.method-heading h2{max-width:720px;color:#fff}.method-heading>p{max-width:430px;margin:0;color:#cbd8eb;font-size:16px;line-height:1.75}.method-section .eyebrow{background:rgba(255,255,255,.08);border-color:rgba(244,199,93,.36);color:#f4c75d}
.method-timeline{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:12px;align-items:stretch}.method-step{position:relative;min-width:0;min-height:285px;padding:24px 18px 22px;border:1px solid rgba(255,255,255,.15);border-radius:22px;background:linear-gradient(180deg,rgba(255,255,255,.11),rgba(255,255,255,.055));box-shadow:0 18px 44px rgba(0,0,0,.13);transition:transform .22s ease,border-color .22s ease}.method-step:hover{transform:translateY(-7px);border-color:rgba(244,199,93,.58)}
.method-step-marker{width:48px;height:48px;display:grid;place-items:center;margin-bottom:23px;border-radius:15px;background:#e1a925;color:#081a3a}.method-step-marker span{font-size:13px;font-weight:950;letter-spacing:.08em}.method-step-content small{display:block;color:#f4c75d;font-size:9px;font-weight:950;letter-spacing:.15em;margin-bottom:9px}.method-step-content h3{margin:0 0 12px;color:#fff;font-size:17px;line-height:1.25}.method-step-content p{margin:0;color:#cbd8eb;font-size:12.5px;line-height:1.65}
.method-connector{position:absolute;top:42px;right:-15px;z-index:4;width:28px;height:28px;display:grid;place-items:center;border-radius:50%;background:#fff;color:#a87309;font-size:14px;font-weight:950;box-shadow:0 8px 18px rgba(0,0,0,.2)}.method-outcome{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-top:30px;padding:22px 26px;border:1px solid rgba(244,199,93,.32);border-radius:20px;background:rgba(5,20,45,.46)}.method-outcome span{color:#f4c75d;font-size:10px;font-weight:950;letter-spacing:.16em}.method-outcome strong{max-width:780px;color:#fff;font-size:16px;line-height:1.5;text-align:right}
@media(max-width:1100px){.method-timeline{grid-template-columns:repeat(4,minmax(0,1fr))}.method-step{min-height:250px}.method-step:nth-child(4) .method-connector{display:none}}
@media(max-width:760px){.method-heading{align-items:start;margin-bottom:34px}.method-heading>p{max-width:650px}.method-timeline{grid-template-columns:1fr;gap:14px}.method-step{min-height:0;padding:22px 22px 22px 82px}.method-step-marker{position:absolute;left:20px;top:22px}.method-connector{display:none}.method-outcome{align-items:flex-start;flex-direction:column}.method-outcome strong{text-align:left}}
'@
  Add-Content -Path $cssPath -Value $methodCss -Encoding utf8
}

Write-Host 'Training Methodology berjaya dikemas kini.' -ForegroundColor Green
