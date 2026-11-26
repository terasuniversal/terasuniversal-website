import Image from "next/image";

export default function Loading() {
    return (
          <div className="loading-screen" role="status" aria-label="Loading TERAS UNIVERSAL">
            <Image src="/teras-universal-logo.png" alt="" width={230} height={162} priority />
            <div className="loading-bar"><span /></div>
        <p>Building Competence. Creating Opportunities.</p>
      </div>
    );
}
