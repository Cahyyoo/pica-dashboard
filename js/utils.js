import { API_URL, getAuthHeaders } from './config.js';
// issue-state.js tidak meng-impor apa pun, jadi ini tidak membuat impor melingkar.
import { state } from './issue-state.js';

let alertTimeout;

// Catatan otomatis dari sistem (task forwarded/return, assignment dikoreksi MD, penanda hasil
// import Excel) berguna untuk audit trail di dalam aplikasi, tapi bikin tampilan Remark di
// export (PDF/Excel) jadi berantakan. Buang semua segmen otomatis itu sebelum masuk ke file
// export — remark manual yang benar-benar diketik user tetap dipertahankan. Data asli di
// database tidak berubah. Diletakkan di sini (bukan di issue-pdf.js) supaya bisa dipakai
// bareng oleh js/issue-pdf.js DAN js/issue-excel-export.js tanpa saling circular-import.
const AUTO_SYSTEM_NOTE_PATTERNS = [
    /^\[🔄.*Task Forwarded to:/i,          // PIC dipindahkan/forward ke PIC lain
    /^\[✏️.*Assignment corrected manually/i, // Issued By/PIC dikoreksi manual oleh MD
    /^\[Imported via Excel by/i,            // penanda hasil Import Excel
    /^Original Date Issue:/i,               // catatan tanggal asli dari Import Excel
    /^Original Issued \(Excel\):/i,         // catatan "Issued" asli dari Import Excel
    /^Original PIC \(Excel\):/i,            // catatan "PIC" asli dari Import Excel
];

export function stripAutoForwardNotes(text) {
    if (!text) return '';
    return text
        .split('|')
        .map(part => part.trim())
        .filter(part => part && !AUTO_SYSTEM_NOTE_PATTERNS.some(re => re.test(part)))
        .join(' | ');
}

// --- HELPER: MENGUBAH GAMBAR LOGO MENJADI BASE64 (DIPAKAI OLEH EXPORT PDF & EXCEL) ---
export function getBase64Image(imgPath) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL("image/png"));
        };
        img.onerror = () => {
            console.warn("Gagal memuat logo, fallback ke teks.");
            resolve(null);
        };
        img.src = imgPath;
    });
}

// --- ARSIP MOM: RAMPINGKAN DATA ISSUE SEBELUM DIARSIPKAN ---
// Sebelumnya objek issue disimpan apa adanya, termasuk SELURUH array histories. Diukur dari
// dump produksi: tabel arsip = 77% isi database, dan 74,6% dari arsip itu adalah histories --
// padahal histories cuma dipakai untuk mengambil SATU string remark terakhir per issue.
//
// Fungsi ini menyimpan hanya field yang benar-benar dibaca kembali (oleh viewMOMDetail dan
// oleh re-download PDF/Excel), plus remark terakhir yang sudah dihitung di muka.
// Terukur: 48,9 KB -> 10,6 KB per arsip (4,6x lebih kecil).
//
// Nama PIC & Issuer disimpan sebagai NAMA, bukan id. Sebelumnya id di-resolve ke daftar user
// saat re-download, sehingga arsip lama ikut berubah kalau user di-rename/dihapus -- padahal
// arsip seharusnya potret sejarah yang tetap.
export function buildArchiveIssues(issues, userById) {
    return issues.map(i => {
        const issuer = userById.get(String(i.issuedBy));
        const pic = userById.get(String(i.picId));

        let latestRemark = '';
        if (i.histories && i.histories.length > 0) {
            const latest = riwayatTerbaru(i.histories);
            latestRemark = stripAutoForwardNotes(latest.remark) || '';
        }

        return {
            id: i.id,
            caseNotification: i.caseNotification,
            createdAt: i.createdAt,
            dueDate: i.dueDate,
            status: i.status,
            priority: i.priority,
            category: i.category,
            correctiveAction: i.correctiveAction || i.description || '',
            // Fallback dibuat PERSIS sama dengan jalur baca, supaya hasil re-download identik
            issuerName: issuer ? issuer.username : `ID: ${i.issuedBy}`,
            picName: pic ? pic.username : '-',
            latestRemark,
        };
    });
}

