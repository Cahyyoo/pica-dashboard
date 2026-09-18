// js/issue-state.js
export const state = {
    globalIssues: [],
    globalUsers: [],
    // Indeks id -> user, dibangun SEKALI saat globalUsers diisi (fetchUsersForMapping).
    // Sebelumnya enam tempat membangun Map yang sama berulang-ulang, beberapa di antaranya
    // pada SETIAP render tabel, dan empat tempat lain masih memindai linear dengan .find().
    userById: new Map(),
    currentDetailId: null,
    // Daftar tugas yang sedang tampil di Task List PIC. Disimpan supaya melipat/membuka
    // sebuah blok bisa merender ulang tanpa mengambil data dari server lagi.
    // Kategori yang sedang dibuka di Task List PIC (Daily/Weekly/Midyear/Annual).
    // Disimpan supaya kembali dari layar detail mendarat di kategori yang sama.
    picKategori: null,
    picIssues: [],
    // Hasil pengelompokan picIssues ke empat blok, dihitung SEKALI oleh renderPICTable().
    // Melipat/membuka blok menggambar ulang dari sini, bukan mengklasifikasi ulang.
    picBlok: null,
    // Issue yang sedang dibuka di layar detail, LENGKAP dengan seluruh riwayatnya.
    // Diambil dari GET /issue/:id, bukan dari globalIssues -- daftar itu kini hanya membawa
    // satu riwayat terbaru per issue. Enam tempat sebelumnya mengulang pencarian
    // `globalIssues.find(i => i.id === currentDetailId)` untuk mencari objek yang sama ini.
    detailIssue: null,
    allMDIssues : [],
    currentIssueIds: [],
    cachedMOMArchives : [],
    mdFilteredIssues: [],
    mdCurrentPage: 1,
    importRows: [],
    loginLogs: [],
    loginLogsPage: 1,
    departments: [],

    // Apakah backend yang sedang dilayani punya GET /issue/:id?
    //   null  = belum diketahui (openDetailView() akan mencobanya)
    //   true  = ada (backend 2.3.0)
    //   false = tidak ada (backend 2.2.0 -- rutenya memang tidak pernah dibuat di sana)
    // Ditentukan sekali oleh openDetailView(), dan dibaca juga oleh isEditableLastUpdate()
    // untuk menyembunyikan tombol yang endpoint-nya tidak ada. Hidup di dalam proses saja,
    // jadi app yang dijalankan ulang selalu memeriksa lagi -- tidak ada yang perlu dibersihkan
    // setelah backend di-deploy.
    backendPunyaDetail: null
};