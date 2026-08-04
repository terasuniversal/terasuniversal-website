import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { Badge, Card, EmptyState, PageHead } from "../../../../components/admin/ui";

export const metadata = { title: "Media Library — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

type Media = { id: string; file_name: string; kind: string; mime_type: string | null; file_size: number | null; public_url: string | null; folder_id: string | null; created_at: string; title: string | null; alt_text: string | null };
type Folder = { id: string; name: string; path: string };

export default async function MediaPage({ searchParams }: { searchParams: Promise<{ q?: string; folder?: string; kind?: string }> }) {
  await requireRole("editor");
  const filters = await searchParams;
  const supabase = await createSupabaseServerClient();
  const mediaTable = supabase.from("media") as any;
  let filesQuery = mediaTable.select("id, file_name, kind, mime_type, file_size, public_url, folder_id, created_at, title, alt_text").is("deleted_at", null).order("created_at", { ascending: false }).limit(60);
  if (filters.q?.trim()) filesQuery = filesQuery.or(`file_name.ilike.%${filters.q.trim().replace(/[%_,()]/g, " ")}%,title.ilike.%${filters.q.trim().replace(/[%_,()]/g, " ")}%,alt_text.ilike.%${filters.q.trim().replace(/[%_,()]/g, " ")}%`);
  if (filters.folder) filesQuery = filesQuery.eq("folder_id", filters.folder);
  if (filters.kind) filesQuery = filesQuery.eq("kind", filters.kind);
  const [filesRes, foldersRes] = await Promise.all([filesQuery, (supabase.from("media_folders") as any).select("id, name, path").order("path").order("name")]);
  const files = (filesRes.data ?? []) as Media[];
  const folders = (foldersRes.data ?? []) as Folder[];
  const bytes = files.reduce((total, file) => total + (Number(file.file_size) || 0), 0);
  const size = bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : "0 MB";

  return <>
    <PageHead title="Media Library" subtitle="Find, preview and organise the files used throughout the website and training records." action={<Link className="ta-btn ta-btn-outline" href="/admin/gallery/new">Add gallery image</Link>} />
    <form className="ta-toolbar" role="search" style={{ alignItems: "flex-end" }}>
      <div className="ta-search" style={{ maxWidth: 320 }}><input type="search" name="q" defaultValue={filters.q ?? ""} placeholder="Search file name, title or alt text" aria-label="Search media files" /></div>
      <select name="folder" defaultValue={filters.folder ?? ""} aria-label="Filter by folder"><option value="">All folders</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.path}{folder.name}</option>)}</select>
      <select name="kind" defaultValue={filters.kind ?? ""} aria-label="Filter by file type"><option value="">All file types</option>{["image", "pdf", "document", "video", "other"].map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select>
      <button className="ta-btn ta-btn-outline ta-btn-sm" type="submit">Apply filters</button>
      <span className="ta-spacer" /><span style={{ color: "var(--ta-muted)", fontSize: 13 }}>{files.length} files · {size} shown</span>
    </form>
    <Card title="Files" action={<span style={{ color: "var(--ta-muted)", fontSize: 12 }}>Version history is recorded when file replacement infrastructure is enabled.</span>}>
      {files.length ? <div className="ta-table-wrap"><table className="ta-table"><thead><tr><th>Preview</th><th>File</th><th>Type</th><th>Folder</th><th>Size</th><th>Added</th><th></th></tr></thead><tbody>{files.map((file) => {
        const folder = folders.find((item) => item.id === file.folder_id);
        return <tr key={file.id}><td>{file.kind === "image" && file.public_url ? <img src={file.public_url} alt={file.alt_text || ""} width={48} height={36} style={{ objectFit: "cover", borderRadius: 4 }} /> : <span aria-hidden="true">{file.kind === "pdf" ? "📄" : "📎"}</span>}</td><td><strong>{file.file_name}</strong><div style={{ color: "var(--ta-muted)", fontSize: 12 }}>{file.title || file.alt_text || "No description"}</div></td><td><Badge status={file.kind} /></td><td>{folder?.name ?? "Unfiled"}</td><td>{file.file_size ? `${Math.ceil(file.file_size / 1024)} KB` : "—"}</td><td>{new Date(file.created_at).toLocaleDateString("en-MY")}</td><td style={{ textAlign: "right" }}>{file.public_url ? <a className="ta-btn ta-btn-outline ta-btn-sm" href={file.public_url} target="_blank" rel="noreferrer">Preview</a> : <span style={{ color: "var(--ta-muted)" }}>Private</span>}</td></tr>;
      })}</tbody></table></div> : <EmptyState icon="🗂️" message="No files match these filters." />}
    </Card>
  </>;
}