// Timeline remarks are user-typed and were being interpolated straight into innerHTML.
// A feature whose whole purpose is re-editing that text is the wrong place to leave that
// standing, so everything rendered from a remark now goes through here.
export function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Entries written by the system rather than typed by the PIC. Mirrors PENANDA_SISTEM in
// issue.service.ts -- the server is the real gate, this only decides whether to draw a button.
// Hanya penanda INI yang menentukan kunci logout harian: hasUpdatedToday() menolak
// entri terbaru yang memuatnya. Diberi nama supaya tidak perlu ditulis ulang sebagai
// literal telanjang di bawah -- dan supaya jelas bahwa dua penanda lainnya TIDAK
// berpengaruh ke kunci logout. Komentar di issue.service.ts:8-11 menyatakan hal sama.
const PENANDA_FORWARD = '[\u{1F504} Task Forwarded to:';
const PENANDA_SISTEM = [PENANDA_FORWARD, '[\u{270F}', '[Imported via Excel by '];

/**
 * Can the current user correct this history entry? Mirrors the six server-side rules so the
 * button is only drawn when the request would actually succeed. The server still enforces
 * every one of them; this is convenience, not security.
 */
export function isEditableLastUpdate(issue, hist) {
    if (!issue || !hist) return false;

    // Tombolnya memanggil PATCH /issue/history/:historyId, yang hanya ada di backend 2.3.0.
    // Di backend lama ia harus tidak muncul sama sekali -- membiarkannya tampil berarti user
    // menekannya lalu mendapat kegagalan tanpa sebab yang bisa ia mengerti.
    if (state.backendPunyaDetail === false) return false;

    if (localStorage.getItem('user_role') !== 'Dept Head') return false;
    if (String(issue.picId) !== String(localStorage.getItem('user_id'))) return false;
    if (issue.status === 'Closed') return false;

    // Newest entry, computed rather than trusting the array order.
    const terbaru = riwayatTerbaru(issue.histories);
    if (!terbaru || terbaru.id !== hist.id) return false;

    // Today, compared in WITA the same way the rest of the app does.
    if (formatWitaDate(hist.createdAt, 'en-CA') !== formatWitaDate(new Date(), 'en-CA')) return false;

    if (hist.createdById != null && String(hist.createdById) !== String(localStorage.getItem('user_id'))) return false;
    if (PENANDA_SISTEM.some(p => String(hist.remark || '').includes(p))) return false;
    return true;
}

// --- ACTIVITY LOG: REPORT AN ACTION THE SERVER CANNOT SEE FOR ITSELF ---
// Exports are generated entirely in the renderer and never reach the backend, and the Excel
// import loops create+update per row so the server never sees an "import". Those four are
// the only actions reported from here; everything else is recorded server-side, where it
// cannot be skipped. Best-effort by design: a failed audit write must never break the action
// the user actually asked for.
export function reportActivity(action, detail = {}) {
    fetch(`${API_URL}/activity`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ action, ...detail }),
    }).catch((error) => {
        console.warn('Gagal mencatat aktivitas:', action, error);
    });
}

// --- ARSIP MOM: SIMPAN CATATAN MEETING KE BACKEND (DIPAKAI OLEH EXPORT PDF & EXCEL) ---
export async function archiveMOMRecord(archiveObject) {
    const response = await fetch(`${API_URL}/arsip-mom`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(archiveObject)
    });
    return response.ok;
}

// --- ZONA WAKTU TAMPILAN: SELALU WITA (Asia/Makassar, UTC+8) ---
// Backend menyimpan & mengirim semua timestamp (createdAt/updatedAt/dll) dalam UTC murni
// (format ISO diakhiri "Z") — itu sudah benar dan tidak perlu diubah. Tanpa opsi timeZone
// eksplisit di sini, JS akan otomatis mengonversi ke timezone OS laptop yang menjalankan
// aplikasi, yang seharusnya WITA tapi rawan salah kalau ada laptop kiosk yang jam/zona
// waktunya belum diset dengan benar. Fungsi ini memaksa tampilan selalu WITA apa pun
// timezone OS-nya, supaya tanggal/jam yang dilihat user selalu konsisten benar.
const WITA_TIMEZONE = 'Asia/Makassar';

