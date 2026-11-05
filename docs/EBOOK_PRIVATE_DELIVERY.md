# /ebook: Penghantaran PDF Peribadi (Private PDF Delivery)

Status: **kod tempatan sahaja, belum di-commit, dimatikan secara lalai.** Tiada storage jauh, e-mel, env var, migrasi atau muat naik PDF telah dibuat.
Berkaitan: Draft PR #216 (`feat/ebook-lead-capture`), `lib/marketing/ebookDelivery.ts`, `lib/marketing/ebookStorage.ts`, `app/api/ebook/route.ts`, `app/api/ebook/download/route.ts`.

Dokumen ini membezakan tiga jenis dakwaan:
- **[Tempatan]** disahkan dengan ujian atau bacaan kod di mesin ini.
- **[Staging]** belum disahkan; memerlukan ujian sebenar pada Vercel Staging.
- **[Andaian]** pendapat yang belum diuji.

## 1. Dua pendekatan

| | A. Butang muat turun jangka pendek selepas daftar | B. Penghantaran e-mel melalui aliran e-mel disahkan |
|---|---|---|
| Aliran | Borang diterima oleh pangkalan data (outcome disahkan), kemudian server mengeluarkan token HMAC 10 minit. Butang POST memuat turun PDF yang disahkan. | Borang diterima, e-mel pengesahan dihantar, pengguna klik pautan, baru e-mel kedua membawa PDF atau pautan. |
| Bukti pemilikan e-mel | **Tiada.** Sesiapa boleh menaip mana-mana alamat. | **Ada.** |
| Komponen baharu | Satu bucket peribadi, satu rahsia HMAC, satu laluan API. | Penyedia e-mel (domain disahkan SPF/DKIM/DMARC), templat, jadual token pengesahan (jadual + RLS + RPC baharu), pengendalian bounce/aduan, polisi simpanan. |
| Keputusan Pemilik | Storage sahaja. | Storage, penyedia e-mel, wording, polisi pengesahan, notis privasi. |
| Risiko penyalahgunaan | Tiada e-mel dihantar. Token boleh diulang dalam 10 minit (dihadkan oleh had kadar IP). | Boleh digunakan untuk menghantar e-mel kepada pihak ketiga (dihadkan per e-mel). |
| Kesesuaian dengan seni bina | Tinggi: corak sama dengan `certificate-render-assets`. | Rendah buat masa ini. |

### Cadangan: **A** sekarang, B sebagai fasa berasingan

eBook ini percuma dan bertujuan diedarkan; PDF tidak sulit. Yang dilindungi ialah **pautan kekal awam** dan **akses sewenang-wenang ke storage**, bukan kerahsiaan fail daripada penaip e-mel orang lain.

### Adakah pengesahan e-mel diperlukan?

- **Untuk memuat turun (A): tidak.** Sistem **tidak mendakwa** e-mel itu milik penghantar; `email_verified` kekal `false`.
- **Untuk pemasaran: ya, sebelum sebarang penghantaran.** Sesiapa boleh menanda opt-in untuk e-mel orang lain. Double opt-in (atau setara) diperlukan sebelum kenalan daripada borang ini menerima e-mel promosi. Keputusan Pemilik dan perlu semakan PDPA.
- **Untuk B: ya, by design.**

## 2. Reka bentuk (pendekatan A)

```
Pelawat -> POST /api/ebook  (flag, origin, jenis, saiz, had IP, parse, honeypot, Zod, masa isi, had e-mel, RPC)
        -> RPC submit_public_ebook_lead mengembalikan outcome: created | matched | duplicate_request   (selain itu: gagal-tertutup, 502, tiada token)
        -> [hanya jika delivery dihidupkan] token v1.<payload>.<HMAC-SHA256> (600 saat)
Pelawat -> POST /api/ebook/download  (borang HTML biasa, token dalam body)
        -> flag, origin, jenis, saiz, had IP, bacaan terhad, sahkan token
        -> lib/marketing/ebookStorage.ts: baca SATU objek tetap daripada bucket peribadi, dengan had saiz semasa membaca
        -> sahkan saiz, header "%PDF-" dan SHA-256 yang diluluskan
        -> hantar sebagai respons biasa (buffered) dengan Content-Disposition: attachment
```

