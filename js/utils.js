import { API_URL, getAuthHeaders } from './config.js';

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
export const WITA_TIMEZONE = 'Asia/Makassar';

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
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
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
    return `<span class="badge badge-prio">${status}</span>`;
}

// --- PENANDA APAKAH ISSUE SUDAH DIUPDATE OLEH PIC HARI INI ---
export function hasUpdatedToday(issue) {
    if (!issue.histories || issue.histories.length === 0) return false;

    const todayDate = new Date().toDateString();
    const todayHistories = issue.histories.filter(hist => new Date(hist.createdAt).toDateString() === todayDate);
    if (todayHistories.length === 0) return false;

    todayHistories.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const latestTodayAction = todayHistories[0];

    // Forward ke PIC lain tidak dihitung sebagai progress update
    if (latestTodayAction.remark && latestTodayAction.remark.includes('[🔄 Task Forwarded to:')) return false;

    return true;
}

export function getDailyUpdateBadge(issue) {
    if (issue.status === 'Closed') return '<span style="color:#9ca3af; font-size:12px;">-</span>';

    return hasUpdatedToday(issue)
        ? '<span class="badge badge-updated">✅ Updated Today</span>'
        : '<span class="badge badge-not-updated">⏳ Not Updated Yet</span>';
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