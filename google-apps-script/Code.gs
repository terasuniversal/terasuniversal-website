/**
 * TERAS UNIVERSAL CRM - Google Apps Script web app endpoint.
 *
 * Configure the spreadsheet ID in Apps Script:
 * Project Settings > Script Properties > SPREADSHEET_ID
 * The target sheet tab is created automatically as "Training Leads".
 */

const CONFIG = {
  sheetName: "Training Leads",
  spreadsheetIdProperty: "SPREADSHEET_ID",
};

const HEADERS = [
  "submitted",
  "status",
  "company",
  "contactPerson",
  "jobTitle",
  "businessEmail",
  "phone",
  "industry",
  "trainingCategory",
  "specificProgramme",
  "participants",
  "trainingLocation",
  "preferredMonth",
  "budget",
  "trainingObjectives",
  "additionalNotes",
];

/**
 * Receives a JSON proposal submission and appends it to the next row.
 *
 * @param {GoogleAppsScript.Events.DoPost} e Web app POST event.
 * @return {GoogleAppsScript.Content.TextOutput} JSON response.
 */
function doPost(e) {
  try {
    const payload = parseJsonPayload_(e);
    validatePayload_(payload);

    const lead = normalizeLead_(payload);
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);

    try {
      const sheet = getLeadSheet_();
      sheet.appendRow(HEADERS.map(function (header) {
        return lead[header];
      }));
    } finally {
      lock.releaseLock();
    }

    return jsonResponse_({ success: true });
  } catch (error) {
    return jsonResponse_({
      success: false,
      error: error.message || "Invalid request.",
      statusCode: 400,
    });
  }
}

/**
 * Parses the request body as JSON.
 * @param {GoogleAppsScript.Events.DoPost} e
 * @return {Object}
 */
function parseJsonPayload_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error("Request body is required.");
  }

  try {
    const payload = JSON.parse(e.postData.contents);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("JSON payload must be an object.");
    }
    return payload;
  } catch (error) {
    throw new Error("Request body must contain valid JSON.");
  }
}

/**
 * Validates the CRM fields that the proposal form requires.
 * @param {Object} payload
 */
function validatePayload_(payload) {
  const requiredFields = [
    "company",
    "contactPerson",
    "businessEmail",
    "phone",
    "industry",
    "trainingCategory",
    "trainingObjectives",
  ];

  requiredFields.forEach(function (field) {
    if (payload[field] === undefined || payload[field] === null || String(payload[field]).trim() === "") {
      throw new Error("Missing required field: " + field + ".");
    }
  });
}

/**
 * Normalizes the accepted payload into the exact sheet column order.
 * @param {Object} payload
 * @return {Object}
 */
function normalizeLead_(payload) {
  return {
    submitted: payload.submitted || new Date().toISOString(),
    status: payload.status || "New",
    company: payload.company || "",
    contactPerson: payload.contactPerson || "",
    jobTitle: payload.jobTitle || "",
    businessEmail: payload.businessEmail || "",
    phone: payload.phone || "",
    industry: payload.industry || "",
    trainingCategory: payload.trainingCategory || "",
    specificProgramme: payload.specificProgramme || "",
    participants: payload.participants || "",
    trainingLocation: payload.trainingLocation || "",
    preferredMonth: payload.preferredMonth || "",
    budget: payload.budget || "",
    trainingObjectives: payload.trainingObjectives || "",
    additionalNotes: payload.additionalNotes || "",
  };
}

/**
 * Gets or creates the Training Leads sheet tab and its header row.
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getLeadSheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty(CONFIG.spreadsheetIdProperty);
  if (!spreadsheetId) {
    throw new Error("SPREADSHEET_ID script property is not configured.");
  }

  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  let sheet = spreadsheet.getSheetByName(CONFIG.sheetName);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(CONFIG.sheetName);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

/**
 * Returns a JSON ContentService response.
 *
 * Apps Script ContentService does not expose a supported method for setting
 * arbitrary HTTP status codes on web-app responses. Invalid requests therefore
 * return structured JSON with statusCode: 400; a proxy/API gateway is required
 * if a literal HTTP 400 response is mandatory.
 *
 * @param {Object} body
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function jsonResponse_(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}