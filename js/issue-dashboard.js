// js/issue-dashboard.js
import { API_URL, getAuthHeaders } from './config.js';
import { showCustomAlert, showView, getStatusBadge, getDailyUpdateBadge, formatWitaDate, formatWitaDateTime, debounce, escapeHtml, blokTugasPic, tugasTertunda, BLOK_BELUM, BLOK_TERJADWAL, issueTersembunyi, peranTerbatasJadwal, urutkanIssueStatusTanggal, msDibuat, ambilIssueRingkas, lupakanCacheIssue, ambilUsers } from './utils.js';
import { muatKategori, muatDropdownKategori, daftarKategori, cariKategori, kategoriDefault, labelKategori } from './categories.js';
import { deskripsiVisibilitas } from './schedule-form.js';
import { state } from './issue-state.js';
import { openDetailView } from './issue-detail.js';
import { exportFilteredIssuesToPDF } from './issue-pdf.js';
import { exportFilteredIssuesToExcel } from './issue-excel-export.js';

// Urutan status dan pembandingnya kini tinggal satu salinan di utils.js
// (STATUS_ORDER / urutkanIssueStatusTanggal) -- lihat komentarnya di sana.

// Satu-satunya tempat yang menulis state.globalUsers/state.userById. Diekspor supaya
// loadAdminUsers() di auth.js -- yang mengambil datanya sendiri agar selalu segar -- ikut
// mengisi peta yang sama. Dulu jalur Admin tidak mengisinya sama sekali, sehingga membuka
// layar Admin lebih dulu membuat nama PIC di tabel lain kosong sampai ada layar lain memuat.
export function simpanUsersKeState(users) {
    state.globalUsers = users;
    state.userById = new Map(users.map(u => [String(u.id), u]));
}

export async function fetchUsersForMapping() {
    try {
        simpanUsersKeState(await ambilUsers());
    } catch (error) { console.warn("Gagal mapping user:", error); }
}

export async function openUserHistory() {
    try {
        // Kedua permintaan ini saling bebas, jadi dijalankan BERSAMAAN. Sebelumnya
        // berurutan: /auth/users harus selesai sepenuhnya sebelum /issue dimulai,
        // sehingga setiap pembukaan dashboard membayar dua kali waktu tempuh jaringan.
        const [, issues] = await Promise.all([
            fetchUsersForMapping(),
            ambilIssueRingkas(),
        ]);
        state.globalIssues = issues;

        const tbody = document.querySelector('#view-user-history tbody');
        if (!tbody) return;

        const currentUserId = String(localStorage.getItem('user_id'));
        const myIssues = state.globalIssues.filter(i => String(i.issuedBy) === currentUserId);

        urutkanIssueStatusTanggal(myIssues);

        if (myIssues.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #6b7280; padding: 24px;">You haven't created any reports yet.</td></tr>`;
            showView('view-user-history'); return;
        }

        state.currentIssueIds = myIssues.map(i => i.id);

        // Index user sekali (O(m)) + kumpulkan baris ke satu string lalu assign SEKALI.
        // Pola sama dengan renderMDTable()/filterUserHistory(); `innerHTML +=` di dalam loop
        // biayanya O(n^2) karena seluruh tbody di-parse ulang tiap iterasi.
        const userById = state.userById;

        let html = '';
        for (let i = 0; i < myIssues.length; i++) {
            const item = myIssues[i];
            const dateStr = formatWitaDate(item.createdAt);
            const picUser = userById.get(String(item.picId));
            const picName = picUser ? picUser.username : 'Unassigned';

            html += `<tr>
                <td style="text-align: center;">${i + 1}</td>
                <td>${escapeHtml(item.caseNotification)}</td> <td>${dateStr}</td>
                <td style="font-weight: 500; color: #1591DC;">${escapeHtml(picName)}</td> <td style="text-align: center;">${getStatusBadge(item.status)}</td>
                <td style="text-align: center;"><button class="btn-sm" onclick="openDetailView(${item.id})">View Details</button></td>
            </tr>`;
        }
        tbody.innerHTML = html;
        showView('view-user-history');
    } catch (error) { showCustomAlert("Error", "Failed to load report history."); }
}

export async function refreshUserHistory() {
    try {
        // Tombol Refresh berarti "saya mau data terbaru sekarang" -- cache dihanguskan lebih
        // dulu supaya permintaan benar-benar berangkat ke server.
        lupakanCacheIssue();
        const btnRefresh = document.querySelector('#view-user-history button[onclick="refreshUserHistory()"]');
        if (btnRefresh) btnRefresh.innerText = "Refreshing...";
        await openUserHistory();
        if (btnRefresh) btnRefresh.innerText = "Refresh Data";
        showCustomAlert("Success", "History data has been successfully refreshed!");
    } catch (error) { showCustomAlert("Error", "Failed to refresh history data."); }
}

export async function refreshDashboardMD() {
    try {
        // Tombol Refresh berarti "saya mau data terbaru sekarang" -- cache dihanguskan lebih
        // dulu supaya permintaan benar-benar berangkat ke server.
        lupakanCacheIssue();
        const btnRefresh = document.querySelector('button[onclick="refreshDashboardMD()"]');
        if (btnRefresh) btnRefresh.innerText = "Refreshing...";
        await loadDashboardMD();
        if (btnRefresh) btnRefresh.innerText = "Refresh Data";
        showCustomAlert("Success", "Dashboard data has been successfully refreshed!");
    } catch (error) { showCustomAlert("Error", "Failed to refresh dashboard data."); }
}

export async function refreshDashboardPIC() {
    try {
        // Tombol Refresh berarti "saya mau data terbaru sekarang" -- cache dihanguskan lebih
        // dulu supaya permintaan benar-benar berangkat ke server.
        lupakanCacheIssue();
        const btnRefresh = document.querySelector('button[onclick="refreshDashboardPIC()"]');
        if (btnRefresh) btnRefresh.innerText = "Refreshing...";
        
        // Refresh harus benar-benar mengambil ulang, jadi token kesegaran dihanguskan
        // lebih dulu -- kalau tidak, tombol ini bisa cuma menggambar ulang data lama.
        dataPicSegar = false;
        await loadDashboardPIC();
        
        if (btnRefresh) btnRefresh.innerText = "Refresh Data";
        showCustomAlert("Success", "Task list data has been successfully refreshed!");
    } catch (error) { 
        showCustomAlert("Error", "Failed to refresh task list data."); 
    }
}

