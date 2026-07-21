# Import PDF sijil secara pukal

Halaman admin baharu tersedia di `/admin/certificates/import`.

1. Log masuk dahulu di `/admin/certificates`.
2. Buka `/admin/certificates/import` dan pilih banyak fail PDF.
3. Gunakan OCR untuk sijil scan; matikan OCR jika PDF mengandungi teks biasa.
4. Semak baris bertanda `Semak` dan betulkan medan terus dalam jadual.
5. Muat turun CSV jika perlu, atau import hanya baris `Sedia`.

PDF dan data sensitif diproses di browser. Route API hanya menerima rekod selepas admin mengesahkan import dan tetap memeriksa session/RLS. Sijil berganda dalam batch ditanda; sijil yang sudah wujud di database akan ditolak oleh unique constraint dan muncul dalam mesej ralat import.

Jalankan `supabase/certificates.sql` pada projek Supabase yang digunakan sebelum operasi admin. Jangan masukkan service role key ke dalam environment variable `NEXT_PUBLIC_*`.
