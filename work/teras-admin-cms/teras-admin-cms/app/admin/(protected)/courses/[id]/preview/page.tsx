import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireRole } from "../../../../../../lib/auth/session";
import type { Course } from "../../../../../../lib/supabase/database.types";

export const metadata = { title: "Preview Course — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

/**
 * Preview-before-publish. Staff can see exactly how a course will render on
 * the public site, INCLUDING drafts (staff RLS returns unpublished rows).
 * A sticky banner makes clear this is a preview, not the live page.
 */
export default async function CoursePreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("editor");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("courses").select("*").eq("id", id).single();
  if (!data) notFound();
  const course = data as Course;

  return (
    <>
      <div
        style={{
          position: "sticky", top: 0, zIndex: 10, marginBottom: 20,
          background: course.status === "published" ? "#2e9e5b" : "#E1A925",
          color: course.status === "published" ? "#fff" : "#0B2C56",
          padding: "10px 16px", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        }}
      >
        <strong>
          {course.status === "published" ? "● LIVE" : `● PREVIEW — status: ${course.status}`}
        </strong>
        <span style={{ display: "flex", gap: 8 }}>
          <Link href={`/admin/courses/${id}`} className="ta-btn ta-btn-sm ta-btn-outline">Edit</Link>
          {course.status === "published" && (
            <a href={`/courses/${course.slug}`} target="_blank" rel="noreferrer" className="ta-btn ta-btn-sm ta-btn-primary">Open live page ↗</a>
          )}
        </span>
      </div>

      {/* Public-style rendering of the course content */}
      <article className="ta-card ta-card-pad" style={{ maxWidth: 860 }}>
        {course.category && <span className="ta-badge-pill draft" style={{ marginBottom: 10, display: "inline-block" }}>{course.category}</span>}
        <h1 style={{ fontSize: 34, margin: "6px 0 12px" }}>{course.title}</h1>
        {course.summary && <p style={{ fontSize: 18, color: "var(--ta-muted)" }}>{course.summary}</p>}
        {course.duration && <p><strong>Duration:</strong> {course.duration}</p>}

        {course.overview && (
          <section style={{ marginTop: 20 }}>
            <h2 style={{ fontSize: 22 }}>Overview</h2>
            <p style={{ whiteSpace: "pre-wrap" }}>{course.overview}</p>
          </section>
        )}

        {course.objectives?.length > 0 && (
          <section style={{ marginTop: 20 }}>
            <h2 style={{ fontSize: 22 }}>Objectives</h2>
            <ul>{course.objectives.map((o, i) => <li key={i}>{o}</li>)}</ul>
          </section>
        )}

        {course.modules?.length > 0 && (
          <section style={{ marginTop: 20 }}>
            <h2 style={{ fontSize: 22 }}>Modules</h2>
            <ol>{course.modules.map((m, i) => <li key={i}>{m.title}</li>)}</ol>
          </section>
        )}

        {course.target_audience?.length > 0 && (
          <section style={{ marginTop: 20 }}>
            <h2 style={{ fontSize: 22 }}>Who should attend</h2>
            <ul>{course.target_audience.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </section>
        )}
      </article>
    </>
  );
}