export async function loadDashboardMD() {
    try {
        // Kedua permintaan ini saling bebas, jadi dijalankan BERSAMAAN. Sebelumnya
        // berurutan: /auth/users harus selesai sepenuhnya sebelum /issue dimulai,
        // sehingga setiap pembukaan dashboard membayar dua kali waktu tempuh jaringan.
        const [, issues] = await Promise.all([
            fetchUsersForMapping(),
            ambilIssueRingkas(),
            // Label kategori di tabel + isi ulang filter Category, supaya kategori yang baru
            // ditambahkan MD dari perangkat lain ikut muncul. Gagal pun tabel tetap tampil
            // (muatDropdownKategori menangani galatnya sendiri).
            muatDropdownKategori(),
        ]);
        state.globalIssues = issues;

        // KTT memang tidak pernah melihat issue tersembunyi, jadi filter jadwal tidak berarti apa-apa baginya.
        const grupJadwal = document.getElementById('filter-visibility-grup');
        if (grupJadwal) grupJadwal.hidden = localStorage.getItem('user_role') !== 'MD';

        applyFilterMD();
    } catch (error) { console.error(error); }
}

export function applyFilterMD() {
    const tbody = document.querySelector("#view-md tbody");
    if (!tbody) return;

    // 1. Ambil value dari semua filter, termasuk KOTAK PENCARIAN
    const searchFilter = document.getElementById('search-md').value.toLowerCase();
    const statusFilter = document.getElementById('filter-status-md').value;
    const scaleFilter = document.getElementById('filter-scale-md').value;
    const categoryFilter = document.getElementById('filter-category-md').value;
    const visibilityFilter = document.getElementById('filter-visibility-md')?.value || 'All';
    // KTT (dan Dept Head, bila suatu saat diberi akses) tidak melihat issue di luar jadwal tampilnya.
    const sembunyikanTerjadwal = peranTerbatasJadwal();
    const startDateFilter = document.getElementById('filter-date-start-md').value;
    const endDateFilter = document.getElementById('filter-date-end-md').value;

    // Index user sekali (O(m)); sebelumnya .find() dipanggil 2x untuk SETIAP issue.
    const userById = state.userById;
    // Kalau kotak search kosong, pencocokan teks selalu true -- jadi resolusi nama PIC &
    // Issuer di bawah tidak perlu dikerjakan sama sekali. Sebelumnya tetap dihitung untuk
    // semua issue lalu hasilnya dibuang.
    const adaPencarian = searchFilter !== '';

    // Batas tanggal dihitung SEKALI, bukan dibangun ulang per issue. Versi lama membuat TIGA
    // objek Date untuk setiap issue setiap kali filter dijalankan -- dan filter ini ikut jalan
    // tiap ketukan di kotak search. Kembarannya, saringIssueUntukEkspor() di utils.js, sudah
    // lama memakai pola ini; applyFilterMD() terlewat.
    //
    // Batas harinya sengaja WAKTU LOKAL (setHours), BUKAN WITA -- sama persis dengan
    // kembarannya. Jangan "diperbaiki" hanya di sini: layar dan hasil ekspor harus menyaring
    // dengan aturan yang sama, dan itu justru bug yang dicegah komentar di utils.js.
    let startMs = null, endMs = null;
    if (startDateFilter) { const d = new Date(startDateFilter); d.setHours(0, 0, 0, 0);      startMs = d.getTime(); }
    if (endDateFilter)   { const d = new Date(endDateFilter);   d.setHours(23, 59, 59, 999); endMs   = d.getTime(); }

    // 2. Saring data globalIssues
    const filteredIssues = state.globalIssues.filter(item => {
        const matchStatus = (statusFilter === 'All') || (item.status === statusFilter);
        const matchScale = (scaleFilter === 'All') || (item.priority === scaleFilter);
        const matchCategory = (categoryFilter === 'All') || (item.category === categoryFilter);
        const tersembunyi = issueTersembunyi(item);
        if (sembunyikanTerjadwal && tersembunyi) return false;
        if (visibilityFilter === 'Visible' && tersembunyi) return false;
        if (visibilityFilter === 'Hidden' && !tersembunyi) return false;

        // Perbandingan Date >= Date di versi lama sebenarnya membandingkan milidetik, jadi
        // bentuk ini setara -- TAPI perhatikan bentuk negasinya, itu bukan gaya penulisan.
        //
        // Versi lama menulis `matchDate = d >= start && d <= end`. Untuk createdAt yang rusak,
        // msDibuat() menghasilkan NaN, SEMUA perbandingan dengan NaN bernilai false, sehingga
        // matchDate ikut false dan barisnya DIBUANG. Kalau di sini ditulis `if (t < startMs)`,
        // NaN membuat syaratnya tidak pernah menyala dan baris rusak itu justru IKUT TAMPIL --
        // kebalikan dari perilaku lama. `!(t >= startMs)` mempertahankannya apa adanya.
        //
        // CATATAN: kembarannya saringIssueUntukEkspor() di utils.js memakai bentuk `t < startMs`,
        // jadi untuk tanggal rusak layar dan ekspor memang sudah lama berbeda. Itu perbedaan
        // yang SUDAH ADA, bukan dibuat di sini, dan sengaja tidak disentuh dari sini.
        let matchDate = true;
        if (startMs !== null || endMs !== null) {
            const t = msDibuat(item);
            if (startMs !== null && !(t >= startMs)) matchDate = false;
            if (endMs !== null && !(t <= endMs)) matchDate = false;
        }

        // --- LOGIKA SEARCH TEXT ---
        // Dilewati sepenuhnya kalau kotak search kosong (hasilnya pasti true).
        let matchSearch = true;
        if (adaPencarian) {
            const issuerUser = userById.get(String(item.issuedBy));
            const issuerName = issuerUser ? issuerUser.username : (item.issuedBy ? `ID: ${item.issuedBy}` : 'Unknown');

            const picUser = userById.get(String(item.picId));
            const picName = picUser ? picUser.username : 'Unassigned';

            const safeTitle = (item.caseNotification || '').toLowerCase();
            const safePic = picName.toLowerCase();
            const safeIssuer = issuerName.toLowerCase();
            const safeId = String(item.id || '').toLowerCase();

            matchSearch = safeTitle.includes(searchFilter) ||
                          safePic.includes(searchFilter) ||
                          safeIssuer.includes(searchFilter) ||
                          safeId.includes(searchFilter);
        }

        // Harus lolos SEMUA filter
        return matchStatus && matchScale && matchCategory && matchDate && matchSearch;
    });

    urutkanIssueStatusTanggal(filteredIssues);

    // Setiap kali filter/pencarian berubah, kembali ke halaman 1
    state.mdFilteredIssues = filteredIssues;
    state.mdCurrentPage = 1;
    renderMDTable();
}