// --- DEBOUNCE: tunda eksekusi sampai user berhenti mengetik ---
// Dipakai untuk kotak search yang terikat `oninput`. Tanpa ini, mengetik 5 huruf memicu
// 5 siklus filter + sort + render penuh; dengan debounce cukup 1 kali. Efek sampingnya
// justru terasa lebih responsif, karena input tidak lagi tersendat tiap huruf.
export function debounce(fn, delayMs = 250) {
    let timer = null;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delayMs);
    };
}

export function formatWitaDate(dateInput, locale = 'en-GB', options = {}) {
    if (!dateInput) return '-';
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString(locale, { ...options, timeZone: WITA_TIMEZONE });
}

export function formatWitaDateTime(dateInput, locale = 'en-GB', options = {}) {
    if (!dateInput) return '-';
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleString(locale, { ...options, timeZone: WITA_TIMEZONE });
}

export function showCustomAlert(title, message) {
    const alertBox = document.getElementById('custom-alert');
    const iconBox = document.getElementById('alert-icon');
    const titleEl = document.getElementById('alert-title');
    
    // Set teks
    titleEl.innerText = title;
    document.getElementById('alert-message').innerText = message;
    
    // Deteksi warna dan ikon berdasarkan kata kunci di title
    const lowerTitle = title.toLowerCase();
    
    if (lowerTitle.includes('success')) {
        // Tema Hijau (Berhasil)
        alertBox.style.borderLeftColor = '#10b981';
        iconBox.style.backgroundColor = '#d1fae5';
        iconBox.style.color = '#059669';
        iconBox.innerText = '✓';
    } else if (lowerTitle.includes('error') || lowerTitle.includes('fail')) {
        // Tema Merah (Gagal)
        alertBox.style.borderLeftColor = '#ef4444';
        iconBox.style.backgroundColor = '#fee2e2';
        iconBox.style.color = '#b91c1c';
        iconBox.innerText = '✕';
    } else {
        // Tema Kuning (Warning / Info)
        alertBox.style.borderLeftColor = '#f59e0b';
        iconBox.style.backgroundColor = '#fef3c7';
        iconBox.style.color = '#b45309';
        iconBox.innerText = '!';
    }

    // Tampilkan notifikasi dengan meluncur ke bawah
    alertBox.classList.add('show');

    // Hapus timer lama jika ada notifikasi bertubi-tubi
    if (alertTimeout) {
        clearTimeout(alertTimeout);
    }
    
    // Sembunyikan otomatis setelah 3 detik (3000 ms)
    alertTimeout = setTimeout(() => {
        alertBox.classList.remove('show');
    }, 3000); 
}

export function closeCustomAlert() {
    const alertBox = document.getElementById('custom-alert');
    if (alertBox) alertBox.classList.remove('show');
}

export function showView(viewId) {
    // Null-check: sebelumnya getElementById(...).classList langsung diakses, sehingga satu
    // id salah ketik melempar TypeError -- dan karena kelas .active SUDAH dilepas dari semua
    // layar sebelum baris itu, kiosk berakhir menampilkan layar KOSONG tanpa jalan kembali.
    const layar = document.getElementById(viewId);
    if (!layar) {
        console.error('showView: layar tidak ditemukan ->', viewId);
        return;
    }
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    layar.classList.add('active');
}

export function navigateToRole(role) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('global-nav').style.display = 'flex'; 
    document.getElementById('user-badge').innerText = role;       

    // Perubahan: Hapus Admin, Tambahkan KTT
    if (role === "User") document.getElementById('view-user-menu').classList.add('active');
    else if (role === "Dept Head") document.getElementById('view-dept-head').classList.add('active'); 
    else if (role === "MD") document.getElementById('view-md-menu').classList.add('active');
    else if (role === "KTT") document.getElementById('view-ktt-menu').classList.add('active');
}

export function getStatusBadge(status) {
    // Status condition values match the backend/database records
    if (status === 'Open') return '<span class="badge badge-open">Open</span>';
    if (status === 'Progress') return '<span class="badge badge-progress">Progress</span>';
    // Tanpa cabang eksplisit, "Continue" jatuh ke return di bawah dan tampil memakai
    // .badge-prio kuning -- persis sama dengan Closed, jadi tidak bisa dibedakan.
    if (status === 'Continue') return '<span class="badge badge-continue">Continue</span>';
    return `<span class="badge badge-prio">${escapeHtml(status)}</span>`;
}

