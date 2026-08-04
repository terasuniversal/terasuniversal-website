"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "../../lib/supabase/client";

/**
 * Uploads an image to the Supabase `media` storage bucket and writes the public
 * URL into a hidden input (so it submits with the surrounding form). A plain
 * URL field is always available as a fallback if Storage isn't configured.
 */
export function ImageUpload({
  name,
  label,
  defaultUrl = "",
  folder = "trainers",
}: {
  name: string;
  label: string;
  defaultUrl?: string;
  folder?: string;
}) {
  const [url, setUrl] = useState(defaultUrl);
  const [status, setStatus] = useState<string>("");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setStatus("Only image files can be uploaded."); return; }
    if (file.size > 5 * 1024 * 1024) { setStatus("Image must be 5 MB or smaller."); return; }
    setStatus("Uploading…");
    try {
      const supabase = createSupabaseBrowserClient();
      const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
      const path = `${folder}/${name}-${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("media").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("media").getPublicUrl(path);
      setUrl(data.publicUrl);
      setStatus("Uploaded ✓");
    } catch (err: any) {
      setStatus(`Upload failed (${err?.message ?? "error"}). Paste a URL instead.`);
    }
  }

  return (
    <div className="ta-field">
      <label htmlFor={`${name}_url`}>{label}</label>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {url && <img src={url} alt="" style={{ height: 46, maxWidth: 120, objectFit: "contain", border: "1px solid var(--ta-line)", borderRadius: 6, background: "#fff", padding: 3 }} />}
        <label className="ta-btn ta-btn-outline ta-btn-sm" style={{ cursor: "pointer" }}>
          Upload<input type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />
        </label>
        <input id={`${name}_url`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="or paste image URL" style={{ flex: 1, minWidth: 180, padding: "9px 11px", border: "1px solid var(--ta-line)", borderRadius: 9 }} />
      </div>
      {status && <small style={{ color: "var(--ta-muted)" }}>{status}</small>}
      <input type="hidden" name={name} value={url} />
    </div>
  );
}