### Kawalan [Tempatan: ujian unit, kontrak statik, 116 semakan laluan pada build production dengan mock]

- **Token hanya selepas pendaftaran disahkan.** Dikeluarkan di satu tempat, hanya apabila RPC memulangkan outcome `created`, `matched` atau `duplicate_request` (`confirmedCaptureOutcome` dalam `ebookCapture.ts`). Outcome tiada, tidak dikenali, bukan objek, tatasusunan, rentetan, bersarang, RPC kosong atau ralat: respons 502 generik, **tiada token, tiada capaian Storage**, log `rpc_unexpected_outcome`. Ini juga berlaku apabila delivery dimatikan (capture tidak dilaporkan berjaya jika outcome tidak disahkan). Honeypot dan semua penolakan awal tidak boleh mencapai token.
- **Token tidak membawa data peribadi** (claims: `e`, `r`, `i`, `x`) dan **tidak berada dalam URL** (body POST; tiada laluan GET, sentiasa 404).
- **Tamat tempoh dan pemalsuan.** HMAC-SHA256 dengan label tujuan, `timingSafeEqual`, had 512 aksara, tempoh maksimum 600 saat walaupun tandatangan sah, `iat` tidak boleh di masa depan. Semua penolakan menjawab 403 yang sama.
- **Tiada akses objek sewenang-wenang.** Id eBook dalam token memilih satu kunci tetap daripada jadual `EBOOK_PDF_OBJECTS`; `fetchEbookObject` menolak kunci di luar allowlist. Tiada parameter laluan, nama fail atau query dibaca.
- **Tiada URL Storage.** Tiada signed URL atau public URL dicipta atau dipulangkan. Pembacaan Storage ialah `fetch` server-ke-server dengan kunci service-role dalam header sahaja, `redirect: "error"` dan timeout 15 saat. Modul `ebookStorage.ts` ialah `server-only` dan hanya diimport oleh laluan muat turun.
- **Integriti.** Bait mesti bermula dengan `%PDF-` dan sepadan dengan SHA-256 yang diluluskan (`fbf19c28...04dc`). Hash hanya dikira selepas semakan saiz dan header lulus. Jika gagal, tiada bait dihantar (503).
- **Had kadar, persetujuan, idempotency** tidak berubah. Capture: 5/min/IP dan 5/jam/e-mel. Muat turun: 10/10 min/IP (dikongsi, fail-closed). Marketing opt-in tidak diperlukan.
- **Log:** kod tetap sahaja.
- **Dimatikan secara lalai:** perlu `EBOOK_LEAD_CAPTURE_ENABLED=true`, `EBOOK_DELIVERY_ENABLED=true` (tepat) dan `EBOOK_DELIVERY_TOKEN_SECRET` (≥32 aksara).

## 3. Buffering, memori dan sempadan saiz (jujur)

### Respons ini BUKAN streaming [Tempatan: bacaan kod dan pustaka]

`supabase-js` `storage.download()` memanggil `response.blob()`, iaitu memuatkan seluruh objek sebelum sebarang semakan saiz. Pelaksanaan lama kemudian menyalin bait beberapa kali (Blob, ArrayBuffer, `Uint8Array`, `Buffer.from`), kira-kira 3 salinan fail (~12.5 MiB bagi satu permintaan, tidak diukur).

Pelaksanaan sekarang:

1. `fetchEbookObject` membaca badan Storage secara berperingkat (`readCappedBytes`) ke dalam **satu** buffer yang diperuntukkan sekali dan diisi di tempat (tiada senarai chunk, tiada salinan `concat`). Saiznya ialah `Content-Length` jika diketahui dan tiada `content-encoding`; jika tidak (panjang tidak diketahui atau badan dimampatkan), saiznya ialah had penuh 4,500,000 bait dan respons menggunakan pandangan (`subarray`) bahagian yang terisi, tanpa salinan tambahan.
2. Hash SHA-256 dikira atas buffer itu (tanpa salinan).
3. Buffer yang sama diserahkan kepada `NextResponse`. **Aplikasi memegang seluruh fail yang telah disahkan dalam memori sebelum menghantar satu bait pun.** Sama ada runtime Next.js/Node menyalin sekali lagi tidak diukur dan tidak diketahui.

