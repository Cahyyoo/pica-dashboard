# PICA System — Dashboard

Aplikasi desktop (Electron) untuk pelaporan dan pemantauan tindakan korektif (*Corrective Action*) di site tambang. PICA System adalah frontend dari sistem ini — backend-nya ada di repo terpisah, [`pica-backend`](../pica-backend) (NestJS + Prisma + MySQL).

## Fitur Utama

- **Pelaporan Issue** — buat laporan baru lengkap dengan Corrective Action, Priority, Category (Daily/Weekly/Midyear/Annual), dan Due Date.
- **Update Progress** — PIC (Dept Head) mengisi update progres per poin, masing-masing dengan status sendiri (In Progress/Closed).
- **Monitoring Dashboard (MD)** — tabel semua issue dengan filter (status, department, category, tanggal), edit assignment, edit/delete issue, ubah priority/category/due date.
- **Task List (Dept Head)** — daftar tugas milik sendiri, dikelompokkan per Category.
- **Export PDF & Excel** — format Minutes of Meeting (MOM), termasuk arsip MOM.
- **Import Excel** — bulk import issue dari file Excel.
- **Manajemen User & Department** — CRUD akun dan department (khusus MD).
- **Login Activity** — log jam setiap user membuka aplikasi (login manual maupun auto-resume sesi).
- **Kiosk Mode** — berjalan fullscreen terkunci di device site, dengan gerbang koneksi ke server kantor sebelum window ditampilkan.

## Role

| Role | Akses |
|---|---|
| **User** | Buat laporan baru, lihat riwayat laporan sendiri |
| **Dept Head** | Buat laporan, update progress task yang jadi tanggung jawabnya |
| **MD** | Akses penuh: monitoring dashboard, edit/delete issue, manajemen user & department, export, login activity |
| **KTT** | Review semua issue (read-only) |

## Tech Stack

- [Electron](https://www.electronjs.org/) — shell desktop (`nodeIntegration: true`, `contextIsolation: false`)
- Vanilla JS (ES Modules) — tanpa framework frontend
- [jsPDF](https://github.com/parallax/jsPDF) + [jspdf-autotable](https://github.com/simonbengtsson/jsPDF-AutoTable) — export PDF
- [ExcelJS](https://github.com/exceljs/exceljs) — export Excel (perlu cell styling, tidak bisa pakai `xlsx`/SheetJS CE)
- [electron-updater](https://www.electron.build/auto-update) + [electron-log](https://github.com/megahertz/electron-log) — auto-update

## Struktur Proyek

```
├── main.js                 # Entry point Electron (window kiosk, auto-update, gerbang koneksi server)
├── index.html               # Shell HTML, memuat semua view via loadComponent()
├── js/
│   ├── app.js                # Routing view & binding fungsi ke window
│   ├── config.js             # API_URL & auth headers
│   ├── auth.js                # Login, logout, manage user, login activity log
│   ├── issue-action.js        # Submit issue, update progress, edit/delete issue, dsb.
│   ├── issue-dashboard.js     # Render & filter tabel MD Dashboard + Task List Dept Head
│   ├── issue-detail.js        # Halaman detail issue & timeline riwayat
│   ├── issue-pdf.js           # Export PDF (single issue & MOM combined)
│   ├── issue-excel-export.js  # Export Excel (format MOM)
│   ├── issue-import.js        # Import bulk dari Excel
│   ├── issue-guard.js         # Validasi gembok harian (wajib update sebelum logout/exit)
│   ├── issue-state.js         # State global in-memory
│   ├── departements.js        # CRUD department
│   ├── issues.js              # Barrel re-export modul issue-*
│   └── utils.js               # Helper umum (WITA timezone, modal, alert, dll.)
├── views/                   # Fragmen HTML per screen (dimuat dinamis)
│   ├── auth.html
│   ├── menus.html
│   ├── dashboards.html
│   └── modals.html
└── public/                  # Aset statis (CSS, gambar, ikon)
```

## Menjalankan Secara Lokal

Pastikan [`pica-backend`](../pica-backend) sudah jalan (default `http://localhost:3000`), lalu sesuaikan `API_URL` di [`js/config.js`](js/config.js).

```bash
npm install
npm start
```

## Build

```bash
npm run build
```

Menghasilkan installer Windows (NSIS) via `electron-builder`, dan otomatis publish ke GitHub Releases (`Cahyyoo/pica-dashboard`) sesuai konfigurasi `build.publish` di `package.json`.

## Catatan

- `API_URL` di `js/config.js` menentukan backend mana yang dipakai (office server vs lokal) — **cek dulu sebelum build/deploy**, jangan sampai keliru arah.
- Semua timestamp ditampilkan dalam zona waktu **WITA (Asia/Makassar, UTC+8)**, terlepas dari timezone device.
- Perubahan schema database dilakukan lewat `pica-backend` (Prisma) — lihat README di repo tersebut untuk detail migrasi.