// --- PENANDA APAKAH ISSUE SUDAH DIUPDATE OLEH PIC HARI INI ---
// Batas hari WITA sebagai rentang epoch-ms. WITA = UTC+8 tetap (tanpa DST), jadi ini bisa
// dihitung aritmetika murni -- tidak perlu toLocaleDateString yang jauh lebih mahal dan,
// yang lebih penting, tidak ikut zona waktu OS laptop kiosk.
export function rentangHariWita(saat = Date.now()) {
    const OFFSET = 8 * 60 * 60 * 1000;
    const SEHARI = 24 * 60 * 60 * 1000;
    const awal = Math.floor((saat + OFFSET) / SEHARI) * SEHARI - OFFSET;
    return { awal, akhir: awal + SEHARI };
}

export function hasUpdatedToday(issue) {
    const histories = issue && issue.histories;
    if (!histories || histories.length === 0) return false;

    // WITA, bukan zona waktu OS. Dulu memakai toDateString() yang mengikuti jam mesin,
    // sehingga kiosk yang zonanya belum diset WITA bisa menampilkan lencana hijau
    // "Updated Today" TAPI tetap menolak Logout -- dua jawaban berbeda untuk satu hari
    // yang sama. isEditableLastUpdate() dan witaDayRange() di backend sudah pakai WITA.
    const { awal, akhir } = rentangHariWita();

    // Satu lintasan. Versi lama menyalin array lewat filter() lalu sort() penuh, hanya
    // untuk mengambil SATU elemen -- dan fungsi ini dipanggil sekali per BARIS tabel.
    let terbaru = null, terbaruMs = -Infinity;
    for (const hist of histories) {
        const ms = new Date(hist.createdAt).getTime();
        if (ms < awal || ms >= akhir) continue;
        if (ms > terbaruMs) { terbaru = hist; terbaruMs = ms; }
    }
    if (!terbaru) return false;

    // Forward ke PIC lain bukan progress update. HANYA penanda ini yang berlaku di sini:
    // entri hasil edit dan hasil import Excel TETAP dihitung sebagai update hari itu,
    // persis seperti sebelumnya. Dulu penanda ini ditulis sebagai literal telanjang --
    // salinan keempat di luar daftar bernama, dan satu-satunya yang menopang kunci logout.
    return !String(terbaru.remark || '').includes(PENANDA_FORWARD);
}

export function getDailyUpdateBadge(issue) {
    if (issue.status === 'Closed') return '<span style="color:#9ca3af; font-size:12px;">-</span>';

    // Status "Continue" berarti issue sengaja dilanjutkan besok: dia TIDAK mengunci
    // Logout/Exit. Karena itu lencana kuning "Not Updated Yet" -- yang bahasanya berarti
    // "wajib diupdate hari ini" -- akan menyesatkan di sini. Lencana hijau tetap
    // ditampilkan kalau PIC memang sempat mengupdate, supaya MD bisa membedakan
    // Continue yang masih dikerjakan dari yang didiamkan.
    if (issue.status === 'Continue') {
        return hasUpdatedToday(issue)
            ? '<span class="badge badge-updated">✅ Updated Today</span>'
            : '<span class="badge badge-exempt">⏸ Not Required</span>';
    }

    return hasUpdatedToday(issue)
        ? '<span class="badge badge-updated">✅ Updated Today</span>'
        : '<span class="badge badge-not-updated">⏳ Not Updated</span>';
}

// --- MODULAR HTML INJECTION FUNCTION ---
export async function loadComponent(containerId, filePath) {
    try {
        const response = await fetch(filePath);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const html = await response.text();
        
        // Inject HTML into the target container
        document.getElementById(containerId).insertAdjacentHTML('beforeend', html);
    } catch (error) {
        console.error(`Failed to load component ${filePath}:`, error);
    }
}

