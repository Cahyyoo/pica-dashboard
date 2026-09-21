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
// Logonya TIDAK PERNAH berubah selama app hidup, tapi dulu seluruh rantai ini diulang tiap kali
// user menekan Export: baca logo_aspire.png (71,6 KB) dari disk, decode, gambar ke canvas, lalu
// encode ULANG jadi PNG lewat toDataURL(). Semuanya di main thread, tepat sebelum pekerjaan berat
// membangun workbook -- menambah panjang pembekuan yang memang sudah terasa.
//
// HANYA hasil SUKSES yang disimpan. Ini bukan detail sepele: kalau kegagalan ikut di-cache,
// satu kegagalan baca sesaat akan membuat SEMUA export berikutnya turun ke fallback teks
// sampai app di-restart -- dan user tidak punya cara menebak kenapa logonya hilang.
const cacheLogo = new Map();

export function getBase64Image(imgPath) {
    const tersimpan = cacheLogo.get(imgPath);
    if (tersimpan) return tersimpan;

    const janji = new Promise((resolve) => {
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
            cacheLogo.delete(imgPath);   // percobaan berikutnya HARUS boleh mencoba lagi
            resolve(null);
        };
        img.src = imgPath;
    });

    cacheLogo.set(imgPath, janji);
    return janji;
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
    return buatPengecekEditable(issue)(hist);
}

/**
 * Versi yang dipakai saat merender linimasa: syarat tingkat-ISSUE dihitung SEKALI, lalu
 * kembalikan closure yang cuma memeriksa hal-hal per-ENTRI.
 *
 * Kenapa perlu: isEditableLastUpdate() dipanggil sekali per baris linimasa, dan di dalamnya
 * memanggil riwayatTerbaru() yang menyisir SELURUH histories. Layar detail memuat riwayat
 * lengkap (GET /issue/:id, bukan ?ringkas=1), jadi pada issue dengan ~250 entri dan "show
 * older" dibuka itu 250 x 250 kunjungan entri plus 500 pemformatan tanggal, sinkron, sambil
 * user menunggu. Dengan pemisahan ini jadi satu sisiran saja: O(h^2) -> O(h).
 *
 * Diukur pada linimasa 250 entri (Node 22, laptop pengembang -- yang penting rasionya):
 * 63.000 kunjungan entri turun jadi 750 (84x), dan 17,71 ms jadi 0,08 ms. Pembandingnya sudah
 * memakai cache formatter di atas, jadi selisih ini murni dari hilangnya sisiran berulang.
 *
 * Yang paling sering terjadi justru gratis: untuk siapa pun yang BUKAN PIC pemilik issue
 * (semua MD, dan Dept Head yang membuka issue orang lain) fungsi ini mengembalikan
 * () => false tanpa pernah menyentuh histories sama sekali -- diukur: 0 kunjungan entri.
 *
 * Satu pengetatan yang disengaja: "hari ini" kini disampel SEKALI per render, bukan per entri.
 * Render yang kebetulan melintasi tengah malam WITA jadi konsisten untuk seluruh linimasa,
 * bukan setengah memakai hari kemarin dan setengah hari ini.
 */