Streaming sebenar (`ReadableStream` daripada Storage terus ke pelanggan) **tidak digunakan** kerana ia menghantar bait sebelum SHA-256 dapat disahkan. Menghantar bait yang sudah disahkan sebagai `ReadableStream` tidak mengurangkan penggunaan memori (seluruh fail sudah dalam memori); ia hanya mengubah bentuk respons.

Pemerhatian tempatan: respons HTTP tempatan menggunakan `Transfer-Encoding: chunked` walaupun aplikasi memegang seluruh fail. Oleh itu bentuk respons di wayar tidak membuktikan apa-apa tentang buffering, dan tidak boleh dijadikan bukti tentang had Vercel.

Ukuran memori tempatan (10 muat turun serentak) tidak menghasilkan kesimpulan: pensampelan Working Set terlalu kasar. **Tiada angka memori yang boleh dipegang.** Anggaran kasar: satu buffer (4.35 MB; sehingga 4.5 MB jika panjang tidak diketahui) bagi setiap permintaan aktif dalam kod aplikasi, ditambah chunk sementara daripada `fetch` dan overhead runtime Next.js/Node yang tidak diketahui.

### Sempadan saiz

| Had | Nilai | Dikuatkuasakan | Status |
|---|---|---|---|
| `MAX_PDF_BYTES` (aplikasi) | **4,500,000 bait** | Semasa membaca: ditolak jika `Content-Length` melebihi had sebelum membaca; jika tiada `Content-Length`, bacaan dihentikan dan strim dibatalkan sebaik bait melebihi had; selepas itu semakan akhir pada buffer | [Tempatan: ujian unit dan laluan] |
| Bucket `file_size_limit` (cadangan) | **4,500,000** | Storage API semasa muat naik | [Staging] hanya wujud selepas bucket disediakan |
| Had respons buffered fungsi Vercel | 4.5 MB (dipercayai) | Platform | [Staging] **belum disahkan**; tidak ada dokumentasi atau ujian di sini |
| PDF diluluskan | 4,353,912 bait | n/a | muat dengan ~3% ruang kosong |

Satu nilai dipilih sengaja supaya bucket dan aplikasi menggunakan had yang sama, dan supaya had itu **tidak melebihi** had respons buffered Vercel yang dipercayai (4.5 MB). Ini niat reka bentuk, **bukan jaminan**: had Vercel dan unitnya belum disahkan (lihat jadual dan bahagian Staging). Fail lebih besar memerlukan keputusan sedar (ubah `MAX_PDF_BYTES`, had bucket dan ujian Staging bersama).

Metadata yang dikawal klien tidak dipercayai: had bergantung pada bait sebenar yang dibaca, bukan header sahaja. `Content-Length` hanya digunakan untuk menolak lebih awal.

### Yang hanya boleh disahkan selepas bucket wujud / pada Staging

- Bucket benar-benar menolak muat naik melebihi 4,500,000 bait dan bukan `application/pdf`.
- Storage sebenar menghantar `Content-Length` (jika tidak, laluan fallback yang ditanggung oleh had running-count digunakan).
- Fungsi Vercel menerima respons ~4.35 MB (had 4.5 MB mungkin dikira dalam MB atau MiB), dan masa serta memori fungsi untuk beberapa muat turun serentak.
- **Jika ujian Staging gagal,** fallback minimum yang selamat (keputusan Pemilik, belum dibina): (a) hantar `ReadableStream` daripada bait yang telah disahkan (integriti dikekalkan, tiada URL didedahkan; andaian bahawa respons strim tidak tertakluk had 4.5 MB, mesti dibuktikan); (b) signed URL 60 saat yang dikeluarkan hanya selepas token disahkan (menanggalkan memori tetapi mendedahkan URL Storage sementara dan SHA-256 tidak lagi disahkan di server). Fail termampat (bahagian 5) mengurangkan masalah ini.