// Versi ber-debounce khusus untuk kotak search (`oninput`). Pemanggilan programatik
// (setelah load data, ganti filter dropdown, dsb.) tetap memakai applyFilterMD() langsung
// supaya hasilnya tampil seketika tanpa jeda.
export const applyFilterMDDebounced = debounce(applyFilterMD, 250);

// ==========================================
// RENDER TABEL MD DENGAN PAGINATION
// ==========================================
function renderMDTable() {
    const tbody = document.querySelector("#view-md tbody");
    if (!tbody) return;
    const role = localStorage.getItem("user_role");
    const filteredIssues = state.mdFilteredIssues || [];
    const totalItems = filteredIssues.length;

    // 1. Tentukan jumlah baris per halaman
    const pageSizeSelect = document.getElementById('md-page-size');
    const pageSizeValue = pageSizeSelect ? pageSizeSelect.value : '10';
    // Opsi "All" sengaja DIHILANGKAN dari dropdown: memilihnya merender seluruh hasil filter
    // sekaligus (1.000 issue = ~1,5 MB HTML, 222 ms per render) dan itu terulang tiap ketukan
    // keyboard di kotak search. Nilai terbesar sekarang 200 -- masih lega untuk ditinjau,
    // tapi biayanya tetap terbatas. Fallback ke 10 kalau nilainya tidak dikenali.
    const pageSize = parseInt(pageSizeValue, 10) || 10;

    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (state.mdCurrentPage > totalPages) state.mdCurrentPage = totalPages;
    if (state.mdCurrentPage < 1) state.mdCurrentPage = 1;

    const startIndex = (state.mdCurrentPage - 1) * pageSize;
    const pageItems = filteredIssues.slice(startIndex, startIndex + pageSize);

    // currentIssueIds tetap memakai SELURUH hasil filter agar navigasi Next/Prev di detail issue
    // tidak terbatas hanya pada satu halaman
    state.currentIssueIds = filteredIssues.map(i => i.id);

    // 2. Update info & tombol pagination di footer
    const footerInfo = document.getElementById('md-footer-info');
    if (footerInfo) {
        footerInfo.innerText = totalItems === 0
            ? 'Showing 0 of 0 issue(s)'
            : `Showing ${startIndex + 1}-${Math.min(startIndex + pageSize, totalItems)} of ${totalItems} issue(s)`;
    }

    const pageInfo = document.getElementById('md-page-info');
    if (pageInfo) pageInfo.innerText = `Page ${state.mdCurrentPage} of ${totalPages}`;

    const btnPrev = document.getElementById('md-btn-prev-page');
    if (btnPrev) btnPrev.disabled = (state.mdCurrentPage <= 1);

    const btnNext = document.getElementById('md-btn-next-page');
    if (btnNext) btnNext.disabled = (state.mdCurrentPage >= totalPages);

    // 3. Render Tabel
    if (pageItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: #6b7280; padding: 24px;">No data found matching the selected filters.</td></tr>`;
        return;
    }

    // Variabel penampung HTML agar render lebih cepat (Optimasi)
    let rowsHTML = '';

    // Index user sekali (O(m)); sebelumnya .find() dipanggil 2x per baris (O(n x m)).
    const userById = state.userById;
    const isMD = (role === 'MD');

    pageItems.forEach((item, index) => {
        const dateStr = formatWitaDate(item.createdAt);
        const dueDateStr = formatWitaDate(item.dueDate);

        let dueDateDisplay = dueDateStr;
        if (isMD) {
            dueDateDisplay = `<span class="md-editable md-editable-due" onclick="openDueDateModal(${item.id}, '${item.dueDate}')" title="Change Due Date">${dueDateStr}</span>`;
        }

        const issuerUser = userById.get(String(item.issuedBy));
        const issuerName = issuerUser ? issuerUser.username : (item.issuedBy ? `ID: ${item.issuedBy}` : 'Unknown');

        const picUser = userById.get(String(item.picId));
        const picName = picUser ? picUser.username : 'Unassigned';

        // Nama di-escape SEKALI di sini; keduanya hanya dipakai untuk tampilan di fungsi ini.
        // Pencocokan teks kotak pencarian memakai nama mentah di applyFilterMD(), terpisah.
        const issuerAman = escapeHtml(issuerName);
        const picAman = escapeHtml(picName);

        let issuerDisplay = issuerAman;
        let picDisplay = picAman;
        if (isMD) {
            const assignArgs = `${item.id}, ${item.picId || 'null'}, ${item.issuedBy || 'null'}`;
            issuerDisplay = `<span class="md-editable md-editable-name" onclick="openEditAssignmentModal(${assignArgs})" title="Edit Assignment">${issuerAman} ✏️</span>`;
            picDisplay = `<span class="md-editable md-editable-pic" onclick="openEditAssignmentModal(${assignArgs})" title="Edit Assignment">${picAman} ✏️</span>`;
        }

        const prioAman = escapeHtml(item.priority);
        let prioBadge = `<span class="badge badge-prio">${prioAman}</span>`;
        if (isMD) {
            // Nilai lewat data-*, bukan literal string di dalam onclick -- pola yang sama
            // dengan tombol Edit/Hapus pengguna, supaya tanda baca apa pun tidak merusaknya.
            prioBadge = `<span class="badge badge-prio md-editable-badge" data-id="${item.id}" data-prio="${prioAman}" onclick="openPriorityModal(this.dataset.id, this.dataset.prio)" title="Change Priority">${prioAman}</span>`;
        }

        const categoryAman = escapeHtml(item.category ? labelKategori(item.category) : '-');
        let categoryBadge = `<span class="badge badge-category">${categoryAman}</span>`;
        if (isMD) {
            categoryBadge = `<span class="badge badge-category md-editable-badge" data-id="${item.id}" data-cat="${escapeHtml(item.category || kategoriDefault())}" onclick="openCategoryModal(this.dataset.id, this.dataset.cat)" title="Change Category">${categoryAman}</span>`;
            // Hanya MD yang pernah melihat issue tersembunyi; penanda ini memberi tahu kenapa
            // Dept Head-nya tidak melihat issue tersebut hari ini. Klik -> atur jadwal issue.
            if (issueTersembunyi(item)) {
                categoryBadge += `<span class="badge badge-hidden md-editable-badge" onclick="openIssueScheduleModal(${item.id})" title="${escapeHtml(deskripsiVisibilitas(item.visibility))}">&#128339; Hidden</span>`;
            }
        }

        rowsHTML += `<tr>
            <td class="td-center">${startIndex + index + 1}</td>
            <td>${escapeHtml(item.caseNotification)}</td>
            <td class="td-issuer">${issuerDisplay}</td>
            <td>${dateStr}</td>
            <td>${dueDateDisplay}</td>
            <td class="td-pic">${picDisplay}</td>
            <td class="td-center">${getStatusBadge(item.status)}</td>
            <td class="td-center">${prioBadge}</td>
            <td class="td-center">${categoryBadge}</td>
            <td class="td-center">${getDailyUpdateBadge(item)}</td>
            <td class="td-center"><button class="btn-sm" onclick="openDetailView(${item.id})">View Details</button></td>
        </tr>`;
    });

    tbody.innerHTML = rowsHTML;
}