export function buatPengecekEditable(issue) {
    const TOLAK = () => false;
    if (!issue) return TOLAK;

    // Tombolnya memanggil PATCH /issue/history/:historyId, yang hanya ada di backend 2.3.0.
    // Di backend lama ia harus tidak muncul sama sekali -- membiarkannya tampil berarti user
    // menekannya lalu mendapat kegagalan tanpa sebab yang bisa ia mengerti.
    if (state.backendPunyaDetail === false) return TOLAK;

    const userId = localStorage.getItem('user_id');
    if (localStorage.getItem('user_role') !== 'Dept Head') return TOLAK;
    if (String(issue.picId) !== String(userId)) return TOLAK;
    if (issue.status === 'Closed') return TOLAK;

    // Newest entry, computed rather than trusting the array order.
    const terbaru = riwayatTerbaru(issue.histories);
    if (!terbaru) return TOLAK;

    const hariIni = formatWitaDate(new Date(), 'en-CA');

    return function (hist) {
        if (!hist) return false;
        if (terbaru.id !== hist.id) return false;
        // Today, compared in WITA the same way the rest of the app does.
        if (formatWitaDate(hist.createdAt, 'en-CA') !== hariIni) return false;
        if (hist.createdById != null && String(hist.createdById) !== String(userId)) return false;
        if (PENANDA_SISTEM.some(p => String(hist.remark || '').includes(p))) return false;
        return true;
    };
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

// --- CACHE FORMATTER TANGGAL ---------------------------------------------------
// toLocaleDateString()/toLocaleString() MEMBANGUN Intl.DateTimeFormat baru tiap panggilan --
// bagian termahal dari memformat tanggal, dan di app ini dipanggil per BARIS: 2x per baris
// tabel MD (page size sampai 200), 1x per baris PIC, 2x per baris export PDF/Excel, 2x per
// entri linimasa lewat isEditableLastUpdate(), 2x per baris Login Activity plus 1x lagi di
// predikat filternya. Seluruh app cuma memakai 8 bentuk (locale + options) yang berbeda,
// jadi instance-nya dipakai ulang.
//
// Diukur: satu render tabel MD page size 200 = 400 panggilan format. 47,13 ms dengan pola lama,
// 1,18 ms dengan cache ini (~40x). Angka ini dari Node 22 di laptop pengembang, BUKAN dari
// kiosk -- yang penting rasionya; di kiosk yang lebih lambat selisih absolutnya lebih besar.
// Dan ongkos itu terbayar lagi setiap ketukan di kotak search, karena filter memicu render ulang.
//
// JEBAKANNYA, dan ini alasan lengkapiOpsi() di bawah ada: toLocaleString(l, o) BUKAN
// new Intl.DateTimeFormat(l, o). Keduanya menjalankan ToDateTimeOptions dengan argumen
// berbeda (date: required "date"/defaults "date"; datetime: required "any"/defaults "all"),
// yang MENAMBAHKAN komponen saat options tidak menyebut satu pun. Intl.DateTimeFormat dengan
// hanya { timeZone } menghasilkan TANGGAL SAJA -- jadi meneruskan options apa adanya akan
// diam-diam menghapus jam dari formatWitaDateTime(x), yang dipakai header PDF.
const cacheFormatter = new Map();

function lengkapiOpsi(jenis, options) {
    const o = { ...options };
    let perluDefault = true;
    // required "date" maupun "any" sama-sama memeriksa keempat komponen tanggal ini.
    for (const k of ['weekday', 'year', 'month', 'day']) {
        if (o[k] !== undefined) perluDefault = false;
    }
    // Komponen waktu HANYA diperiksa oleh toLocaleString (required "any"). Ini penting:
    // formatWitaDate(x, l, { hour, minute }) tetap mendapat tambahan year/month/day.
    if (jenis === 'datetime') {
        for (const k of ['dayPeriod', 'hour', 'minute', 'second', 'fractionalSecondDigits']) {
            if (o[k] !== undefined) perluDefault = false;
        }
    }
    if (perluDefault) {
        o.year = 'numeric'; o.month = 'numeric'; o.day = 'numeric';
        if (jenis === 'datetime') { o.hour = 'numeric'; o.minute = 'numeric'; o.second = 'numeric'; }
    }
    o.timeZone = WITA_TIMEZONE;   // ditaruh terakhir: memaksa WITA, sama seperti sebelumnya
    return o;
}

// Mengembalikan formatter, atau null yang artinya "pakai jalur lama untuk bentuk ini".
function ambilFormatter(jenis, locale, options) {
    // dateStyle/timeStyle punya aturan defaulting sendiri. Belum dipakai di app ini; kalau
    // suatu saat dipakai, biarkan jatuh ke jalur lama daripada menebak.
    if (options && (options.dateStyle !== undefined || options.timeStyle !== undefined)) return null;

    const kunci = jenis + '|' + locale + '|' + JSON.stringify(options);
    if (cacheFormatter.has(kunci)) return cacheFormatter.get(kunci);

    let f = null;
    try {
        f = new Intl.DateTimeFormat(locale, lengkapiOpsi(jenis, options));
        // Guard yang membuktikan dirinya sendiri: sekali per bentuk, hasil formatter baru
        // dibandingkan dengan ekspresi LAMA. Kalau replikasi defaulting di atas meleset untuk
        // bentuk apa pun, bentuk itu otomatis kembali ke jalur lama dan menulis peringatan --
        // bukan diam-diam mengubah tampilan tanggal user. Ongkosnya ~8 panggilan legacy ekstra
        // seumur proses. Dua tanggal uji: satu tanggal satu digit, satu dua digit, supaya
        // perbedaan padding ikut ketahuan.
        for (const uji of [new Date(Date.UTC(2024, 0, 5, 6, 7, 8)), new Date(Date.UTC(2024, 10, 25, 18, 47, 8))]) {
            const lama = jenis === 'datetime'
                ? uji.toLocaleString(locale, { ...options, timeZone: WITA_TIMEZONE })
                : uji.toLocaleDateString(locale, { ...options, timeZone: WITA_TIMEZONE });
            if (f.format(uji) !== lama) {
                console.warn(`Cache formatter dimatikan untuk ${kunci}: "${f.format(uji)}" != "${lama}"`);
                f = null;
                break;
            }
        }
    } catch (e) {
        console.warn('Gagal membuat formatter untuk ' + kunci, e);
        f = null;
    }
    cacheFormatter.set(kunci, f);
    return f;
}

export function formatWitaDate(dateInput, locale = 'en-GB', options = {}) {
    if (!dateInput) return '-';
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '-';
    const f = ambilFormatter('date', locale, options);
    if (f) return f.format(d);
    return d.toLocaleDateString(locale, { ...options, timeZone: WITA_TIMEZONE });
}

export function formatWitaDateTime(dateInput, locale = 'en-GB', options = {}) {
    if (!dateInput) return '-';
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '-';
    const f = ambilFormatter('datetime', locale, options);
    if (f) return f.format(d);
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
// Hanya MENGAMBIL isinya, tanpa menyuntikkan. Menggantikan loadComponent() yang dulu melakukan
// keduanya sekaligus, sehingga app.js terpaksa menunggu satu berkas selesai sebelum memulai
// berkas berikutnya. Dipisah supaya app.js bisa mengambil keempat fragment BERSAMAAN lalu
// menyuntikkannya berurutan -- ketiga fragment pertama menumpuk ke container yang sama, jadi
// urutan penyuntikan menentukan urutan DOM dan tidak boleh diacak.
//
// Mengembalikan '' saat gagal, bukan melempar: perilaku lama menelan kegagalan per berkas
// supaya satu fragment yang hilang tidak menggagalkan seluruh boot. Itu dipertahankan.
export async function ambilKomponen(filePath) {
    try {
        const response = await fetch(filePath);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.text();
    } catch (error) {
        console.error(`Failed to load component ${filePath}:`, error);
        return '';
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
    // Dihanguskan DUA KALI, sebelum dan sesudah -- dan yang "sebelum" ini bukan kelebihan.
    // kerja() me-reload dashboard DI DALAM dirinya sendiri (lihat loadDashboardMD/PIC yang
    // dipanggil tepat setelah response.ok di issue-action.js). Kalau cache baru dihanguskan di
    // finally, reload itu sudah terlanjur dilayani cache PRA-tulis: PIC menekan Save, kembali ke
    // Task List, dan masih melihat "Not Updated" untuk task yang baru saja ia isi -- sampai ia
    // menekan Refresh. Menghanguskan lebih dulu membuat reload di dalam kerja() menembak jaringan.
    lupakanCacheIssue();
    try {
        return await kerja();
    } finally {
        // Setiap aksi yang dibungkus helper ini MENULIS data issue (submit, update, priority,
        // category, due date, assignment, edit). Jadi helper inilah tempat menghanguskan cache --
        // tujuh pemanggil sekaligus, tanpa bisa terlupa satu per satu.
        //
        // Penghangusan KEDUA (yang pertama ada tepat sebelum try di atas). Tetap diperlukan:
        // selama kerja() berjalan, reload di dalamnya sudah mengisi ulang cache dengan data
        // pasca-tulis; kalau kerja() lalu GAGAL di tengah, server bisa sudah berubah sebagian dan
        // isi cache itu tidak lagi bisa dipercaya. Dijalankan di finally supaya jalur gagal ikut.
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
// -- Tanggal -> milidetik, tanpa membuat objek Date kalau tidak perlu -----------
// Backend selalu mengirim string ISO, dan untuk string ISO Date.parse() menghasilkan angka
// yang SAMA PERSIS dengan new Date(v).getTime() -- menurut definisi, keduanya menjalankan
// algoritma parse yang sama. Bedanya Date.parse() tidak mengalokasikan objek Date yang
// langsung dibuang. Nilai non-string (mis. objek Date) tetap lewat jalur lama.
export function msDari(v) {
    return typeof v === 'string' ? Date.parse(v) : new Date(v).getTime();
}

// -- Cache kunci urut, berbasis identitas objek --------------------------------
// state.globalIssues memegang objek yang SAMA selama satu jendela cache issue, dan tiga dari
// lima pengurutan di issue-dashboard.js dijalankan ulang tiap ketukan keyboard yang ter-debounce.
// Tanpa cache, satu pengurutan n=1.000 mem-parse tanggal ~2*n*log n kali (~20.000), dan itu
// terulang tiap ketukan. Dengan WeakMap, ketukan kedua dan seterusnya nol parsing.
//
// Diukur (n=1.000, objek yang sama diurutkan berulang seperti saat mengetik di kotak search,
// Node 22 di laptop pengembang): 5,03 ms per pengurutan jadi 0,68 ms (~7x).
//
// INVARIAN yang disandari: tidak ada satu pun tempat di app ini yang mengubah createdAt pada
// objek issue yang sudah ada. Pemuatan ulang selalu menghasilkan objek BARU dari JSON.parse(),
// jadi entri lama otomatis terkoleksi (karena itu WeakMap, bukan Map). Kalau suatu saat ada
// kode yang memutasi createdAt di tempat, cache ini WAJIB dibuang.
const cacheMsDibuat = new WeakMap();

export function msDibuat(issue) {
    let ms = cacheMsDibuat.get(issue);
    if (ms === undefined) {
        ms = msDari(issue.createdAt);
        cacheMsDibuat.set(issue, ms);
    }
    return ms;
}

// Urutan tampil status di semua tabel: yang paling butuh perhatian di atas, yang sudah
// selesai di bawah. "Continue" ditaruh di antara Progress dan Closed -- masih aktif, tapi
// sengaja diparkir untuk dilanjutkan besok.
//
// Sebelumnya map ini disalin PERSIS SAMA di 5 fungsi berbeda di issue-dashboard.js. Cukup satu
// salinan terlewat saat status baru ditambah, satu tabel akan salah urut tanpa ketahuan.
// Sekarang map DAN pembandingnya sama-sama tinggal satu salinan, di sini.
export const STATUS_ORDER = { 'Open': 1, 'Progress': 2, 'Continue': 3, 'Closed': 4 };
// Status di luar daftar (mis. sisa import lama) ditaruh paling akhir. Angkanya HARUS di
// atas bobot Closed, kalau tidak status tak dikenal akan seri dengan Closed.
export const STATUS_ORDER_LAINNYA = 5;

// Mengurutkan DI TEMPAT (kelima pemanggil memang bekerja pada array hasil filter/map yang
// baru dibuat) lalu mengembalikan array yang sama supaya enak dirantai.
//
// Bentuk pengurangannya sengaja dipertahankan PERSIS seperti kelima salinan lama, dan itu
// bukan gaya penulisan: kalau createdAt rusak, msDibuat() menghasilkan NaN dan pengurangannya
// jadi NaN. Menurut spec, SortCompare memperlakukan hasil NaN sebagai +0, dan Array#sort di
// V8 stabil -- jadi baris dengan tanggal rusak MEMPERTAHANKAN urutan masuknya. Transformasi
// Schwartzian dengan tiebreak indeks akan MENGUBAH perilaku itu. Jangan.
export function urutkanIssueStatusTanggal(daftar) {
    return daftar.sort((a, b) => {
        const bobotA = STATUS_ORDER[a.status] || STATUS_ORDER_LAINNYA;
        const bobotB = STATUS_ORDER[b.status] || STATUS_ORDER_LAINNYA;
        if (bobotA !== bobotB) return bobotA - bobotB;
        return msDibuat(b) - msDibuat(a);   // terbaru di atas
    });
}

export function riwayatTerbaru(histories) {
    const daftar = histories || [];
    let terbaru = null, ms = -Infinity, id = -Infinity;
    for (const h of daftar) {
        const t = msDari(h.createdAt);
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

// =========================================================================
// CACHE PENDEK UNTUK GET /auth/users
// =========================================================================
// Pola dan alasannya sama persis dengan cache issue di atas, untuk endpoint yang justru lebih
// sering diketuk: tujuh tempat memanggilnya, dan window.showView() memicu pemuatan data di
// hampir SETIAP perpindahan layar. Akibatnya bolak-balik Task List -> detail -> kembali
// mengunduh SELURUH tabel user tiap putaran, padahal isinya nyaris tak pernah berubah.
//
// TTL 60 detik, lebih panjang dari cache issue, karena taruhannya lebih ringan: data ini cuma
// dipakai untuk menampilkan nama (picName/issuerName) dan dicari lewat kotak search. Yang
// tertunda paling lama satu TTL hanyalah user yang di-rename/dihapus dari PERANGKAT LAIN.
// Layar Admin sengaja DIKECUALIKAN -- lihat loadAdminUsers() di auth.js, yang selalu
// menghanguskan cache lebih dulu supaya tabel yang dipakai mengelola user tetap otoritatif.
//
// Permintaannya sengaja dipertahankan apa adanya: TANPA auth header, sama seperti kedua
// pemanggil aslinya. Menambahkannya adalah perubahan kontrak dengan backend, bukan optimasi.
const USER_CACHE_TTL_MS = 60000;
let cacheUser = { at: 0, data: null, inFlight: null };

export function lupakanCacheUser() {
    cacheUser = { at: 0, data: null, inFlight: null };
}

export function ambilUsers() {
    if (cacheUser.data && Date.now() - cacheUser.at < USER_CACHE_TTL_MS) {
        return Promise.resolve(cacheUser.data);
    }
    if (cacheUser.inFlight) return cacheUser.inFlight;

    cacheUser.inFlight = fetch(`${API_URL}/auth/users`)
        .then(res => {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        })
        .then(data => {
            cacheUser = { at: Date.now(), data, inFlight: null };
            return data;
        })
        .catch(err => {
            // Sama seperti cache issue: kegagalan tidak boleh membekukan cache.
            cacheUser.inFlight = null;
            throw err;
        });
    return cacheUser.inFlight;
}

export function beriNapasUI() {
    return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
}