# TERAS UNIVERSAL CRM Apps Script Backend

This folder contains the Google Apps Script web-app endpoint for proposal leads.

## Setup

1. Create or open the Google Spreadsheet that should receive leads.
2. Open **Extensions → Apps Script**.
3. Paste `Code.gs` into the Apps Script project.
4. In **Project Settings → Script Properties**, add:

   `SPREADSHEET_ID` = the spreadsheet ID from the Google Sheets URL.

5. Deploy as a web app and configure the deployment access according to the organisation's privacy requirements.
6. The script creates a sheet tab named `Training Leads` and writes the header row automatically.

## Accepted JSON fields

`submitted`, `status`, `company`, `contactPerson`, `jobTitle`, `businessEmail`, `phone`, `industry`, `trainingCategory`, `specificProgramme`, `participants`, `trainingLocation`, `preferredMonth`, `budget`, `trainingObjectives`, `additionalNotes`.

`status` defaults to `New` and `submitted` defaults to the current ISO timestamp.

## Response behaviour

A valid request returns:

```json
{"success":true}
```

Invalid JSON or missing required fields returns JSON with `success: false`, an error message and `statusCode: 400`.

Google Apps Script's `ContentService` does not provide a supported arbitrary HTTP status-code setter for web-app `TextOutput` responses. If a literal HTTP 400 response is required, place an API gateway or serverless proxy in front of the Apps Script endpoint.

The endpoint does not send email, call an external API or store data anywhere except the configured Google Sheet.