# RANCAUPAS BEAUTY

Aplikasi pengelolaan invoice, pelanggan, katalog, arus kas, dan laporan. Web dan APK menggunakan workspace Supabase yang sama; IndexedDB lama hanya dipertahankan untuk ekspor backup perangkat.

## Menyiapkan Supabase

1. Buat project Supabase dan aktifkan provider Email pada Authentication.
2. Jalankan SQL di `supabase/migrations/0001_core_schema.sql` sampai `0006_invoice_tax_percentage.sql` secara berurutan pada SQL Editor. Jika migration 0001–0005 sudah pernah diterapkan, jalankan hanya 0006. Uji dahulu pada project staging. Migration tidak diterapkan otomatis oleh aplikasi.
3. Pastikan akun bersama sudah terdaftar dan memiliki workspace perusahaan di Supabase Authentication.
4. Salin `.env.example` menjadi `.env.local`, lalu isi URL project, publishable/anon key, dan `VITE_SHARED_LOGIN_EMAIL` dengan email akun Supabase yang sudah memiliki workspace. Email ini hanya identitas internal; pengguna masuk dengan satu password bersama. Jangan pernah memakai `service_role` key pada web atau APK.

```env
VITE_SUPABASE_URL=https://project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
VITE_SHARED_LOGIN_EMAIL=akun-bersama@example.com
```

Zona waktu perusahaan diminta ketika akun pertama kali membuat workspace dan dipakai untuk nomor invoice di semua perangkat.

## Web

```sh
npm install
npm run dev
npm run lint
npm run build
```

Untuk GitHub Pages, isi repository variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, dan `VITE_SHARED_LOGIN_EMAIL` pada Settings → Secrets and variables → Actions. Workflow Pages memerlukan ketiganya saat build.

## Android

Build memakai konfigurasi Supabase dari `.env.local` yang sama dengan web:

```sh
npm run build:android
npm run android:open
```

Di Android Studio pilih **Build → Build APK(s)**. APK menggunakan sesi Supabase milik akun yang masuk; data tidak disalin antarprofil/browser, melainkan dibaca dari workspace cloud.

## Data lama

Database Dexie yang sudah ada tidak dihapus. Unduh **backup lokal perangkat ini** pada web dan APK sebelum berpindah. Backup tersebut terpisah dari backup cloud dan belum otomatis diimpor; verifikasi serta rekonsiliasi backup web dan APK sebelum migrasi agar tidak menggandakan invoice atau transaksi.