## 4. Keperluan storage (belum dibuat; memerlukan kelulusan)

Bucket peribadi `ebook-private`, tiada polisi Storage (hanya service role boleh membaca), tiada bucket awam. Cadangan SQL (padankan struktur `20261103085009_production_certificate_render_assets_bucket.sql`, termasuk pengawal yang enggan berjalan jika wujud polisi permissive anon/authenticated/public pada `storage.objects`):

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ebook-private', 'ebook-private', false, 4500000, array['application/pdf'])
on conflict (id) do nothing;
```

Sengaja **tidak diletakkan** dalam `supabase/migrations/`; contract test memastikan tiada migrasi menyebut `ebook-private`.

Muat naik (selepas kelulusan): objek `ebooks/dari-zero-ke-dunia-industri-v1.pdf`; sahkan `sha256sum` = `fbf19c283c534e0638bfd91816e7e5b708ee3a8b69a6946612c53a4d570a04dc` sebelum dan selepas. Versi baharu = kunci baharu; kemas kini `EBOOK_PDF_OBJECTS` dan catalog bersama; jangan tulis ganti.

Env var (server sahaja; belum ditetapkan): `EBOOK_DELIVERY_ENABLED`, `EBOOK_DELIVERY_TOKEN_SECRET` (rawak panjang, dijana di luar repo; memutarnya membatalkan token aktif, tidak mengapa kerana tempohnya 10 minit). Placeholder dikomen dalam `.env.example`.

## 5. Cadangan salinan PDF termampat (belum dibuat, tiada fail dicipta)

PDF diluluskan tidak diubah. Pemeriksaan baca-sahaja (pypdf) terhadap fail asal [Tempatan]:

- 12 muka surat; penerbit `Skia/PDF` (dicetak daripada pelayar); 3 fon Poppins.
- 13 imej menggunakan **3,877,008 bait daripada 4,353,912 (~89%)**; baki (~0.48 MB) ialah teks, fon dan struktur.
- Terbesar: lencana HRD Corp "Registered Training Provider" PNG **3601×3601** (643,868 bait, muka surat 11); PNG 1184×847 (416,303); beberapa JPEG 933–1400 px (250 hingga 425 KB setiap satu).

Cadangan (tidak diuji; anggaran sahaja):

1. Jana semula daripada sumber (folder `04_output`/`07_website` Pemilik) dengan imej diubah saiz kepada ≤ 2× saiz paparan sebenar. Lencana 3601 px diturunkan kepada ~800 hingga 1000 px (kemungkinan menjimatkan ~500 KB); PNG 1184 px dioptimumkan/dikuantumkan; JPEG dikodkan semula pada kualiti ~80 hingga 85 (jangan mampat semula JPEG berulang kali). Jangkaan: **2.5 hingga 3.0 MB** [Andaian].
2. Jangan gunakan pemampat "automatik" agresif (cth. ghostscript `/screen`) kerana risiko teks kabur dan kod QR/pautan WhatsApp (muka surat 12) rosak.
3. Nama berasingan yang jelas, cth. `TERAS_eBook_DariZeroKeDuniaIndustri_web.pdf` (bukan menimpa fail asal), SHA-256 baharu, direktori berasingan daripada direktori sumber PDF peribadi yang diluluskan Pemilik.
4. Semakan Pemilik: baca semua 12 muka surat pada skrin dan cetak, imbas kod QR, klik semua pautan, bandingkan teks, simpan rekod kelulusan baharu seperti `REKOD_KELULUSAN_PENERBITAN.md`.
5. **Selepas** kelulusan sahaja: kunci objek baharu (cth. `ebooks/dari-zero-ke-dunia-industri-web-v1.pdf`), kemas kini `EBOOK_PDF_OBJECTS` dan `EBOOK_CATALOG` (SHA-256), tetapkan had bucket dan `MAX_PDF_BYTES` yang lebih kecil dalam commit yang sama, jalankan semula ujian. SHA-256 kanonik semasa dan pemetaan objek **tidak diubah** sekarang.

## 6. Batasan yang diketahui

1. **Token tanpa keadaan:** boleh diguna semula dalam 10 minit, dihadkan oleh had kadar IP. Guna sekali memerlukan jadual dan RPC baharu (hak istimewa pangkalan data baharu); tidak dibuat tanpa kelulusan.
2. Token tidak menyemak semula baris pangkalan data semasa muat turun (memerlukan RPC baharu).
3. `isAllowedOrigin` (sedia ada) menerima Origin kosong dan sebarang `*.vercel.app`; token ialah kelayakan sebenar. Mengetatkannya ialah tugas berasingan.
4. Token berada dalam input `hidden` pada halaman semasa sah (boleh dibaca skrip halaman/sambungan pelayar). CSP global masih membenarkan `unsafe-inline` dan `unsafe-eval`, jadi risiko XSS sedia ada diwarisi.
5. Mesej ralat muat turun (token tamat) ialah halaman JSON mudah kerana borang POST biasa.
6. Notis Privasi (draf, belum disemak undang-undang) perlu menyebut penghantaran muat turun sebelum diaktifkan.
7. Kunci rahsia HMAC hanya disemak panjangnya (≥32 aksara), bukan entropi; tiada key ID untuk putaran bertindih.

## 7. Keperluan e-mel (hanya jika Pemilik memilih B)

Penyedia e-mel dan domain disahkan, templat BM, jadual token pengesahan (hash, tamat tempoh, guna sekali, RLS + audit trigger + Zod + migrasi), had kadar penghantaran, pengendalian bounce/aduan/suppression, pindaan Notis Privasi, dan keputusan sama ada pengesahan mengaktifkan `email_verified`. Tidak dibina di sini.

## 8. Keputusan Pemilik diperlukan

1. Luluskan A sekarang (B kemudian), atau terus ke B.
2. Luluskan bucket `ebook-private` (had 4,500,000) dan siapa memuat naik PDF.
3. Luluskan rahsia token dan `EBOOK_DELIVERY_*` untuk Staging dahulu.
4. Dasar double opt-in sebelum pemasaran.
5. Semakan undang-undang Notis Privasi, termasuk perkataan penghantaran.
6. Terima token boleh-guna-semula 10 minit (vs guna sekali dengan RPC baharu).
7. Luluskan penyediaan salinan termampat (bahagian 5) dan semakan visualnya.
8. Keputusan fallback jika ujian Vercel Staging menolak respons 4.35 MB.

## 9. Keperluan integrasi website (masa depan)

- `/ebook` dan `/privacy` masih memakai `site-header` + `MegaNav`; selepas redesign website masuk `main`, tukar kepada `PremiumHeader` dan semak semula gaya `.ebook-*`.
- Panel kejayaan borang mengandungi borang `POST /api/ebook/download`; CSP `form-action 'self'` membenarkannya. Jika CSP atau laluan berubah, ulang ujian laluan.
- Promosi homepage/Resources hanya bergantung pada flag yang sama; jangan menaut ke `/ebook` sebelum pengaktifan awam diluluskan.
- Jangan ubah matcher `middleware.ts`.

## 10. Cara menguji secara tempatan

```bash
npm run test:ebook-delivery           # token, pembaca terhad, penyemak PDF, jadual objek, sempadan saiz
npm run test:ebook-capture            # peraturan capture, termasuk outcome RPC yang disahkan
npm run test:ebook-capture-contract   # kontrak statik, termasuk bahagian 10 (penghantaran)
```

Ujian laluan hujung-ke-hujung dijalankan pada build production dengan mock Supabase tempatan (127.0.0.1) dan PDF yang diluluskan dibaca baca-sahaja daripada folder asal Pemilik (tidak disalin ke repo). Skrip berada di luar repo (scratchpad sesi). **Ini bukan ujian Vercel.**
