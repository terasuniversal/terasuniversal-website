import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import { createWorker } from "tesseract.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();

export const requiredFields = ["participant_name", "identity_no", "course_name", "course_date", "certificate_no"];
const clean = (value) => String(value || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
const normalize = (value) => clean(value).toUpperCase().replace(/[.\-\/\\\s]/g, "");

function valueAfterLabel(text, labels) {
  const pattern = new RegExp(`(?:${labels.join("|")})\\s*[:#-]?\\s*(.+)`, "im");
  return text.match(pattern)?.[1]?.split("\n")[0]?.trim() || "";
}

function dateValue(value) {
  const match = clean(value).match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b/);
  if (!match) return "";
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

export function parseCertificateText(text, fileName, extraction_source = "pdf-text") {
  const raw = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = raw.split("\n").map(clean).filter(Boolean);
  const participant = valueAfterLabel(raw, ["nama peserta", "participant name", "name of participant"]) || lines.find((line) => /\b[A-Z]{2,}(?:\s+[A-Z]{2,}){1,}\b/.test(line) && !/TERAS|CERTIFICATE|SIJIL|KURSUS|COURSE/.test(line)) || "";
  const identity = valueAfterLabel(raw, ["no\\.?\\s*(?:ic|kad pengenalan)", "nric", "identity no", "passport no"]);
  const certificate = valueAfterLabel(raw, ["no\\.?\\s*sijil", "certificate no(?:\\.|ber)?", "certificate number", "serial no"]) || raw.match(/\b(?:TU|TERAS)[-\s]?\d{3,}\b/i)?.[0] || "";
  const course = valueAfterLabel(raw, ["nama kursus", "course name", "training programme", "program latihan"]);
  const course_date = dateValue(valueAfterLabel(raw, ["tarikh kursus", "course date", "date of training", "tarikh latihan"]) || raw);
  const expiry_date = dateValue(valueAfterLabel(raw, ["tarikh tamat", "expiry date", "valid until"]));
  const instructor = valueAfterLabel(raw, ["instructor", "trainer", "jurulatih"]);
  const venue = valueAfterLabel(raw, ["lokasi", "location", "venue"]);
  const row = { participant_name: clean(participant), identity_no: normalize(identity), course_name: clean(course), course_date, certificate_no: normalize(certificate), status: "valid", expiry_date, instructor: clean(instructor), venue: clean(venue), public_verification_enabled: true, source_file: fileName, extraction_source, extraction_confidence: extraction_source === "ocr" ? 0.65 : 0.9, raw_text: raw.slice(0, 12000) };
  const missing = requiredFields.filter((field) => !row[field]);
  return { ...row, parse_status: missing.length ? "needs_review" : "ready", error_message: missing.length ? `Medan belum ditemui: ${missing.join(", ")}` : "" };
}

async function extractPdfText(file) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  return { pdf, text: pages.join("\n") };
}

async function ocrPdf(pdf, onProgress) {
  const worker = await createWorker("eng");
  let output = "";
  try {
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      const viewport = page.getViewport({ scale: 1.7 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      const result = await worker.recognize(canvas, {}, { text: true });
      output += `${result.data.text}\n`;
      onProgress?.(index / pdf.numPages);
    }
  } finally { await worker.terminate(); }
  return output;
}

export async function extractCertificate(file, { useOcr = true, onProgress } = {}) {
  const { pdf, text } = await extractPdfText(file);
  if (clean(text).length >= 40) return parseCertificateText(text, file.name);
  if (!useOcr) return parseCertificateText(text, file.name);
  return parseCertificateText(await ocrPdf(pdf, onProgress), file.name, "ocr");
}

export function validateRows(rows) {
  const seen = new Map();
  return rows.map((row) => {
    const key = row.certificate_no || `${row.identity_no}|${row.course_date}`;
    const duplicate = key && seen.get(key);
    if (key && !duplicate) seen.set(key, row.source_file);
    const errors = [...(row.error_message ? [row.error_message] : [])];
    if (duplicate) errors.push(`Duplikasi dengan ${duplicate}`);
    return { ...row, parse_status: errors.length ? "needs_review" : "ready", error_message: errors.join("; ") };
  });
}

export function rowsToCsv(rows) {
  const columns = [...requiredFields, "status", "expiry_date", "instructor", "venue", "public_verification_enabled", "source_file", "extraction_source", "extraction_confidence", "parse_status", "error_message"];
  const quote = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [columns.join(","), ...rows.map((row) => columns.map((column) => quote(row[column])).join(","))].join("\r\n");
}

export function downloadCsv(rows) {
  const url = URL.createObjectURL(new Blob(["\ufeff", rowsToCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = "teras-certificate-import.csv"; link.click(); URL.revokeObjectURL(url);
}