// ==========================================
// NAVIGASI HALAMAN (PAGINATION) UNTUK MD
// ==========================================
export function changeMDPage(delta) {
    state.mdCurrentPage = (state.mdCurrentPage || 1) + delta;
    renderMDTable();
}

export function changeMDPageSize() {
    state.mdCurrentPage = 1;
    renderMDTable();
}

// ==========================================
// FITUR SEARCH UNTUK USER BIASA
// ==========================================
export function filterUserHistory() {
    const tbody = document.querySelector('#view-user-history tbody');
    if (!tbody) return;
    
    const searchFilter = document.getElementById('search-user').value.toLowerCase();
    const currentUserId = String(localStorage.getItem('user_id'));

    // Index user sekali di depan (O(m)) supaya lookup PIC jadi O(1).
    // Sebelumnya memakai state.globalUsers.find() DUA kali per issue -- sekali di filter,
    // sekali lagi di loop render -- sehingga biayanya O(n x m). Terasa karena fungsi ini
    // dipanggil lewat oninput, jadi jalan ulang di SETIAP ketukan keyboard.
    const userById = state.userById;
    const picNameOf = (picId) => {
        const u = userById.get(String(picId));
        return u ? u.username : 'Unassigned';
    };

    // Saring berdasarkan kepemilikan (User yang membuat) DAN teks pencarian
    const filteredIssues = state.globalIssues.filter(item => {
        const isMine = String(item.issuedBy) === currentUserId;

        const picName = picNameOf(item.picId).toLowerCase();
        const safeTitle = (item.caseNotification || '').toLowerCase();
        const safeId = String(item.id || '').toLowerCase();

        const matchSearch = safeTitle.includes(searchFilter) ||
                            picName.includes(searchFilter) ||
                            safeId.includes(searchFilter);

        return isMine && matchSearch;
    });

    urutkanIssueStatusTanggal(filteredIssues);

    state.currentIssueIds = filteredIssues.map(i => i.id);

    if (filteredIssues.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #6b7280; padding: 24px;">No data found matching the selected filters.</td></tr>`;
        return;
    }

    // Kumpulkan seluruh baris ke satu string, lalu assign ke DOM SEKALI.
    // `innerHTML +=` di dalam loop memaksa browser men-serialisasi + parse ulang SELURUH
    // tbody tiap iterasi, jadi biayanya O(n^2). Terukur: 1.000 baris = 7.030 ms dengan pola
    // lama, 143 ms dengan pola ini (49x). Pola yang sama sudah dipakai renderMDTable() di
    // file ini -- sekarang konsisten.
    let html = '';
    for (let i = 0; i < filteredIssues.length; i++) {
        const item = filteredIssues[i];
        const dateStr = formatWitaDate(item.createdAt);
        const picName = picNameOf(item.picId);

        html += `<tr>
            <td style="text-align: center;">${i + 1}</td>
            <td>${escapeHtml(item.caseNotification)}</td> <td>${dateStr}</td>
            <td style="font-weight: 500; color: #1591DC;">${escapeHtml(picName)}</td> <td style="text-align: center;">${getStatusBadge(item.status)}</td>
            <td style="text-align: center;"><button class="btn-sm" onclick="openDetailView(${item.id})">View Details</button></td>
        </tr>`;
    }
    tbody.innerHTML = html;
}

// ==========================================
// FITUR SEARCH UNTUK PIC (DEPT HEAD)
// ==========================================
// Blok mana yang sedang terbuka. Disimpan di memori (bukan localStorage) supaya setiap PIC
// yang login selalu mulai dari keadaan yang sama -- di kiosk bergantian orang, keadaan yang
// diwarisi dari user sebelumnya justru membingungkan.
const blokTerbuka = { belum: true, sudah: false, takwajib: false, arsip: false };

const JUDUL_BLOK = {
    belum:    { ikon: '⚠', teks: 'NOT UPDATED TODAY', kelas: 'sect-belum' },
    sudah:    { ikon: '✓', teks: 'Updated today', kelas: 'sect-sudah' },
    takwajib: { ikon: '⏸', teks: 'Not required today (Continue)', kelas: 'sect-takwajib' },
    arsip:    { ikon: '✔', teks: 'Archive — closed & handed over', kelas: 'sect-arsip' },
};

// Badge kolom "Today's Update", DITURUNKAN dari blok yang sudah dihitung -- bukan dari
// getDailyUpdateBadge(), yang akan menjalankan hasUpdatedToday() untuk KEDUA kalinya pada
// issue yang sama (blokTugasPic sudah memanggilnya saat mengelompokkan).
//
// Stringnya konstan dan dibangun sekali saat modul dimuat, jadi merender sebuah baris cuma
// satu pencarian objek -- tanpa perhitungan tanggal, tanpa alokasi string baru.
//
// Ini juga lebih BENAR: untuk issue yang user-nya cuma mantan PIC, getDailyUpdateBadge()
// akan memvonis "Updated/Not Updated" padahal issue itu bukan tanggung jawabnya lagi dan
// tidak menahan Logout-nya. Lewat blok, baris seperti itu jatuh ke 'arsip' dan tampil "-".
const BADGE_BLOK = {
    belum:    '<span class="badge badge-not-updated">⏳ Not Updated</span>',
    sudah:    '<span class="badge badge-updated">✅ Updated Today</span>',
    takwajib: '<span class="badge badge-exempt">⏸ Not Required</span>',
    arsip:    '<span style="color:#9ca3af; font-size:12px;">-</span>',
};

const URUTAN_BLOK = ['belum', 'sudah', 'takwajib', 'arsip'];

// Dipanggil dari onclick judul blok; dibuka ke window di js/app.js.
// Hanya MENGGAMBAR ULANG -- tidak mengklasifikasi ulang. Sebelumnya fungsi ini memanggil
// renderPICTable(), yang menjalankan hasUpdatedToday() untuk SEMUA issue setiap kali sebuah
// blok dibuka atau ditutup, padahal datanya sama sekali tidak berubah.
export function togglePicSection(kunci) {
    if (!(kunci in blokTerbuka)) return;
    blokTerbuka[kunci] = !blokTerbuka[kunci];
    gambarBlokPic();
}

