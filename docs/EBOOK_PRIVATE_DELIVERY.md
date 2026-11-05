# /ebook: Penghantaran PDF Peribadi (Private PDF Delivery)

Status: **kod tempatan sahaja, belum di-commit, dimatikan secara lalai.** Tiada storage jauh, e-mel, env var, migrasi atau muat naik PDF telah dibuat.
**PDF yang diluluskan Pemilik: versi Balanced** (2,929,572 bait, 12 muka surat, SHA-256 `9595cc47…06d5`). Lihat bahagian 5. Pemilihan versi telah diluluskan; **pelepasan Staging dan Production belum diluluskan**.
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

### Kawalan [Tempatan: ujian unit, kontrak statik, 118 semakan laluan pada build production dengan mock]

- **Token hanya selepas pendaftaran disahkan.** Dikeluarkan di satu tempat, hanya apabila RPC memulangkan outcome `created`, `matched` atau `duplicate_request` (`confirmedCaptureOutcome` dalam `ebookCapture.ts`). Outcome tiada, tidak dikenali, bukan objek, tatasusunan, rentetan, bersarang, RPC kosong atau ralat: respons 502 generik, **tiada token, tiada capaian Storage**, log `rpc_unexpected_outcome`. Ini juga berlaku apabila delivery dimatikan (capture tidak dilaporkan berjaya jika outcome tidak disahkan). Honeypot dan semua penolakan awal tidak boleh mencapai token.
- **Token tidak membawa data peribadi** (claims: `e`, `r`, `i`, `x`) dan **tidak berada dalam URL** (body POST; tiada laluan GET, sentiasa 404).
- **Tamat tempoh dan pemalsuan.** HMAC-SHA256 dengan label tujuan, `timingSafeEqual`, had 512 aksara, tempoh maksimum 600 saat walaupun tandatangan sah, `iat` tidak boleh di masa depan. Semua penolakan menjawab 403 yang sama.
- **Tiada akses objek sewenang-wenang.** Id eBook dalam token memilih satu kunci tetap daripada jadual `EBOOK_PDF_OBJECTS`; `fetchEbookObject` menolak kunci di luar allowlist. Tiada parameter laluan, nama fail atau query dibaca.
- **Tiada URL Storage.** Tiada signed URL atau public URL dicipta atau dipulangkan. Pembacaan Storage ialah `fetch` server-ke-server dengan kunci service-role dalam header sahaja, `redirect: "error"` dan timeout 15 saat. Modul `ebookStorage.ts` ialah `server-only` dan hanya diimport oleh laluan muat turun.
- **Integriti.** Bait mesti bermula dengan `%PDF-` dan sepadan dengan SHA-256 versi Balanced yang diluluskan Pemilik (`9595cc47...06d5`). Hash hanya dikira selepas semakan saiz dan header lulus. Jika gagal, tiada bait dihantar (503).
- **Had kadar, persetujuan, idempotency** tidak berubah. Capture: 5/min/IP dan 5/jam/e-mel. Muat turun: 10/10 min/IP (dikongsi, fail-closed). Marketing opt-in tidak diperlukan.
- **Log:** kod tetap sahaja.
- **Pengasingan projek (PR #215, `lib/preview-isolation.ts`).** Kedua-dua laluan berhak istimewa menjalankan guard yang sama dan gagal-tertutup di luar Production: capture melalui `createSupabaseServiceClient()`, muat turun melalui `fetchEbookObject` (kunci service dibaca sendiri, jadi guard `assertPrivilegedSupabaseConfig()` ialah pernyataan **pertama** dan mendahului pembacaan kunci, URL dan `fetch`). Di Custom Staging guard menuntut `TERAS_APPROVED_SUPABASE_PROJECT_REF` (rujukan projek Staging, bukan Production), `NEXT_PUBLIC_SUPABASE_URL` pada projek itu, dan kunci service sama ada JWT `service_role` yang `ref`nya sepadan atau, bagi kunci `sb_secret_`, `TERAS_SERVICE_KEY_PROJECT_REF` yang sama. Jika tidak, capture memulangkan 503 dan muat turun 503 tanpa sebarang panggilan RPC atau bacaan Storage [Tempatan: matriks 14 senario, 74 semakan]. Production tidak dikekang.
- **Persetujuan pemasaran (polisi Pemilik, Opsyen A).** Borang eBook tidak lagi mempunyai kotak pemasaran. Laluan `POST /api/ebook` menghantar `p_marketing_opt_in: false` sebagai literal sisi pelayan (tidak pernah daripada badan permintaan); medan `marketing_opt_in` dibuang daripada skema dan medan tambahan daripada klien lama atau palsu disingkirkan, bukan ditolak. Kontak baharu ialah `not_set`; kontak `opted_in`, `opted_out` dan `not_set` yang sedia ada tidak berubah. Metadata `ebook_requested` merekod `requested=false`, `applied=false`, `text_version=not-requested-ebook-option-a` (penanda fakta, bukan bukti persetujuan) dan `email_verified=false`. RPC dan migrasi tidak diubah. Tiada e-mel pemasaran dihantar; double opt-in ditangguhkan kepada aliran pemasaran yang diluluskan berasingan.
- **Dimatikan secara lalai:** perlu `EBOOK_LEAD_CAPTURE_ENABLED=true`, `EBOOK_DELIVERY_ENABLED=true` (tepat) dan `EBOOK_DELIVERY_TOKEN_SECRET` (≥32 aksara).

## 3. Buffering, memori dan sempadan saiz (jujur)

### Respons ini BUKAN streaming [Tempatan: bacaan kod dan pustaka]

`supabase-js` `storage.download()` memanggil `response.blob()`, iaitu memuatkan seluruh objek sebelum sebarang semakan saiz. Pelaksanaan lama kemudian menyalin bait beberapa kali (Blob, ArrayBuffer, `Uint8Array`, `Buffer.from`), kira-kira 3 salinan fail (~12.5 MiB bagi satu permintaan, tidak diukur).

Pelaksanaan sekarang:

1. `fetchEbookObject` membaca badan Storage secara berperingkat (`readCappedBytes`) ke dalam **satu** buffer yang diperuntukkan sekali dan diisi di tempat (tiada senarai chunk, tiada salinan `concat`). Saiznya ialah `Content-Length` jika diketahui dan tiada `content-encoding`; jika tidak (panjang tidak diketahui atau badan dimampatkan), saiznya ialah had penuh 3,000,000 bait dan respons menggunakan pandangan (`subarray`) bahagian yang terisi, tanpa salinan tambahan.
2. Hash SHA-256 dikira atas buffer itu (tanpa salinan).
3. Buffer yang sama diserahkan kepada `NextResponse`. **Aplikasi memegang seluruh fail yang telah disahkan dalam memori sebelum menghantar satu bait pun.** Sama ada runtime Next.js/Node menyalin sekali lagi tidak diukur dan tidak diketahui.

Streaming sebenar (`ReadableStream` daripada Storage terus ke pelanggan) **tidak digunakan** kerana ia menghantar bait sebelum SHA-256 dapat disahkan. Menghantar bait yang sudah disahkan sebagai `ReadableStream` tidak mengurangkan penggunaan memori (seluruh fail sudah dalam memori); ia hanya mengubah bentuk respons.

Pemerhatian tempatan: respons HTTP tempatan menggunakan `Transfer-Encoding: chunked` walaupun aplikasi memegang seluruh fail. Oleh itu bentuk respons di wayar tidak membuktikan apa-apa tentang buffering, dan tidak boleh dijadikan bukti tentang had Vercel.

Ukuran memori tempatan (10 muat turun serentak) tidak menghasilkan kesimpulan: pensampelan Working Set terlalu kasar. **Tiada angka memori yang boleh dipegang.** Anggaran kasar: satu buffer (2.93 MB; sehingga 3.0 MB jika panjang tidak diketahui) bagi setiap permintaan aktif dalam kod aplikasi, ditambah chunk sementara daripada `fetch` dan overhead runtime Next.js/Node yang tidak diketahui.

### Sempadan saiz

| Had | Nilai | Dikuatkuasakan | Status |
|---|---|---|---|
| `MAX_PDF_BYTES` (aplikasi) | **3,000,000 bait** | Semasa membaca: ditolak jika `Content-Length` melebihi had sebelum membaca; jika tiada `Content-Length`, bacaan dihentikan dan strim dibatalkan sebaik bait melebihi had; selepas itu semakan akhir pada buffer | [Tempatan: ujian unit dan laluan] |
| Bucket `file_size_limit` (cadangan) | **3,000,000** | Storage API semasa muat naik | [Staging] hanya wujud selepas bucket disediakan |
| Had respons buffered fungsi Vercel | 4.5 MB (dipercayai) | Platform | [Staging] **belum disahkan**; tidak ada dokumentasi atau ujian di sini |
| PDF Balanced diluluskan | 2,929,572 bait | n/a | muat dengan ~2.4% ruang kosong; ~35% di bawah 4.5 MB |

Satu nilai dipilih sengaja supaya bucket dan aplikasi menggunakan had yang sama, dan supaya had itu jauh **di bawah** had respons buffered Vercel yang dipercayai (4.5 MB). Ini niat reka bentuk, **bukan jaminan**: had Vercel dan unitnya belum disahkan (lihat jadual dan bahagian Staging). Fail lebih besar memerlukan keputusan sedar (ubah `MAX_PDF_BYTES`, had bucket dan ujian Staging bersama).

Metadata yang dikawal klien tidak dipercayai: had bergantung pada bait sebenar yang dibaca, bukan header sahaja. `Content-Length` hanya digunakan untuk menolak lebih awal.

### Yang hanya boleh disahkan selepas bucket wujud / pada Staging

- Bucket benar-benar menolak muat naik melebihi 3,000,000 bait dan bukan `application/pdf`.
- Storage sebenar menghantar `Content-Length` (jika tidak, laluan fallback yang ditanggung oleh had running-count digunakan).
- Fungsi Vercel menerima respons ~2.93 MB (had 4.5 MB dipercayai; unit MB atau MiB belum disahkan), dan masa serta memori fungsi untuk beberapa muat turun serentak.
- **Jika ujian Staging gagal,** fallback minimum yang selamat (keputusan Pemilik, belum dibina): (a) hantar `ReadableStream` daripada bait yang telah disahkan (integriti dikekalkan, tiada URL didedahkan; andaian bahawa respons strim tidak tertakluk had 4.5 MB, mesti dibuktikan); (b) signed URL 60 saat yang dikeluarkan hanya selepas token disahkan (menanggalkan memori tetapi mendedahkan URL Storage sementara dan SHA-256 tidak lagi disahkan di server). Versi Balanced (bahagian 5) sudah mengurangkan saiz daripada 4.35 MB kepada 2.93 MB.

## 4. Keperluan storage (belum dibuat; memerlukan kelulusan)

Bucket peribadi `ebook-private`, tiada polisi Storage (hanya service role boleh membaca), tiada bucket awam. Cadangan SQL (padankan struktur `20261103085009_production_certificate_render_assets_bucket.sql`, termasuk pengawal yang enggan berjalan jika wujud polisi permissive anon/authenticated/public pada `storage.objects`):

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ebook-private', 'ebook-private', false, 3000000, array['application/pdf'])
on conflict (id) do nothing;
```

Sengaja **tidak diletakkan** dalam `supabase/migrations/`; contract test memastikan tiada migrasi menyebut `ebook-private`.

Muat naik (selepas kelulusan berasingan): objek `ebooks/dari-zero-ke-dunia-industri-balanced-v1.pdf`, fail `TERAS_eBook_DariZeroKeDuniaIndustri_balanced.pdf`; sahkan `sha256sum` = `9595cc470063bcd5fd35404b771b09f580c3562e5b7ea38aa6aef49e37ab520c` dan saiz 2,929,572 bait sebelum dan selepas. Versi baharu = kunci baharu; kemas kini `EBOOK_PDF_OBJECTS` dan catalog bersama; jangan tulis ganti.

Env var (server sahaja; belum ditetapkan): `EBOOK_DELIVERY_ENABLED`, `EBOOK_DELIVERY_TOKEN_SECRET` (rawak panjang, dijana di luar repo; memutarnya membatalkan token aktif, tidak mengapa kerana tempohnya 10 minit). Placeholder dikomen dalam `.env.example`.

## 5. PDF yang diluluskan: versi Balanced

**Rekod keputusan.** Pemilik mengarahkan penggunaan versi **Balanced** dalam konfigurasi penghantaran (arahan "Owner-approved PDF, Version: Balanced"). Ini ialah **pemilihan versi**. Ia **bukan** kelulusan pelepasan Staging atau Production, **bukan** kelulusan muat naik, dan rekod kelulusan penerbitan baharu (seperti `REKOD_KELULUSAN_PENERBITAN.md` di luar repo) masih milik Pemilik. Pemeriksaan yang **tidak** dilakukan oleh kami dan tidak boleh dianggap selesai: semakan visual penuh 12 muka surat pada peranti telefon, imbasan kod QR dengan kamera telefon, dan klik pautan dalam pembaca PDF sebenar.

| | PDF asal (digantikan) | **Balanced (aktif)** |
|---|---|---|
| Saiz | 4,353,912 bait | **2,929,572 bait** |
| Muka surat | 12 | 12 |
| SHA-256 | `fbf19c283c534e0638bfd91816e7e5b708ee3a8b69a6946612c53a4d570a04dc` | **`9595cc470063bcd5fd35404b771b09f580c3562e5b7ea38aa6aef49e37ab520c`** |
| Dalam katalog dan pemetaan penghantaran | Tidak (rekod sejarah sahaja) | Ya |
| Kunci objek peribadi (dirancang) | `ebooks/dari-zero-ke-dunia-industri-v1.pdf` (tidak dipetakan) | `ebooks/dari-zero-ke-dunia-industri-balanced-v1.pdf` |

PDF asal kekal tidak diubah di luar repo dan kekal sebagai rekod kelulusan sejarah. Fingerprintnya hanya muncul dalam dokumen ini dan dalam satu pernyataan kontrak sejarah; contract test memastikan ia tidak aktif dalam katalog, pemetaan, atau mana-mana fail sumber, dan bahawa tiada PDF eBook (asal atau Balanced) wujud dalam repo.

Bukti penyediaan [Tempatan; PyMuPDF/OpenCV pada render, bukan pembaca PDF sebenar]:

- Hanya imej diturunkan resolusinya (had 300 dpi, JPEG kualiti 90; logo PNG lutsinar had 450 dpi). Teks vektor, fon Poppins (disematkan), susun atur dan pautan tidak disentuh.
- Teks setiap muka surat sama dengan asal, senarai fon sama, enam pautan (WhatsApp, `tel:`, `mailto:`, laman web) sama jenis, URI dan kawasan klik.
- Kod QR (vektor, muka surat 12) dinyahkod kepada URL WhatsApp yang sama pada 72, 100, 150 dan 300 dpi.
- Perbandingan render 150 dpi dengan asal: SSIM 0.996 hingga 1.000; muka surat 1, 3, 9 dan 12 identik piksel.
- Versi **Small** (1.75 MB) dihasilkan sebagai sandaran tetapi **tidak dipilih**; ia tidak dipetakan.

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
2. Luluskan bucket `ebook-private` (had 3,000,000) dan siapa memuat naik PDF Balanced.
3. Luluskan rahsia token dan `EBOOK_DELIVERY_*` untuk Staging dahulu.
4. Dasar double opt-in sebelum pemasaran.
5. Semakan undang-undang Notis Privasi, termasuk perkataan penghantaran.
6. Terima token boleh-guna-semula 10 minit (vs guna sekali dengan RPC baharu).
7. Rekod kelulusan penerbitan untuk versi Balanced (semakan telefon, imbasan QR, klik pautan oleh Pemilik) dan izin memuat naiknya. Pemilihan versi sudah dibuat.
8. Keputusan fallback jika ujian Vercel Staging menolak respons ~2.93 MB (kurang berkemungkinan).

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