// --- CONFIRMATION MODAL CONTROL (CUSTOM CONFIRM) ---
export function showCustomConfirm(title, message, onConfirmCallback) {
    document.getElementById('confirm-title').innerText = title;
    document.getElementById('confirm-message').innerText = message;
    document.getElementById('custom-confirm').classList.add('show');

    const btnYes = document.getElementById('btn-confirm-yes');
    
    // Execute the callback (e.g., Delete API) ONLY if the 'Yes' button is clicked
    btnYes.onclick = () => {
        closeCustomConfirm(); 
        if (typeof onConfirmCallback === 'function') {
            onConfirmCallback(); 
        }
    };
}

export function closeCustomConfirm() {
    document.getElementById('custom-confirm').classList.remove('show');
}

// -- Penyaring bersama untuk KEDUA jalur ekspor (PDF & Excel) ------------------
// Sebelumnya blok filter ini disalin utuh di issue-pdf.js dan issue-excel-export.js,
// dan KEDUANYA lupa membaca kotak pencarian 'search-md'. Akibatnya MD yang mengetik
// kata kunci melihat 3 baris di layar tapi mengekspor seluruh tabel -- lalu hasil yang
// salah itu diarsipkan PERMANEN sebagai MOM. Satu sumber supaya tidak bisa hanyut lagi.
//
// Satu perbedaan dari layar SENGAJA dipertahankan: saat status "All", ekspor
// mengecualikan issue yang sudah Closed; layar tetap menampilkannya.
//
// Pencocokan teks dibuat persis seperti applyFilterMD() -- termasuk TIDAK mem-trim
// nilai kotaknya, supaya layar dan ekspor tidak pernah berbeda hasil.
export function saringIssueUntukEkspor(issues, users) {
    const nilai = (id) => {
        const el = document.getElementById(id);
        return el ? el.value : '';
    };
    const search   = nilai('search-md').toLowerCase();
    const status   = nilai('filter-status-md') || 'All';
    const scale    = nilai('filter-scale-md') || 'All';
    const category = nilai('filter-category-md') || 'All';
    const startStr = nilai('filter-date-start-md');
    const endStr   = nilai('filter-date-end-md');

    // Batas tanggal dihitung SEKALI, bukan dibangun ulang per issue seperti versi lama.
    let startMs = null, endMs = null;
    if (startStr) { const d = new Date(startStr); d.setHours(0, 0, 0, 0);      startMs = d.getTime(); }
    if (endStr)   { const d = new Date(endStr);   d.setHours(23, 59, 59, 999); endMs   = d.getTime(); }

    // Index user dibangun HANYA kalau kotak pencarian terisi -- kalau kosong, nama PIC
    // dan Issuer tidak pernah dibutuhkan.
    const userById = search ? new Map((users || []).map(u => [String(u.id), u])) : null;

    return (issues || []).filter(item => {
        if (status === 'All' ? item.status === 'Closed' : item.status !== status) return false;
        if (scale !== 'All' && item.priority !== scale) return false;
        if (category !== 'All' && item.category !== category) return false;

        if (startMs !== null || endMs !== null) {
            const t = new Date(item.createdAt).getTime();
            if (startMs !== null && t < startMs) return false;
            if (endMs !== null && t > endMs) return false;
        }

        if (!search) return true;

        const issuer = userById.get(String(item.issuedBy));
        const issuerName = issuer ? issuer.username : (item.issuedBy ? `ID: ${item.issuedBy}` : 'Unknown');
        const pic = userById.get(String(item.picId));
        const picName = pic ? pic.username : 'Unassigned';

        return (item.caseNotification || '').toLowerCase().includes(search)
            || picName.toLowerCase().includes(search)
            || issuerName.toLowerCase().includes(search)
            || String(item.id || '').toLowerCase().includes(search);
    });
}