// Render Task List Dept Head, dipisah menjadi empat blok menurut APA YANG HARUS DIKERJAKAN
// hari ini -- bukan lagi dikelompokkan per Category.
//
// Alasannya: pengelompokan per kategori selalu menaruh Weekly di bawah SELURUH isi Daily,
// dan wadah tabelnya cuma memuat 4 baris sekaligus, jadi tugas Weekly yang belum diisi
// praktis tidak pernah terlihat. Sekarang yang menentukan posisi adalah sudah/belum diisi,
// dan kategori tetap terbaca sebagai kolom sendiri.
//
// Blok pertama memakai blokTugasPic() -- predikat yang SAMA PERSIS dengan checkDailyUpdates(),
// supaya isi blok itu benar-benar daftar yang mengunci tombol Logout.
//
// Pengelompokan dilakukan DI SINI SAJA (sekali per pemuatan data / pencarian), lalu hasilnya
// disimpan; menggambar ulang karena melipat blok memakai hasil itu, bukan menghitung lagi.
function renderPICTable(issues) {
    // Disaring ke kategori yang dipilih di layar kategori. Kalau belum ada yang dipilih
    // (mis. masuk lewat tautan lama), seluruh tugas ditampilkan -- lebih baik menampilkan
    // semuanya daripada layar kosong yang tidak bisa dijelaskan.
    // Issue di luar jadwal tampilnya tidak ada sama sekali bagi Dept Head -- termasuk yang
    // hanya pernah ia pegang (blok arsip).
    const kat = state.picKategori;
    const tampil = issues.filter(i => !issueTersembunyi(i));
    const terpakai = kat ? tampil.filter(i => kategoriKartu(i) === kat) : tampil;

    state.picIssues = terpakai;
    const userId = String(localStorage.getItem('user_id'));

    perbaruiJudulPic(kat);

    const blok = { belum: [], sudah: [], takwajib: [], arsip: [] };
    terpakai.forEach(item => blok[blokTugasPic(item, userId)].push(item));
    state.picBlok = blok;

    perbaruiStripPic(blok.belum.length, terpakai.length);

    // Tidak ada tunggakan -> blok "sudah" dibuka sendiri, supaya layar tidak tampak kosong.
    if (blok.belum.length === 0 && !blokTerbuka.sudah) blokTerbuka.sudah = true;

    gambarBlokPic();
}

// Menggambar dari hasil pengelompokan yang sudah tersimpan. Tidak menyentuh tanggal sama sekali.
function gambarBlokPic() {
    const tbody = document.querySelector('#view-pic-update tbody');
    if (!tbody) return;

    const blok = state.picBlok || { belum: [], sudah: [], takwajib: [], arsip: [] };
    const jmlTotal = URUTAN_BLOK.reduce((n, k) => n + blok[k].length, 0);

    if (jmlTotal === 0) {
        state.currentIssueIds = [];
        tbody.innerHTML = `
            <tr><td colspan="8" style="text-align: center; padding: 48px 24px; background-color: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                    <div style="color: #6b7280; font-size: 15px; font-weight: 500;">No Tasks Found</div>
                    <div style="color: #9ca3af; font-size: 13px; margin-top: 4px; font-style: italic;">You're all caught up! There are no tasks matching the current view.</div>
            </td></tr>`;
        return;
    }

    // Urutan Next/Prev di layar detail mengikuti urutan blok di layar ini, dan mencakup
    // SELURUH tugas PIC -- termasuk yang bloknya sedang terlipat.
    const urutTampil = [];

    let html = '';
    let nomor = 0;

    URUTAN_BLOK.forEach(kunci => {
        const daftar = blok[kunci];
        if (daftar.length === 0) return;              // blok kosong disembunyikan total

        const j = JUDUL_BLOK[kunci];
        const terbuka = blokTerbuka[kunci];
        html += `<tr class="tbl-section-head ${j.kelas}">
            <td colspan="8" onclick="togglePicSection('${kunci}')" title="Click to ${terbuka ? 'collapse' : 'expand'}">
                <span class="sect-chev">${terbuka ? '▾' : '▸'}</span>
                <span class="sect-ikon">${j.ikon}</span>
                <span class="sect-teks">${j.teks}</span>
                <span class="sect-jml">(${daftar.length})</span>
            </td>
        </tr>`;

        // Blok terlipat tetap masuk daftar Next/Prev. Begitu sebuah status di-update, issue-nya
        // pindah ke blok "Updated today" yang default-nya tertutup; kalau id-nya ikut hilang dari
        // daftar, navigateIssue() tidak menemukan issue yang sedang dibuka dan tombolnya mati total
        // tanpa penjelasan apa pun -- persis bug yang dilaporkan PIC.
        if (!terbuka) {
            daftar.forEach(item => urutTampil.push(item.id));
            return;
        }

        const kelasBaris = kunci === 'belum' ? ' class="baris-belum"' : '';
        const badgeUpdate = BADGE_BLOK[kunci];

        daftar.forEach(item => {
            nomor++;
            urutTampil.push(item.id);
            const kategori = item.category ? labelKategori(item.category) : '-';

            html += `<tr${kelasBaris}>
                <td style="text-align: center;">${nomor}</td>
                <td>${escapeHtml(item.caseNotification)}</td>
                <td>${formatWitaDate(item.dueDate)}</td>
                <td style="text-align: center;"><span class="badge badge-prio">${escapeHtml(item.priority)}</span></td>
                <td style="text-align: center;">${getStatusBadge(item.status)}</td>
                <td style="text-align: center;"><span class="badge badge-category">${escapeHtml(kategori)}</span></td>
                <td style="text-align: center;">${badgeUpdate}</td>
                <td style="text-align: center;"><button class="btn-sm" onclick="openDetailView(${item.id})">View Details</button></td>
            </tr>`;
        });
    });

    state.currentIssueIds = urutTampil;
    tbody.innerHTML = html;
}

// Judul kartu Task List menyebut kategori yang sedang dibuka, supaya PIC tidak kehilangan
// konteks setelah melewati layar kategori.
function perbaruiJudulPic(kategori) {
    const judul = document.getElementById('pic-list-title');
    if (judul) judul.innerText = kategori ? ('Task List — ' + labelKategori(kategori)) : 'Task List';
}

// Kartu tempat sebuah issue dihitung: nama kanonik kategorinya, atau kategori default bila
// kategorinya tidak dikenal (mis. sudah dihapus dari DB) -- supaya tidak ada tugas yang hilang.
function kategoriKartu(issue) {
    const k = cariKategori(issue.category);
    return k ? k.name : kategoriDefault();
}

// Warna ubin bergiliran menurut urutan kartu.
const WARNA_KARTU = ['ikon-indigo', 'ikon-ungu', 'ikon-teal', 'ikon-amber', 'ikon-langit'];

