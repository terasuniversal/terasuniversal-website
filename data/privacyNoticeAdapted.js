import original from "./privacyNoticeDraft";

// ADAPTED DRAFT: PENDING LEGAL APPROVAL. NOT APPROVED FOR PUBLICATION.
// The Owner's draft stays unchanged in data/privacyNoticeDraft.js. This module derives from it and replaces ONLY two passages,
// so that the notice describes what the /ebook flow actually does today (Owner policy, Option A):
//   1. the "free eBook" row of the data table: email required, name and phone optional, a required privacy acknowledgement,
//      campaign source (UTM) and technical details for security and rate limiting, and an immediate PDF download;
//   2. the sentence in section 3 (Marketing) that tied marketing consent to the eBook form: the eBook request asks for and
//      records no marketing consent.
// It states facts about the form only; no legal terms (retention, DPO, transfers, minors) are added or decided here.
// Every other section is the Owner's text.
const adaptedRow = {
  ms: [
    [
      "Anda meminta dan memuat turun eBook percuma ",
      { mark: "[disesuaikan daripada draf Pemilik: menunggu kelulusan undang-undang]" },
    ],
    [
      "E-mel; nama dan telefon (jika anda isi); pengakuan Notis Privasi; sumber kempen (UTM); butiran teknikal untuk keselamatan dan had kadar ",
      { mark: "[pengesahan diperlukan: alamat IP]" },
    ],
    ["E-mel dan pengakuan Notis Privasi wajib. Nama dan telefon adalah pilihan."],
  ],
  en: [
    [
      "You request and download the free eBook ",
      { mark: "[adapted from the Owner's draft: pending legal approval]" },
    ],
    [
      "Email; name and phone (if you fill them in); privacy-notice acknowledgement; campaign source (UTM); technical details for security and rate limiting ",
      { mark: "[to confirm: IP address]" },
    ],
    ["Email and the privacy-notice acknowledgement are required. Name and phone are optional."],
  ],
};

const adaptedMarketing = {
  ms: [
    "Kami hanya menghantar pemasaran jika anda memilihnya. Permintaan eBook tidak meminta dan tidak merekod persetujuan pemasaran, dan kami tidak menghantar pemasaran kepada anda hasil permintaan ini. Anda boleh berhenti bila-bila masa dengan menghubungi kami atau menggunakan pautan berhenti langgan. ",
    { mark: "[disesuaikan daripada draf Pemilik: menunggu kelulusan undang-undang]" },
  ],
  en: [
    "We send marketing only if you choose it. An eBook request does not ask for or record marketing consent, and we do not send you marketing as a result of this request. You can stop at any time by contacting us or using the unsubscribe link. ",
    { mark: "[adapted from the Owner's draft: pending legal approval]" },
  ],
};

const isEbookRow = (row) => JSON.stringify(row[0]).match(/memuat turun eBook|download the free eBook/);
const isMarketingParagraph = (block) => block.type === "p" && JSON.stringify(block.content).match(/persetujuan menerima eBook|your request for the eBook/);

const privacyNoticeAdapted = original.map((section) => ({
  ...section,
  blocks: section.blocks.map((block) => {
    if (block.type === "table") return { ...block, rows: block.rows.map((row) => (isEbookRow(row) ? adaptedRow[section.lang] : row)) };
    if (isMarketingParagraph(block)) return { ...block, content: adaptedMarketing[section.lang] };
    return block;
  }),
}));

export default privacyNoticeAdapted;