// -- Penahan kirim ganda ------------------------------------------------------
// Sebelumnya hanya tombol Login yang punya penahan; tujuh tombol simpan lainnya tetap
// hidup selama permintaan berjalan. Ketuk dua kali "Save Changes" di modal Update = DUA
// baris IssueHistory, dan server tidak punya kunci idempoten (issue.service.ts membuat
// tanpa syarat). Baris kembar itu muncul di linimasa PIC dan tidak bisa dihapus.
//
// Tombolnya juga diredupkan dan diberi label proses: di kiosk, tombol yang tampak tidak
// bereaksi adalah alasan utama orang mengetuk untuk kedua kalinya.
export async function kirimSekali(idTombol, teksProses, kerja) {
    const btn = document.getElementById(idTombol);
    if (btn && btn.disabled) return;          // permintaan sebelumnya masih berjalan

    const teksAsli = btn ? btn.innerText : '';
    if (btn) {
        btn.disabled = true;
        btn.innerText = teksProses || 'Processing...';
    }
    try {
        return await kerja();
    } finally {
        // Setiap aksi yang dibungkus helper ini MENULIS data issue (submit, update, priority,
        // category, due date, assignment, edit). Jadi di sinilah satu-satunya tempat yang perlu
        // menghanguskan cache -- tujuh pemanggil sekaligus, tanpa bisa terlupa satu per satu.
        // Dijalankan juga saat kerja() gagal: permintaan yang gagal di tengah tetap bisa sudah
        // mengubah sebagian data di server.
        lupakanCacheIssue();

        // finally, bukan setelah await: kalau kerja() melempar, tombol WAJIB hidup lagi
        // -- kalau tidak, satu kegagalan jaringan mengunci tombol itu sampai app dimuat ulang.
        if (btn) {
            btn.disabled = false;
            btn.innerText = teksAsli;
        }
    }
}

// -- Entri riwayat terbaru, satu lintasan ---------------------------------------
// Lima tempat sebelumnya menulis [...histories].sort(...)[0] -- menyalin SELURUH array
// lalu mengurutkannya hanya untuk mengambil satu elemen. Yang paling mahal ada di
// isEditableLastUpdate(), yang dipanggil sekali per BARIS riwayat saat merender linimasa:
// O(h^2 log h) untuk satu halaman detail, dan halaman itu dirender ulang tiap klik Next/Prev.
// Tiap perbandingan juga membuat dua objek Date.
//
// Seri waktu dipecah oleh id yang lebih besar (= dimasukkan belakangan). Array#sort di V8
// stabil, jadi sebelumnya yang menang adalah yang lebih dulu ada di array -- bergantung pada
// urutan kiriman server. Memakai id membuatnya deterministik.
export function riwayatTerbaru(histories) {
    const daftar = histories || [];
    let terbaru = null, ms = -Infinity, id = -Infinity;
    for (const h of daftar) {
        const t = new Date(h.createdAt).getTime();
        const hid = Number(h.id);
        // Perbandingan dengan NaN selalu false, jadi tanggal rusak tidak pernah menang.
        if (t > ms || (t === ms && hid > id)) { terbaru = h; ms = t; id = hid; }
    }
    // Kalau SEMUA tanggalnya tidak valid, kembalikan elemen pertama -- persis yang
    // dihasilkan sort stabil sebelumnya, supaya tidak ada pemanggil yang tiba-tiba dapat null.
    return terbaru || daftar[0] || null;
}

// Label kategori seperti yang dilihat orang di form Create Issue dan modal Change
// Category. Nilai yang DISIMPAN tetap 'Weekly', tapi yang tertulis di sana "Weekly BOD".
// Ditaruh di sini (bukan modul-lokal di issue-dashboard.js) karena layar kategori PIC dan
// tabelnya sama-sama membutuhkannya.
export const LABEL_KATEGORI = { Daily: 'Daily', Weekly: 'Weekly BOD', Midyear: 'Midyear', Annual: 'Annual' };
export const URUTAN_KATEGORI = ['Daily', 'Weekly', 'Midyear', 'Annual'];

// -- Klasifikasi tugas dari sudut pandang PIC ---------------------------------
// SATU sumber kebenaran, dipakai layar Task List DAN checkDailyUpdates().
// Sebelumnya keduanya memakai kriteria yang berbeda: tabel menampilkan tugas yang sudah
// Closed dan tugas yang user-nya cuma MANTAN PIC (involvedPicIds), sedangkan penjaga
// logout hanya menghitung `status != Closed && status != Continue && picId == saya`.
// Akibatnya daftar yang dilihat PIC bukan daftar yang benar-benar mengunci tombol Logout --
// dua puluhan baris yang tidak wajib diisi ikut mendorong tugas yang wajib ke luar layar.
export const BLOK_BELUM = 'belum';       // wajib hari ini, belum diisi -> MENGUNCI Logout
export const BLOK_SUDAH = 'sudah';       // wajib hari ini, sudah diisi
export const BLOK_TAKWAJIB = 'takwajib'; // status Continue: sengaja dilanjutkan besok
export const BLOK_ARSIP = 'arsip';       // Closed, atau user cuma mantan PIC