// -- Layar kategori PIC -------------------------------------------------------
// Kartu dibangun dari daftar kategori yang dikelola MD, dalam urutan yang ditetapkan MD.
// Kategori nonaktif hanya tampil bila masih ada tugas aktif di dalamnya.
//
// Hitungannya memakai blokTugasPic() -- predikat yang SAMA dengan checkDailyUpdates() --
// supaya angka merah di kartu benar-benar mewakili apa yang mengunci tombol Logout.
// Satu lintasan menghasilkan total DAN tunggakan per kategori sekaligus.
function gambarKategoriPic() {
    const userId = String(localStorage.getItem('user_id'));
    const hitung = new Map();
    daftarKategori().forEach(k => hitung.set(k.name, { total: 0, belum: 0 }));

    (state.globalIssues || []).forEach(item => {
        const blok = blokTugasPic(item, userId);
        // Closed / sudah dioper / di luar jadwal tampil: bukan tugas aktif hari ini.
        if (blok === 'arsip' || blok === BLOK_TERJADWAL) return;
        const kat = kategoriKartu(item);
        if (!hitung.has(kat)) hitung.set(kat, { total: 0, belum: 0 });
        hitung.get(kat).total++;
        if (blok === BLOK_BELUM) hitung.get(kat).belum++;
    });

    let totalBelum = 0;
    let html = '';
    let urut = 0;
    hitung.forEach(({ total, belum }, nama) => {
        totalBelum += belum;
        const k = cariKategori(nama);
        if (k && !k.isActive && total === 0) return;

        const label = labelKategori(nama);
        const warna = WARNA_KARTU[urut++ % WARNA_KARTU.length];
        const desc = total === 0 ? 'No active tasks.' : (total + ' active task' + (total === 1 ? '' : 's') + ' assigned to you.');
        // Kategori kosong tetap di posisinya, hanya diredupkan -- posisi tetap itu yang
        // bisa dihafal; kartu yang muncul-hilang memaksa orang mencari tiap kali.
        html += `<button class="menu-card${total === 0 ? ' menu-card-kosong' : ''}" data-kat="${escapeHtml(nama)}" onclick="bukaKategoriPic(this.dataset.kat)">
            <span class="menu-card-ikon ${warna} menu-card-mono">${escapeHtml(label.charAt(0).toUpperCase())}</span>
            <span class="menu-card-judul">${escapeHtml(label)}<span class="menu-card-badge"${belum === 0 ? ' hidden' : ''}>${belum} not updated</span></span>
            <p class="menu-card-desc">${desc}</p>
            <span class="menu-card-aksi">Open &rarr;</span>
        </button>`;
    });

    const grid = document.getElementById('pic-cat-grid');
    if (grid) grid.innerHTML = html;

    const strip = document.getElementById('pic-cat-alert');
    if (strip) {
        strip.className = 'pic-alert ' + (totalBelum > 0 ? 'pic-alert-bahaya' : 'pic-alert-aman');
        strip.innerHTML = totalBelum > 0
            ? '<span class="pic-alert-ikon">⚠</span><span><strong>' + totalBelum
              + ' task(s) not updated today.</strong> Logout will be blocked until all of them are filled in.</span>'
            : '<span class="pic-alert-ikon">✓</span><span>All of today’s tasks have been updated.</span>';
    }
}

// Dipanggil router saat layar kategori dibuka. Mengambil data SEKALI, lalu menandainya
// segar; tabel per kategori memakai ulang data itu tanpa permintaan baru (lihat
// loadDashboardPIC). Jadi alur menu -> kategori -> tabel tetap dua permintaan, sama
// seperti alur lama yang lebih pendek.
let dataPicSegar = false;

export async function muatKategoriPic() {
    try {
        const [, issues] = await Promise.all([
            fetchUsersForMapping(),
            ambilIssueRingkas(),
            // Gagal memuat kategori tidak boleh menyembunyikan tugas: semua jatuh ke kartu default.
            muatKategori().catch(() => null),
        ]);
        state.globalIssues = issues;
        dataPicSegar = true;
    } catch (e) {
        console.error('Gagal memuat kategori PIC:', e);
    }
    gambarKategoriPic();
}

// Dibuka ke window di js/app.js; dipanggil onclick kartu kategori.
export function bukaKategoriPic(kategori) {
    const k = cariKategori(kategori);
    state.picKategori = k ? k.name : null;
    window.showView('view-pic-update');
}

// Penanda angka di tombol "Update Task List" pada menu PIC. Ini peringatan PALING AWAL
// yang mungkin: PIC tahu ada tunggakan sebelum membuka layarnya sama sekali. Dipanggil saat
// menu PIC ditampilkan. Gagal diam-diam kalau server tidak terjangkau -- penanda yang hilang
// tidak boleh menghalangi orang memakai menunya.
export async function perbaruiBadgeMenuPic() {
    const badge = document.getElementById('pic-menu-badge');
    if (!badge) return;
    if (localStorage.getItem('user_role') !== 'Dept Head') { badge.hidden = true; return; }

    try {
        // Dulu ini menarik SELURUH dataset issue hanya untuk satu angka badge, tiap kali menu
        // Dept Head dibuka. Lewat cache, kunjungan berikutnya dalam 30 detik gratis -- dan layar
        // Task List yang biasanya dibuka setelahnya ikut memakai hasil yang sama.
        const semua = await ambilIssueRingkas();
        const jml = tugasTertunda(semua, localStorage.getItem('user_id')).length;
        badge.innerText = jml;
        badge.hidden = jml === 0;
    } catch (e) {
        badge.hidden = true;
    }
}

// Strip di LUAR wadah bergulir, jadi ia tidak pernah ikut tergulir hilang. Ini elemen yang
// memikul beban utama: apa pun yang terjadi di dalam tabel, angka tunggakan selalu terlihat.
function perbaruiStripPic(jmlBelum, jmlTotal) {
    const strip = document.getElementById('pic-alert-belum');
    if (strip) {
        strip.className = 'pic-alert ' + (jmlBelum > 0 ? 'pic-alert-bahaya' : 'pic-alert-aman');
        strip.innerHTML = jmlBelum > 0
            ? `<span class="pic-alert-ikon">⚠</span>
               <span><strong>${jmlBelum} task(s) not updated today.</strong>
               Logout will be blocked until all of them are filled in.</span>`
            : `<span class="pic-alert-ikon">✓</span>
               <span>All of today's tasks have been updated.</span>`;
    }
    const hitung = document.getElementById('pic-total-count');
    if (hitung) hitung.innerText = jmlTotal;
}

