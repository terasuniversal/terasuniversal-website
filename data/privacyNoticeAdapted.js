import original from "./privacyNoticeDraft";

// ADAPTED DRAFT: PENDING LEGAL APPROVAL. NOT APPROVED FOR PUBLICATION.
// The Owner's draft stays unchanged in data/privacyNoticeDraft.js. This module derives from it and replaces ONLY the
// "free eBook" row of the data table, so that the notice describes what the /ebook form actually does today:
// email required, name and phone optional, a separate privacy acknowledgement (required) and marketing choice (optional),
// and no download yet (delivery is not active until the Owner approves storage). It states facts about the form only;
// no legal terms (retention, DPO, transfers, minors) are added or decided here. Every other section is the Owner's text.
const adaptedRow = {
  ms: [
    [
      "Anda meminta eBook percuma ",
      { mark: "[disesuaikan daripada draf Pemilik: menunggu kelulusan undang-undang]" },
      " Penghantaran atau muat turun eBook belum aktif.",
    ],
    ["E-mel; nama dan telefon (jika anda isi); pengakuan Notis Privasi; pilihan pemasaran; sumber kempen (UTM)"],
    ["E-mel dan pengakuan Notis Privasi wajib. Nama, telefon dan pilihan pemasaran adalah pilihan dan berasingan."],
  ],
  en: [
    [
      "You request the free eBook ",
      { mark: "[adapted from the Owner's draft: pending legal approval]" },
      " eBook delivery or download is not active yet.",
    ],
    ["Email; name and phone (if you fill them in); privacy-notice acknowledgement; marketing choice; campaign source (UTM)"],
    ["Email and the privacy-notice acknowledgement are required. Name, phone and the marketing choice are optional and separate."],
  ],
};

const isEbookRow = (row) => JSON.stringify(row[0]).match(/memuat turun eBook|download the free eBook/);

const privacyNoticeAdapted = original.map((section) => ({
  ...section,
  blocks: section.blocks.map((block) =>
    block.type === "table" ? { ...block, rows: block.rows.map((row) => (isEbookRow(row) ? adaptedRow[section.lang] : row)) } : block,
  ),
}));

export default privacyNoticeAdapted;