export function blokTugasPic(issue, userId) {
    if (!issue) return BLOK_ARSIP;

    // Bukan pemegang saat ini (hanya pernah dioper lewat), atau sudah selesai.
    if (String(issue.picId) !== String(userId)) return BLOK_ARSIP;
    if (issue.status === 'Closed') return BLOK_ARSIP;

    // "Continue" = pekerjaan sengaja dilanjutkan hari berikutnya. Tetap aktif dan tetap
    // bisa diisi, tapi TIDAK menahan Logout -- jadi bukan tunggakan.
    if (issue.status === 'Continue') return BLOK_TAKWAJIB;

    return hasUpdatedToday(issue) ? BLOK_SUDAH : BLOK_BELUM;
}

// Tugas yang menahan Logout hari ini. Dipakai penjaga, strip ringkasan, dan penanda menu.
export function tugasTertunda(issues, userId) {
    return (issues || []).filter(i => blokTugasPic(i, userId) === BLOK_BELUM);
}

// Beri browser satu frame untuk benar-benar MELUKIS perubahan terakhir sebelum memulai pekerjaan
// sinkron yang panjang (generate PDF/Excel bisa memblokir beberapa detik).
// Tanpa ini indikator "sedang menyiapkan" tidak pernah sempat tampil: ia diset lalu langsung
// tertimbun pekerjaan berat di thread yang sama, sehingga user cuma melihat app membeku tanpa
// penjelasan. requestAnimationFrame menunggu tepat SEBELUM frame berikutnya, dan setTimeout(0)
// di dalamnya menunggu sampai frame itu selesai dilukis.
// =========================================================================
// CACHE PENDEK UNTUK GET /issue?ringkas=1
// =========================================================================
// Enam tempat memanggil endpoint yang SAMA, dan beberapa dipicu berurutan oleh satu aksi user:
// membuka menu Dept Head memuat seluruh issue hanya untuk mengisi satu angka badge, lalu masuk
// ke layar Task List memuat dataset yang sama lagi. Bolak-balik antar layar mengulangnya terus.
//
// TTL sengaja pendek dan BUKAN satu-satunya pengaman: setiap aksi tulis menghanguskan cache
// lewat kirimSekali() di bawah, jadi perubahan data tidak pernah tertahan. TTL hanya membatasi
// umur data yang diubah dari perangkat LAIN.
const ISSUE_CACHE_TTL_MS = 30000;
let cacheIssue = { at: 0, data: null, inFlight: null };

// Dipanggil setiap kali ada yang menulis ke data issue. Aman dipanggil kapan saja.
export function lupakanCacheIssue() {
    cacheIssue = { at: 0, data: null, inFlight: null };
}

export function ambilIssueRingkas() {
    if (cacheIssue.data && Date.now() - cacheIssue.at < ISSUE_CACHE_TTL_MS) {
        return Promise.resolve(cacheIssue.data);
    }
    // Menyatukan pemanggil yang datang BERSAMAAN ke satu permintaan. Tanpa ini, dua layar yang
    // dibuka cepat berturut-turut tetap menembak jaringan dua kali sebelum yang pertama selesai.
    if (cacheIssue.inFlight) return cacheIssue.inFlight;

    cacheIssue.inFlight = fetch(`${API_URL}/issue?ringkas=1`, { headers: getAuthHeaders() })
        .then(res => {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        })
        .then(data => {
            cacheIssue = { at: Date.now(), data, inFlight: null };
            return data;
        })
        .catch(err => {
            // Kegagalan tidak boleh membekukan cache: percobaan berikutnya harus boleh mencoba.
            cacheIssue.inFlight = null;
            throw err;
        });
    return cacheIssue.inFlight;
}

export function beriNapasUI() {
    return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
}