export function filterPICHistory() {
    const searchFilter = document.getElementById('search-pic').value.toLowerCase();
    const currentUserId = String(localStorage.getItem('user_id'));

    const filteredIssues = state.globalIssues.filter(item => {
        // Hapus variabel isNotClosed di sini juga
        const isCurrentPic = (String(item.picId) === currentUserId);

        let isPastPic = false;
        if (item.involvedPicIds) {
            const historyArray = item.involvedPicIds.split(',');
            isPastPic = historyArray.includes(currentUserId);
        }

        // Ubah baris ini
        const isMyTask = (isCurrentPic || isPastPic);

        const safeTitle = (item.caseNotification || '').toLowerCase();
        const safeId = String(item.id || '').toLowerCase();
        const matchSearch = safeTitle.includes(searchFilter) || safeId.includes(searchFilter);

        return isMyTask && matchSearch;
    });

    urutkanIssueStatusTanggal(filteredIssues);

    renderPICTable(filteredIssues);
}

export async function loadDashboardPIC() {
    try {
        // Token SEKALI PAKAI. Layar kategori baru saja mengambil data yang sama persis;
        // mengambilnya lagi sedetik kemudian hanya menambah satu perjalanan jaringan tanpa
        // informasi baru. Token langsung dihanguskan, jadi kunjungan BERIKUTNYA -- termasuk
        // kembali dari layar detail setelah menyimpan update -- tetap mengambil data segar.
        // Ini penting: tanpa penghangusan itu, tabel bisa menampilkan "Not Updated" untuk
        // issue yang baru saja diisi PIC-nya.
        if (dataPicSegar) {
            dataPicSegar = false;
        } else {
            // Kedua permintaan ini saling bebas, jadi dijalankan BERSAMAAN. Sebelumnya
            // berurutan: /auth/users harus selesai sepenuhnya sebelum /issue dimulai,
            // sehingga setiap pembukaan dashboard membayar dua kali waktu tempuh jaringan.
            const [, issues] = await Promise.all([
                fetchUsersForMapping(),
                ambilIssueRingkas(),
            ]);
            state.globalIssues = issues;
        }

        const currentUserId = String(localStorage.getItem('user_id'));

        const activeIssues = state.globalIssues.filter(i => {
            // Hapus atau abaikan variabel isNotClosed
            const isCurrentPic = (String(i.picId) === currentUserId);

            let isPastPic = false;
            if (i.involvedPicIds) {
                const historyArray = i.involvedPicIds.split(',');
                isPastPic = historyArray.includes(currentUserId);
            }

            // Ubah baris return ini (hilangkan isNotClosed)
            return (isCurrentPic || isPastPic);
        });

        urutkanIssueStatusTanggal(activeIssues);

        renderPICTable(activeIssues);
    } catch (error) { console.error("Failed to load PIC dashboard:", error); }
}

// =========================================================================
// FITUR: MENAMPILKAN ARSIP MOM DARI BACKEND NESTJS
// =========================================================================
export async function loadMOMArchives() {
    const tbody = document.getElementById('tbody-mom-archives');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px;">Loading archives from server...</td></tr>';

    try {
        // Pakai API_URL dari config.js -- sebelumnya alamat server ditulis ulang di sini,
        // menduplikasi config dan berisiko terlewat saat alamat server berubah.
        const response = await fetch(`${API_URL}/arsip-mom`, {
            method: 'GET',
            headers: getAuthHeaders()
        });

        if (!response.ok) throw new Error("Failed to fetch archives");

        const result = await response.json();
        
        if (result.success && result.data.length > 0) {
            // Sekarang isinya METADATA saja (tanpa dataIssues) -- cukup untuk daftar.
            // Detail lengkap diambil per-arsip lewat fetchMOMArchiveDetail() saat diklik.
            state.cachedMOMArchives = result.data;

            // Kumpulkan ke satu string lalu assign SEKALI -- pola yang sama dengan semua tabel
            // lain di berkas ini (lihat catatan di renderMDTable). Ini SATU-SATUNYA tabel yang
            // masih memakai createElement + appendChild per baris.
            //
            // Jujur saja: daftar arsip isinya metadata dan jumlahnya sedikit, jadi keuntungan
            // kecepatannya di sini praktis nol. Alasannya konsistensi -- supaya tidak ada satu
            // pola menyimpang yang tertinggal untuk disalin orang berikutnya.
            let html = '';
            result.data.forEach((arsip, index) => {
                // Format tanggal export menjadi format yang rapi (English)
                const exportDate = formatWitaDateTime(arsip.tanggalExport || arsip.tanggal_export, 'en-GB', {
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                });

                html += `<tr>
                    <td style="text-align:center;">${index + 1}</td>
                    <td style="font-weight: 500;">${exportDate}</td>
                    <td>${escapeHtml(arsip.chairman || '-')}</td>
                    <td>${escapeHtml(arsip.notulen || '-')}</td>
                    <td>${escapeHtml(arsip.location || '-')}</td>
                    <td style="text-align:center;">
                        <button class="btn-sm" style="background-color: #1591DC;" onclick="viewMOMDetail(${arsip.id})">View Detail</button>
                    </td>
                </tr>`;
            });
            tbody.innerHTML = html;
        } else {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#6b7280; padding:20px;">No MOM archives found in the server.</td></tr>';
        }
    } catch (error) {
        console.error("Error loading archives:", error);
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#ef4444; padding:20px;">Failed to connect to the server.</td></tr>';
    }
}

// Fungsi dummy untuk tombol "View Detail" (Anda bisa mengembangkannya nanti jika ingin melihat isi PICA-nya lagi)
// ==========================================
// MENAMPILKAN MODAL DETAIL ARSIP MOM
// ==========================================
// ==========================================
// MENAMPILKAN MODAL DETAIL ARSIP MOM
// ==========================================
// Ambil SATU arsip lengkap (termasuk dataIssues) dari server. Daftar arsip sengaja tidak
// lagi membawa dataIssues, jadi detailnya diambil saat benar-benar dibutuhkan.
// Mengembalikan null untuk SETIAP kegagalan, termasuk koneksi putus. Kedua pemanggil
// (viewMOMDetail & downloadMOMArchive) sudah menangani null dengan pesan yang benar, tapi
// keduanya dipanggil lewat onclick inline -- sehingga fetch yang MELEMPAR dulu lolos
// begitu saja: tombol "View Detail" tidak melakukan apa pun, tanpa modal, tanpa pesan,
// hanya unhandled rejection di konsol yang tidak bisa dibuka pengguna kiosk.
async function fetchMOMArchiveDetail(id) {
    try {
        const res = await fetch(`${API_URL}/arsip-mom/${id}`, { headers: getAuthHeaders() });
        if (!res.ok) return null;
        const hasil = await res.json();
        return hasil && hasil.success ? hasil.data : null;
    } catch (e) {
        console.error('Gagal mengambil detail arsip MOM:', e);
        return null;
    }
}

