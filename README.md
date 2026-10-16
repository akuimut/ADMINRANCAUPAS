# RANCAUPAS BEAUTY

Aplikasi lokal untuk invoice, pelanggan, katalog, arus kas, rekap, dan backup perusahaan. Data operasional disimpan di IndexedDB browser melalui Dexie; tidak ada akun atau server eksternal.

## Menjalankan

```sh
npm install
npm run dev
```

Periksa kualitas dan build produksi:

```sh
npm run lint
npm run build
```

## GitHub Pages

Repository Pages: `akuimut/ADMINRANCAUPAS`. Workflow `.github/workflows/deploy.yml` menerbitkan folder `dist` setiap kali ada push ke branch `main`. Aktifkan **Settings → Pages → Build and deployment → GitHub Actions** pada repository.

## Android

Android memakai Capacitor dan database lokal yang sama di dalam WebView. Dengan Android Studio dan Android SDK terpasang, pilih JDK 21 pada pengaturan **Gradle JDK** Android Studio:

```sh
npm run build:android
npm run android:open
```

Di Android Studio, pilih **Build → Build APK(s)**. APK debug bernama `RANCAUPAS.apk` ada di `android/app/build/outputs/apk/debug/`. Atau jalankan `npm run android:run` dengan emulator/perangkat USB yang siap. Data aplikasi Android terpisah dari data browser; gunakan ekspor/impor backup untuk memindahkannya.

## Data lokal

Database disimpan pada profil browser yang sama. Menghapus data situs atau profil browser dapat menghapus database; unduh backup JSON berkala melalui **Pengaturan**. Restore mengganti data lokal saat ini setelah konfirmasi. Ekspor CSV tersedia pada modul data dan rekap.

Informasi perusahaan sengaja dibiarkan kosong kecuali nama brand dan awalan invoice. Tidak ada data demo yang dimuat otomatis.
