import Image from "next/image";

// W10-UX-01 Option B (W9-LAUNCH-PREP L-C): the loading boundary used to sit at the app root, so every public page was
// streamed behind it and stayed hidden without JavaScript. It now wraps only /calendar, the one public route that
// waits on live schedule data. Streamed content is still revealed by script here, so the fallback itself carries a
// <noscript> message with plain links instead of an endless loading bar.
export default function Loading() {
    return (
          <div className="loading-screen" role="status" aria-label="Loading TERAS UNIVERSAL">
            <Image src="/teras-universal-logo.png" alt="" width={230} height={162} priority />
            <div className="loading-bar"><span /></div>
        <p>Building Competence. Creating Opportunities.</p>
        <noscript>
          <p>The training calendar needs JavaScript. You can still browse our <a href="/training">training courses</a> or <a href="/contact">contact us</a> for session dates.</p>
        </noscript>
      </div>
    );
}