export async function viewMOMDetail(id) {
    const archive = await fetchMOMArchiveDetail(id);
    if (!archive) return showCustomAlert("Error", "Failed to load archive detail.");

    document.getElementById('det-mom-notulen').innerText = archive.notulen || '-';
    document.getElementById('det-mom-chairman').innerText = archive.chairman || '-';
    document.getElementById('det-mom-date').innerText = archive.date || '-';
    document.getElementById('det-mom-time').innerText = archive.time || '-';
    document.getElementById('det-mom-location').innerText = archive.location || '-';

    // Satu operand saja. Baris ini dulu berbunyi `archive.participants || archive.participants`
    // -- operand kembar, meniru pola `dataIssues || data_issues` enam baris di bawah. Bedanya,
    // `dataIssues` memang di-@map ke `data_issues` di schema.prisma, sedangkan `participants`
    // tidak dipetakan sama sekali, jadi tidak ada nama alternatif yang perlu dijajaki.
    let participants = archive.participants;
    if (typeof participants === 'string') {
        try { participants = JSON.parse(participants); } catch (e) { participants = []; }
    }
    document.getElementById('det-mom-participants').innerText = Array.isArray(participants) && participants.length > 0 ? participants.join(', ') : '-';

    let issues = archive.dataIssues || archive.data_issues;
    if (typeof issues === 'string') {
        try { issues = JSON.parse(issues); } catch (e) { issues = []; }
    }

    const tbody = document.getElementById('det-mom-issues');

    if (Array.isArray(issues) && issues.length > 0) {
        // Kumpulkan ke satu string lalu assign SEKALI (pola sama dengan renderMDTable()).
        let html = '';
        for (let idx = 0; idx < issues.length; idx++) {
            const item = issues[idx];
            // escapeHtml(), sama seperti setiap tabel lain di app. Kedua nilai di bawah dulu
            // disisipkan MENTAH ke innerHTML -- satu-satunya tempat yang tersisa seperti itu.
            // Judul issue diketik user, jadi judul yang memuat < atau & merusak tampilan baris.
            // Ini MENGUBAH keluaran yang terlihat: teks yang dulu tercetak sebagai markup kini
            // tampil sebagai teks apa adanya, yang memang yang seharusnya.
            const prioBadge = item.priority ? `<span class="badge badge-prio">${escapeHtml(item.priority)}</span>` : '-';

            // PERBAIKAN: Baris tabel dicetak dengan padding yang lebih luas dan border bawah tipis
            html += `
                <tr style="border-bottom: 1px solid #e5e7eb; transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='#f9fafb'" onmouseout="this.style.backgroundColor='transparent'">
                    <td style="padding: 12px 16px; text-align: center; color: #4b5563;">${idx + 1}</td>
                    <td style="padding: 12px 16px; font-weight: 500; color: #111827;">${escapeHtml(item.caseNotification || '-')}</td>
                    <td style="padding: 12px 16px; text-align: center;">${getStatusBadge(item.status)}</td>
                    <td style="padding: 12px 16px; text-align: center;">${prioBadge}</td>
                </tr>
            `;
        }
        tbody.innerHTML = html;
    } else {
        tbody.innerHTML = '<tr><td colspan="4" style="padding: 24px; text-align: center; color: #6b7280; font-style: italic;">No issue data recorded in this meeting.</td></tr>';
    }

    // Sambungkan tombol download ke ID ini
    document.getElementById('btn-redownload').setAttribute('onclick', `downloadMOMArchive(${id}, 'pdf')`);
    document.getElementById('btn-redownload-excel').setAttribute('onclick', `downloadMOMArchive(${id}, 'excel')`);

    // Animasi masuk/keluar ditangani .modal-overlay di style.css, sama dengan modal lain.
    document.getElementById('modal-mom-detail').classList.add('show');
}

export function closeMOMDetail() {
    document.getElementById('modal-mom-detail').classList.remove('show');
}

// ==========================================
// FITUR REFRESH MOM ARCHIVES
// ==========================================
export async function refreshMOMArchives() {
    try {
        const btnRefresh = document.querySelector('#view-mom-archive button[onclick="refreshMOMArchives()"]');
        if (btnRefresh) btnRefresh.innerText = "Refreshing...";
        
        await loadMOMArchives();
        
        if (btnRefresh) btnRefresh.innerText = "Refresh Data";
        showCustomAlert("Success", "Archive data has been successfully refreshed!");
    } catch (error) { 
        showCustomAlert("Error", "Failed to refresh archive data."); 
    }
}

// ==========================================
 // FITUR RE-DOWNLOAD ARSIP (PDF ATAU EXCEL)
 // ==========================================
 export async function downloadMOMArchive(id, format = 'pdf') {
     const archive = await fetchMOMArchiveDetail(id);
     if (!archive) return showCustomAlert("Error", "Failed to load archive detail.");

     // Ekstrak data JSON kembali menjadi format objek aslinya
     let parsedParticipants = archive.participants;
     let parsedIssues = archive.dataIssues || archive.data_issues;

     if (typeof parsedParticipants === 'string') {
         try { parsedParticipants = JSON.parse(parsedParticipants); } catch (e) { parsedParticipants = []; }
     }
     // Kolom ini nullable; arsip lama bisa menyimpan null, dan null bukan array.
     if (!Array.isArray(parsedParticipants)) parsedParticipants = [];
     if (typeof parsedIssues === 'string') {
         try { parsedIssues = JSON.parse(parsedIssues); } catch (e) { parsedIssues = []; }
     }

     // Siapkan 'momData' sama persis seperti yang dulu disubmit ke modal
     const momData = {
         notulen: archive.notulen,
         chairman: archive.chairman,
         date: archive.date || archive.tanggal_export, // Gunakan tanggal arsip
         time: archive.time,
         location: archive.location,
         participants: parsedParticipants,
         dataIssues: parsedIssues, // Kita selipkan riwayat tabel PICA-nya di sini
         isArchive: true // Tanda bahwa ini adalah proses download ulang
     };

     // Tutup modal agar rapi, lalu jalankan fungsi export sesuai format yang diminta
     closeMOMDetail();
     if (format === 'excel') await exportFilteredIssuesToExcel('MD', momData);
     else await exportFilteredIssuesToPDF('MD', momData);
 }

// Versi ber-debounce untuk kotak search (`oninput`). Pemanggilan programatik tetap
// memakai fungsi aslinya supaya hasilnya tampil seketika tanpa jeda.
export const filterUserHistoryDebounced = debounce(filterUserHistory, 250);
export const filterPICHistoryDebounced = debounce(filterPICHistory, 250);
