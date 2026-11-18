// Notis Privasi — Bahasa Melayu, v0.5 yang diluluskan pemilik (asas v0.4: docs/WEBSITE-PUBLIC-FIRST-PRIVACY-K3/
// PRIVACY-NOTICE-BM-DRAFT.md, keputusan D-05/D-06/D-09/D-14/L-01, 18 November 2026; v0.5 menambah keputusan W2 K-B dan K-C). Mesti kekal setara dengan
// content/en/privacy.js: 12 bahagian dengan struktur blok yang sama (scripts/privacy-publication-contract.mts).
// Penyimpanan dinyatakan sebagai prinsip umum sahaja; tempoh cadangan 24/12 bulan TIDAK dilaksanakan dan TIDAK diterbitkan.
// Tarikh berkuat kuasa tidak ditulis di sini: halaman memaparkan PRIVACY_EFFECTIVE_DATE dalam lib/privacy-publication.js.
export const privacyNoticeMs = {
  lang: "ms",
  title: "Notis Privasi",
  switchLink: { label: "Read in English", href: "/privacy", lang: "en" },
  tocLabel: "Kandungan",
  pendingLabel: "Belum diputuskan",
  effectiveLabel: "Tarikh berkuat kuasa",
  unpublishedVersion: "Draf v0.5 · tarikh berkuat kuasa ditetapkan semasa penerbitan · belum berkuat kuasa",
  sections: [
    {
      title: "Siapa kami",
      blocks: [
        { p: "Laman web ini (https://www.terasuniversal.com.my) dikendalikan oleh TERAS UNIVERSAL SDN. BHD., sebuah syarikat yang diperbadankan di Malaysia. Dalam notis ini, “TERAS” dan “kami” bermaksud TERAS UNIVERSAL SDN. BHD." },
        { rows: [
          ["No. Pendaftaran", "201201003207 (976732-P)"],
          ["Alamat berdaftar", "No. 1559 (Tingkat 2), Jalan Kota, P.O. Box 106, 05710 Alor Setar, Kedah, Malaysia"],
          ["Alamat perniagaan dan pusat latihan", "Lot 1961, Kampung Tanah Merah, Tanah Merah Dalam, 06000 Jitra, Kedah, Malaysia"],
        ] },
      ],
    },
    {
      title: "Data peribadi yang kami kumpul melalui laman web ini",
      blocks: [
        { list: [
          "Borang hubungan: nama, syarikat, alamat e-mel, nombor telefon, jenis pertanyaan, subjek dan mesej anda, serta halaman borang dihantar.",
          "Borang Permohonan Cadangan (Request a Proposal): syarikat, nama, jawatan, e-mel perniagaan, nombor telefon, industri, kategori dan program latihan yang diminati, bilangan peserta, lokasi, bulan pilihan, julat bajet, objektif latihan dan nota.",
          "Pengesahan sijil (/verify): nombor sijil atau pautan pengesahan yang anda masukkan. Kami juga merekodkan alamat IP anda, maklumat pelayar (user-agent) dan keputusan setiap semakan dalam log pengesahan.",
          "Data teknikal: penyedia hos kami memproses data permintaan biasa seperti alamat IP, jenis pelayar dan halaman yang anda minta. Untuk mengelakkan penghantaran berulang atau automatik, kami menyemak sama ada borang telah dihantar baru-baru ini daripada alamat e-mel yang sama.",
        ] },
        { p: "Kami tidak meminta data peribadi sensitif melalui borang ini. Sila jangan masukkannya dalam mesej anda." },
      ],
    },
    {
      title: "Mengapa kami menggunakan data peribadi anda",
      blocks: [
        { list: [
          "Untuk menjawab pertanyaan anda dan menyediakan cadangan latihan atau sebut harga yang anda minta.",
          "Untuk merekodkan pertanyaan dan permohonan cadangan dalam rekod pelanggan kami dan membuat susulan sebagai hubungan perniagaan. Jika sesuatu pertanyaan membawa kepada latihan atau kontrak, butiran berkaitan menjadi sebahagian daripada rekod perniagaan, sebut harga dan perakaunan kami.",
          "Untuk menghantar e-mel pengesahan bahawa kami telah menerima permohonan cadangan anda.",
          "Untuk mengesahkan sama ada sijil TERAS adalah sah, dan menyimpan rekod keselamatan semakan pengesahan supaya kami dapat mengesan penyalahgunaan.",
          "Untuk memastikan keselamatan laman web, mencegah spam dan membaiki masalah teknikal.",
        ] },
        { p: "Kami menggunakan data anda hanya untuk tujuan ini atau tujuan yang berkaitan secara langsung dengannya. Kami tidak menjual data peribadi anda." },
        { p: "Menghantar pertanyaan atau permohonan cadangan tidak mendaftarkan anda untuk e-mel pemasaran. Kami hanya akan memasukkan anda ke dalam komunikasi pemasaran kami dengan persetujuan berasingan anda, dan anda boleh menarik balik persetujuan itu pada bila-bila masa." },
      ],
    },
    {
      title: "Pilihan anda",
      blocks: [{ p: "Pemberian maklumat anda adalah secara sukarela. Jika anda tidak memberikan maklumat yang ditanda wajib dalam borang, kami mungkin tidak dapat menjawab pertanyaan atau menyediakan cadangan. Dengan menghantar borang, anda bersetuju dengan pemprosesan data anda seperti yang diterangkan dalam notis ini." }],
    },
    {
      title: "Dengan siapa kami berkongsi data anda",
      blocks: [
        { p: "Kami berkongsi data anda hanya dengan penyedia perkhidmatan yang membantu kami mengendalikan laman web ini dan menjawab anda, dan hanya untuk tujuan tersebut:" },
        { list: [
          "hos laman web (Vercel);",
          "penyedia pangkalan data kami (Supabase), yang menyimpan rekod kami di Singapura;",
          "penyedia penghantaran e-mel kami (Resend), yang menghantar notifikasi borang kepada pasukan kami dan e-mel pengesahan kepada anda;",
          "Google, kerana permohonan cadangan juga mungkin disalin ke dalam hamparan Google yang digunakan oleh pasukan kami.",
        ] },
        { p: "Kami juga boleh mendedahkan data jika dikehendaki oleh undang-undang. Sesetengah penyedia ini mungkin memproses data di luar Malaysia." },
        { p: "Pengesahan sijil adalah terbuka secara reka bentuk. Sesiapa yang memasukkan nombor sijil atau pautan pengesahan yang sah boleh melihat nama pemegang sijil, kursus, tarikh dikeluarkan dan tamat tempoh, serta status sijil. Ini membolehkan majikan dan pihak lain mengesahkan sijil TERAS. Nombor sijil bukan kata laluan, dan butiran yang dipaparkan bukan rahsia kepada pemegang sahaja." },
      ],
    },
    {
      title: "Kuki, kandungan terbenam dan pautan",
      blocks: [{ list: [
        "TERAS tidak menetapkan kuki analitik atau pengiklanan pada laman web awam ini, dan kami tidak menggunakan analitik laman web pada masa ini. Jika kami memperkenalkan analitik, kami akan mengemas kini notis ini terlebih dahulu.",
        "Halaman Hubungi Kami memaparkan peta Google Maps terbenam. Apabila peta dimuatkan, Google mungkin mengumpul maklumat seperti alamat IP anda dan mungkin menetapkan kukinya sendiri, tertakluk kepada dasar privasi Google.",
        "Pautan ke WhatsApp, Facebook atau perkhidmatan luar lain membawa anda ke perkhidmatan tersebut. Dasar privasi mereka sendiri terpakai.",
        "Kuki log masuk hanya digunakan di kawasan pentadbiran staf.",
      ] }],
    },
    {
      title: "Pendaftaran dan bayaran dalam talian",
      blocks: [{ p: "Pendaftaran kursus dan bayaran dalam talian yang baharu tidak ditawarkan melalui laman web ini pada masa ini. Rekod pendaftaran atau bayaran invois yang dibuat sebelum ini, termasuk bayaran yang diproses melalui penyedia pembayaran kami (ToyyibPay), terus disimpan dan dikendalikan setakat yang perlu untuk melengkapkan transaksi tersebut dan memenuhi obligasi kami." }],
    },
    {
      title: "Berapa lama kami menyimpan data anda",
      blocks: [{ p: "Kami menyimpan data peribadi hanya selama yang munasabah diperlukan untuk tujuan yang diterangkan dalam notis ini dan untuk memenuhi keperluan undang-undang, kontrak dan penyimpanan rekod yang terpakai. Apabila tidak lagi diperlukan, kami memadam data tersebut atau menjadikannya tanpa nama. Ini terpakai kepada pangkalan data, rekod pelanggan, salinan e-mel dan salinan hamparan kami." }],
    },
    {
      title: "Keselamatan",
      blocks: [{ p: "Kami mengambil langkah teknikal dan organisasi yang munasabah untuk melindungi data peribadi anda. Ini termasuk sambungan bersulit (HTTPS), kawalan akses dan mengehadkan akses kepada staf yang memerlukannya. Tiada kaedah penghantaran atau penyimpanan yang selamat sepenuhnya." }],
    },
    {
      title: "Hak anda dan cara menghubungi kami",
      blocks: [
        { p: "Anda boleh meminta akses kepada atau pembetulan data peribadi anda, menarik balik persetujuan anda, atau meminta kami mengehadkan pemprosesannya, setakat yang dibenarkan oleh undang-undang. Ini termasuk membetulkan butiran yang dipaparkan dalam pengesahan sijil. Sila hantar permintaan dan pertanyaan privasi kepada hubungan privasi kami. Permintaan dikendalikan hanya oleh staf TERAS yang diberi kuasa, di bawah penyeliaan pengurusan syarikat." },
        { rows: [
          ["Hubungan privasi", "TERAS UNIVERSAL SDN. BHD."],
          ["E-mel", "admin@terasuniversal.com.my"],
          ["Telefon", "+60 19-519 3834"],
          ["Alamat", "Lot 1961, Kampung Tanah Merah, Tanah Merah Dalam, 06000 Jitra, Kedah, Malaysia"],
        ] },
        { p: "Kami mungkin perlu mengesahkan identiti anda sebelum bertindak atas sesuatu permintaan." },
      ],
    },
    {
      title: "Perubahan kepada notis ini",
      blocks: [{ p: "Kami mungkin mengemas kini notis ini. Versi semasa dan tarikh berkuat kuasanya akan sentiasa diterbitkan di halaman ini." }],
    },
    {
      title: "Bahasa",
      blocks: [{ p: "Notis ini diterbitkan dalam Bahasa Melayu dan Bahasa Inggeris, dan kedua-dua versi mempunyai makna yang sama." }],
    },
  ],
};
