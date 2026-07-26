/**
 * Public, read-only certificate verification endpoint.
 *
 * Add this file to the existing TERAS UNIVERSAL Apps Script project, then
 * deploy that project as a web app. It returns only safe public information.
 */
// In Apps Script: Project Settings -> Script properties
// TUTMS_SPREADSHEET_ID = the ID of the private participant management Sheet.
const TU_CERTIFICATE_SPREADSHEET_ID_PROPERTY = "TUTMS_SPREADSHEET_ID";
const TU_CERTIFICATE_SHEET = "CERTIFICATE_REGISTER";
const TU_CERTIFICATE_HEADER_ROW = 4;

function doGet(e) {
  const searchValue = String((e && e.parameter && e.parameter.code) || "")
    .trim()
    .toUpperCase();

  if (!searchValue || searchValue.length > 120 || !/^[A-Z0-9 .\/-]+$/.test(searchValue)) {
    return tuCertificateJson_({ found: false });
  }

  const sheet = tuCertificateSpreadsheet_()
    .getSheetByName(TU_CERTIFICATE_SHEET);
  if (!sheet) throw new Error("CERTIFICATE_REGISTER sheet not found.");

  const lastRow = sheet.getLastRow();
  if (lastRow <= TU_CERTIFICATE_HEADER_ROW) return tuCertificateJson_({ found: false });

  const values = sheet.getRange(
    TU_CERTIFICATE_HEADER_ROW,
    1,
    lastRow - TU_CERTIFICATE_HEADER_ROW + 1,
    sheet.getLastColumn()
  ).getValues();
  const columns = tuCertificateHeaders_(values[0]);
  const required = [
    "Certificate Number", "Verification Code", "Nama peserta", "Nama kursus",
    "Tarikh kursus", "Tarikh dikeluarkan", "Tarikh tamat", "Status", "Link sijil"
  ];
  required.forEach(function (header) {
    if (columns[header] === undefined) throw new Error("Missing header: " + header);
  });

  const row = values.slice(1).find(function (item) {
    return ["Verification Code", "Certificate Number"].some(function (header) {
      return String(item[columns[header]] || "").trim().toUpperCase() === searchValue;
    });
  });

  if (!row) return tuCertificateJson_({ found: false });

  const status = String(row[columns["Status"]] || "").trim().toUpperCase();
  const publicStatus = status === "VALID" ? "valid" : status === "EXPIRED" ? "expired" : status === "REVOKED" ? "revoked" : "pending";

  return tuCertificateJson_({
    found: true,
    certificate: {
      participantName: String(row[columns["Nama peserta"]] || ""),
      courseName: String(row[columns["Nama kursus"]] || ""),
      certificateNumber: String(row[columns["Certificate Number"]] || ""),
      trainingStartDate: tuCertificateDate_(row[columns["Tarikh kursus"]]),
      trainingEndDate: tuCertificateDate_(row[columns["Tarikh kursus"]]),
      issueDate: tuCertificateDate_(row[columns["Tarikh dikeluarkan"]]),
      expiryDate: tuCertificateDate_(row[columns["Tarikh tamat"]]),
      status: publicStatus,
      certificateFileUrl: String(row[columns["Link sijil"]] || "")
    }
  });
}

function tuCertificateHeaders_(headers) {
  const result = {};
  headers.forEach(function (header, index) { result[String(header).trim()] = index; });
  return result;
}

function tuCertificateSpreadsheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties()
    .getProperty(TU_CERTIFICATE_SPREADSHEET_ID_PROPERTY);
  if (!spreadsheetId) {
    throw new Error("TUTMS_SPREADSHEET_ID Script Property is not configured.");
  }
  return SpreadsheetApp.openById(spreadsheetId);
}

function tuCertificateDate_(value) {
  if (!(value instanceof Date) || isNaN(value.getTime())) return null;
  return Utilities.formatDate(value, "Asia/Kuala_Lumpur", "yyyy-MM-dd");
}

function tuCertificateJson_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
