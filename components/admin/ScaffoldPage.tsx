import Link from "next/link";
import { PageHead, Card } from "./ui";

/**
 * Placeholder for modules whose data layer + RLS are complete but whose full
 * CRUD UI has not yet been hand-built. Each of these follows the EXACT same
 * pattern as the reference Courses module (list → form → server actions).
 * See docs/08-remaining-tasks.md.
 */
export function ScaffoldPage({
  title,
  subtitle,
  table,
  bullets,
}: {
  title: string;
  subtitle: string;
  table: string;
  bullets: string[];
}) {
  return (
    <>
      <PageHead title={title} subtitle={subtitle} />
      <Card title="Module scaffolded — data layer ready">
        <div className="ta-card-pad">
          <p style={{ marginTop: 0 }}>
            The database table <code>{table}</code>, its RLS policies, audit triggers and seed
            data are <strong>complete and tested</strong>. The admin UI for this module follows
            the same three-file pattern as the reference <Link href="/admin/courses">Courses</Link> module:
          </p>
          <ul style={{ color: "var(--ta-muted)", lineHeight: 1.9 }}>
            <li><code>page.tsx</code> — list with search, filters, pagination</li>
            <li><code>[id]/page.tsx</code> + <code>new/page.tsx</code> — edit / create form</li>
            <li><code>actions.ts</code> — Zod-validated server actions (create / update / soft-delete)</li>
          </ul>
          <p><strong>This module manages:</strong></p>
          <ul style={{ color: "var(--ta-muted)", lineHeight: 1.9 }}>
            {bullets.map((b) => <li key={b}>{b}</li>)}
          </ul>
          <Link href="/admin/courses/new" className="ta-btn ta-btn-outline" style={{ marginTop: 8 }}>
            See the reference implementation →
          </Link>
        </div>
      </Card>
    </>
  );
}
