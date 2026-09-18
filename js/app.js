import { showView, showCustomAlert, closeCustomAlert, navigateToRole, loadComponent, showCustomConfirm, closeCustomConfirm } from './utils.js';
import { handleLogin, handleLogout, handleExitApp, loadAdminUsers, submitNewUser, deleteUser, openEditUserModal, closeEditUserModal, submitEditUser, loadLoginLogs, filterLoginLogs, filterLoginLogsDebounced, refreshLoginLogs, changeLoginLogsDate, changeLoginLogsPage, changeLoginLogsPageSize, trackAppOpen, isGuestLockedNow } from './auth.js';
import {
    loadDepartments, submitIssue, loadDashboardMD, loadDashboardPIC,
    openDetailView, backFromDetail, openUpdateFromDetail, closeUpdateModal, requestCloseUpdateModal, openEditUpdateModal,
    submitUpdate, openPriorityModal, closePriorityModal, submitPriority, refreshDashboardMD, refreshDashboardPIC, applyFilterMD, applyFilterMDDebounced, filterUserHistoryDebounced, filterPICHistoryDebounced, changeMDPage, changeMDPageSize, filterUserHistory, filterPICHistory, togglePicSection, muatKategoriPic, bukaKategoriPic, openUserHistory, refreshUserHistory, exportSingleIssueToPDF, exportFilteredIssuesToPDF,
    openDueDateModal, closeDueDateModal, submitDueDate, checkDailyUpdates, ringkasanTertunda, perbaruiBadgeMenuPic, openAttachmentModal, closeAttachmentModal, updateFileNameDisplay, openMOMModal, submitMOMExport, closeMOMModal, loadMOMArchives, viewMOMDetail, refreshMOMArchives, closeMOMDetail, downloadMOMArchive,
    openEditAssignmentModal, closeEditAssignmentModal, submitEditAssignment,
    openCategoryModal, closeCategoryModal, submitCategory,
    openEditIssueModal, closeEditIssueModal, submitEditIssue, confirmDeleteIssue,
    toggleEvidenceHint
} from './issues.js';
import {
    loadAdminDepartments, submitNewDepartment, deleteDepartment,
    openEditDeptModal, closeEditDeptModal, submitEditDepartment
} from './departements.js';
import {
    openImportModal, closeImportModal, downloadImportTemplate, handleImportFileSelect, submitImportRows
} from './issue-import.js';

// 1. Daftarkan fungsi ke objek window agar bisa dieksekusi atribut onclick="" di HTML
window.showView = (viewId) => {
    showView(viewId);
    if (viewId === 'view-md') loadDashboardMD();
    else if (viewId === 'view-pic-update') loadDashboardPIC();
    // Layar kategori PIC: mengambil data sekali, lalu tabelnya memakai ulang data itu.
    else if (viewId === 'view-pic-category') muatKategoriPic();
    else if (viewId === 'view-admin') loadAdminUsers();
    else if (viewId === 'view-manage-dept') loadAdminDepartments();
    else if (viewId === 'view-mom-archive') loadMOMArchives();
    else if (viewId === 'view-login-logs') loadLoginLogs();
    // Menu PIC: segarkan penanda tunggakan di tombol "Update Task List".
    else if (viewId === 'view-dept-head') perbaruiBadgeMenuPic();
};


window.backToMenu = () => {
    const role = localStorage.getItem('user_role');
    navigateToRole(role);
    perbaruiBadgeMenuPic();   // aman dipanggil untuk peran apa pun; ia memeriksa sendiri
};

window.handleLogin = handleLogin;
window.handleLogout = handleLogout;
window.handleExitApp = handleExitApp;
window.submitNewUser = submitNewUser;
window.deleteUser = deleteUser;
window.openEditUserModal = openEditUserModal;
window.closeEditUserModal = closeEditUserModal;
window.submitEditUser = submitEditUser;
window.filterLoginLogs = filterLoginLogs;
window.filterLoginLogsDebounced = filterLoginLogsDebounced;
window.refreshLoginLogs = refreshLoginLogs;
window.changeLoginLogsDate = changeLoginLogsDate;
window.changeLoginLogsPage = changeLoginLogsPage;
window.changeLoginLogsPageSize = changeLoginLogsPageSize;

window.submitIssue = submitIssue;
window.openUserHistory = openUserHistory;
window.refreshUserHistory = refreshUserHistory;
window.openDetailView = openDetailView;
window.backFromDetail = backFromDetail;
window.openUpdateFromDetail = openUpdateFromDetail;
window.closeUpdateModal = closeUpdateModal;
window.requestCloseUpdateModal = requestCloseUpdateModal;
window.openEditUpdateModal = openEditUpdateModal;
window.toggleEvidenceHint = toggleEvidenceHint;
window.submitUpdate = submitUpdate;
window.openPriorityModal = openPriorityModal;
window.closePriorityModal = closePriorityModal;
window.submitPriority = submitPriority;
window.openCategoryModal = openCategoryModal;
window.closeCategoryModal = closeCategoryModal;
window.submitCategory = submitCategory;
window.openEditIssueModal = openEditIssueModal;
window.closeEditIssueModal = closeEditIssueModal;
window.submitEditIssue = submitEditIssue;
window.confirmDeleteIssue = confirmDeleteIssue;

window.submitNewDepartment = submitNewDepartment;
window.openEditDeptModal = openEditDeptModal;
window.closeEditDeptModal = closeEditDeptModal;
window.submitEditDepartment = submitEditDepartment;
window.deleteDepartment = deleteDepartment;

window.showCustomAlert = showCustomAlert;
window.closeCustomAlert = closeCustomAlert;
window.closeCustomConfirm = closeCustomConfirm;

window.refreshDashboardPIC = refreshDashboardPIC;
// Judul blok di Task List PIC dapat diklik untuk melipat/membuka bloknya.
window.togglePicSection = togglePicSection;
// Kartu kategori di layar view-pic-category memanggil ini lewat onclick.
window.bukaKategoriPic = bukaKategoriPic;
window.refreshDashboardMD = refreshDashboardMD;
window.applyFilterMD = applyFilterMD;
window.applyFilterMDDebounced = applyFilterMDDebounced;
window.changeMDPage = changeMDPage;
window.changeMDPageSize = changeMDPageSize;
window.filterUserHistory = filterUserHistory;
window.filterUserHistoryDebounced = filterUserHistoryDebounced;
window.filterPICHistory = filterPICHistory;
window.filterPICHistoryDebounced = filterPICHistoryDebounced;

window.exportSingleIssueToPDF = exportSingleIssueToPDF;
window.exportFilteredIssuesToPDF = exportFilteredIssuesToPDF;

window.openDueDateModal = openDueDateModal;
window.closeDueDateModal = closeDueDateModal;
window.submitDueDate = submitDueDate;

window.openEditAssignmentModal = openEditAssignmentModal;
window.closeEditAssignmentModal = closeEditAssignmentModal;
window.submitEditAssignment = submitEditAssignment;

window.openImportModal = openImportModal;
window.closeImportModal = closeImportModal;
window.downloadImportTemplate = downloadImportTemplate;
window.handleImportFileSelect = handleImportFileSelect;
window.submitImportRows = submitImportRows;

window.openAttachmentModal = openAttachmentModal;
window.closeAttachmentModal = closeAttachmentModal;
window.updateFileNameDisplay = updateFileNameDisplay;

window.openMOMModal = openMOMModal;
window.closeMOMModal = closeMOMModal;
window.submitMOMExport = submitMOMExport;

window.loadMOMArchives = loadMOMArchives;
window.refreshMOMArchives = refreshMOMArchives;
window.viewMOMDetail = viewMOMDetail;
window.closeMOMDetail = closeMOMDetail;
window.downloadMOMArchive = downloadMOMArchive;

// Tampilkan/sembunyikan banner "Guest Network Mode" -- dipakai baik saat load awal maupun
// saat status lock berubah DI TENGAH SESI (lewat event 'guest-lock-status-changed' dari main.js).
const GUEST_LOCK_BANNER_ID = 'guest-lock-banner';
function updateGuestLockBanner(locked) {
    const existing = document.getElementById(GUEST_LOCK_BANNER_ID);
    if (locked) {
        if (existing) return; // sudah tampil, tidak perlu diulang
        document.body.insertAdjacentHTML('afterbegin', `
            <div id="${GUEST_LOCK_BANNER_ID}" style="position:sticky; top:0; z-index:9999; background:#fef3c7; color:#92400e; padding:8px; text-align:center; font-size:13px; font-weight:600;">
                ⚠️ Guest Network Mode — No backend connection. Exit App and Logout are disabled until connected to the office network.
            </div>
        `);
    } else if (existing) {
        existing.remove();
    }
}

// 2. Jalankan logika awal saat aplikasi dibuka
document.addEventListener('DOMContentLoaded', async () => {
    
    // TAHAP A: INJEKSI HTML (WAJIB DITUNGGU DENGAN AWAIT)
    // Jangan jalankan kode apapun sebelum struktur DOM (HTML) ini selesai dibentuk
    await loadComponent('app-content', './views/auth.html');
    await loadComponent('app-content', './views/menus.html');
    await loadComponent('app-content', './views/dashboards.html');
    await loadComponent('modals-container', './views/modals.html');

    // TAHAP B: JALANKAN LOGIKA DATA SETELAH HTML SIAP
    // Karena HTML sudah terbentuk, JS kini bisa menemukan elemen seperti 'issue-dept'
    loadDepartments();

    // Mode Guest terkunci (SSID SPRM-GUEST, backend tak terjangkau): tampilkan banner
    // peringatan persisten. Ini murni indikator visual -- penegakan sebenarnya (Exit App
    // & Logout ditolak) ada di js/auth.js dan main.js, jadi kegagalan cek ini tidak fatal.
    // Reaktif terhadap perubahan status DI TENGAH SESI (lihat listener 'guest-lock-status-changed'
    // di bawah) -- bukan cuma dicek sekali saat startup, karena jaringan bisa berpindah kapan saja.
    isGuestLockedNow().then(locked => updateGuestLockBanner(locked));

    const savedToken = localStorage.getItem('access_token');
    const savedRole = localStorage.getItem('user_role');
    
    // TAHAP C: ROUTING LAYAR AWAL
    if (savedToken && savedRole) {
        
        // --- PERBAIKAN: Tampilkan Username beserta ID-nya di Form ---
        const savedUsername = localStorage.getItem('username');
        const savedUserId = localStorage.getItem('user_id');
        
        if (document.getElementById('issue-issuer')) {
            // Akan tampil seperti: user3 (ID: 2)
            document.getElementById('issue-issuer').value = `${savedUsername} (ID: ${savedUserId})`;
        }
        // -------------------------------------------------------------

        // App dibuka lewat sesi tersimpan (tidak perlu login ulang) — tetap dicatat sebagai
        // "app dibuka" supaya laporan Login Activity mencerminkan pemakaian app yang sebenarnya.
        trackAppOpen('auto-resume');

        navigateToRole(savedRole);
        perbaruiBadgeMenuPic();
    } else {
        showView('view-login');
    }
});

// =========================================================
// BACKGROUND SENSOR: PEMANTAU JAM 10:00 & VALIDASI KONEKSI
// =========================================================
function startBackgroundMonitor() {
    setInterval(async () => {
        const role = localStorage.getItem('user_role');
        if (role !== 'Dept Head') return; 

        const now = new Date();
        const todayStr = now.toDateString();
        const lastAlarmDate = localStorage.getItem('last_kiosk_alarm');

        if (now.getHours() >= 10 && lastAlarmDate !== todayStr) {
            
            // =========================================================
            // VALIDASI 1: CEK KONEKSI (APAKAH TERHUBUNG KE WIFI KANTOR?)
            // =========================================================
            if (!navigator.onLine) return; // Batal jika laptop offline / tidak ada internet

            try {
                // Trik: Jika API_URL menggunakan IP Lokal kantor (misal 192.168.1.xxx),
                // request ini akan otomatis gagal (masuk ke catch) saat user di rumah.
                const pingRes = await fetch(`${API_URL}/department`, { method: 'GET' });
                if (!pingRes.ok) return; 
            } catch (err) {
                // Jika gagal terhubung ke server lokal, asumsikan user berada di luar kantor
                console.log("User is outside the office network. Alarm canceled.");
                return; // Berhenti di sini, layar tidak akan dikunci
            }

            // =========================================================
            // VALIDASI 2: CEK PROGRESS TUGAS (JIKA WIFI KANTOR AKTIF)
            // =========================================================
            const { boleh, tertunda } = await checkDailyUpdates();

            if (!boleh) {
                // Tidak ada IPC di sini: kanal "paksa-buka-layar" tak pernah punya
                // ipcMain.on mana pun, jadi pengirimannya selalu tanpa efek.
                // Jendela sudah dipaksa ke depan oleh bringWindowToFront() di main.js.
                showCustomAlert(
                    "System Alert",
                    `It's past 10:00 AM and ${tertunda.length} task(s) have not been updated today:

`
                    + ringkasanTertunda(tertunda)
                    + `

Open Update Task List — the category cards show which ones, and inside each list they are at the top under "NOT UPDATED TODAY".`
                );
                
                localStorage.setItem('last_kiosk_alarm', todayStr);
            } else {
                localStorage.setItem('last_kiosk_alarm', todayStr);
            }
        }
    }, 60000); // Mengecek setiap 1 Menit
}

startBackgroundMonitor();

// =========================================================
// FITUR AUTORUN: LISTENER UNTUK WAKE UP DARI SLEEP
// =========================================================
try {
    const { ipcRenderer } = window.require('electron');

    ipcRenderer.on('laptop-woke-up', () => {
        console.log("Sinyal Wake-Up diterima! Menyegarkan data otomatis...");
        
        // 1. Cek layar mana yang sedang aktif / terbuka saat ini.
        // Visibilitas layar digerakkan KELAS (showView/navigateToRole memakai
        // classList.add('active'); .screen{display:none} + .active{display:flex}),
        // bukan inline style. Selektor lama mencari [style*="display: block"] sehingga
        // TIDAK PERNAH cocok -- seluruh switch di bawah tak pernah tereksekusi dan
        // kiosk yang bangun pagi menampilkan data kemarin sampai ditekan Refresh.
        const activeScreen = document.querySelector('.screen.active');
        
        if (!activeScreen) return;

        // 2. Refresh data sesuai dengan layar yang sedang ditatap pengguna
        switch (activeScreen.id) {
            case 'view-mom-archive':
                if (window.refreshMOMArchives) window.refreshMOMArchives();
                break;
            case 'view-md':
                if (window.refreshDashboardMD) window.refreshDashboardMD();
                break;
            case 'view-pic-update':
                if (window.refreshDashboardPIC) window.refreshDashboardPIC();
                break;
            case 'view-user-history':
                if (window.refreshUserHistory) window.refreshUserHistory();
                break;
            default:
                // Layar lain tidak perlu auto-refresh (misal: menu utama)
                break;
        }
    });
} catch (error) {
    console.warn("Sensor Wake-Up hanya berjalan di environment Electron.");
}

// =========================================================
// FITUR MODE GUEST TERKUNCI: REAKSI TERHADAP PERUBAHAN JARINGAN DI TENGAH SESI
// (bukan cuma dicek sekali saat startup -- lihat startRuntimeNetworkMonitor() di main.js)
// =========================================================
try {
    const { ipcRenderer } = window.require('electron');

    ipcRenderer.on('guest-lock-status-changed', (event, locked) => {
        updateGuestLockBanner(locked);
        if (locked) {
            showCustomAlert(
                "Locked",
                "WiFi switched to Guest network — no backend access. Exit App and Logout are now disabled."
            );
        } else {
            showCustomAlert(
                "Unlocked",
                "Backend connection restored — Exit App and Logout are enabled again."
            );
        }
    });
} catch (error) {
    console.warn("Sensor Guest Lock hanya berjalan di environment Electron.");
}

// =========================================================
// FITUR AUTO-UPDATER: PENDENGAR SINYAL DARI MAIN.JS
// =========================================================
try {
    const { ipcRenderer } = window.require('electron');

    // 1. Munculkan layar gelap saat download dimulai
    ipcRenderer.on('update-mulai-download', () => {
        document.getElementById('update-overlay').style.display = 'flex';
    });

    // 2. Gerakkan progress bar hijau
    ipcRenderer.on('update-progress-berjalan', (event, persentase) => {
        document.getElementById('progress-bar').style.width = persentase + '%';
        document.getElementById('progress-text').innerText = persentase + '%';
    });

    // 3. Ubah teks dan munculkan tombol saat selesai
    ipcRenderer.on('update-siap-dipasang', (event, version) => {
        document.getElementById('update-title').innerText = "Download Complete!";
        document.getElementById('progress-text').innerText = `Version ${version} is ready to install.`;
        
        const btnRestart = document.getElementById('btn-restart-update');
        btnRestart.style.display = 'block';

        // 4. Kirim perintah maut untuk menutup aplikasi jika tombol diklik!
        // onclick (bukan addEventListener): handler ini didaftarkan DI DALAM callback IPC,
        // dan callback itu bisa menyala lebih dari sekali per sesi karena
        // autoUpdater.checkForUpdates() diulang tiap 4 jam (main.js). Dengan
        // addEventListener, dua update dalam satu sesi = dua listener = perintah
        // 'eksekusi-update-sekarang' terkirim dua kali. Penetapan onclick menimpa, bukan menumpuk.
        btnRestart.onclick = () => {
            btnRestart.innerText = "Installing...";
            btnRestart.disabled = true;
            ipcRenderer.send('eksekusi-update-sekarang'); 
        };
    });

} catch (error) {
    console.warn("Fitur IPC Auto-Updater hanya berjalan di dalam Electron.");
}

// Escape closes the Update modal. It is the only modal that can hold ten typed points,
// so it asks before discarding them; the confirm dialog stacks on top and must close
// first. Registered once for the lifetime of the app, not per modal open. Other modals
// are deliberately left alone - each has its own reset rules.
document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const confirmBox = document.getElementById('custom-confirm');
    if (confirmBox && confirmBox.classList.contains('show')) return closeCustomConfirm();
    const updateBox = document.getElementById('modal-update');
    if (updateBox && updateBox.classList.contains('show')) requestCloseUpdateModal();
});

// Holding Shift + P + I + C + A + S together reveals or hides the menu bar. Alt no longer
// does -- see keyguard.js in the project root.
//
// A held chord, not a typed sequence: this is what the user asked for. Worth knowing that
// laptop keyboards use a membrane matrix that cannot always report five letters at once
// (ghosting), so this may register on one unit and not another. Shift does not count towards
// that limit (modifiers sit on their own lines) and P-I-C-A-S are spread across the board,
// which helps. If a unit ever fails to register the chord, that is its keyboard matrix,
// not this code -- a shorter combination is the only fix.
//
// Lives in the renderer because only the renderer knows what has focus. A PIC holding those
// letters down in a remark box must never pop the menu bar, and the main process cannot tell
// the difference.
const MENU_BAR_CHORD = ['KeyP', 'KeyI', 'KeyC', 'KeyA', 'KeyS'];
const menuBarHeld = new Set();
let menuBarChordFired = false;

function isTypingTarget(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag !== 'INPUT') return false;
    const type = String(el.type || 'text').toLowerCase();
    return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image'].includes(type);
}

function toggleMenuBarViaMain() {
    try {
        window.require('electron').ipcRenderer.send('pica-toggle-menu-bar');
    } catch (e) {
        // Not running inside Electron (verification harness); nothing to toggle.
    }
}

// Capture phase so no screen-level handler can swallow it first. State is one Set of at most
// five entries and one boolean -- no timer, no polling, no allocation per keystroke.
document.addEventListener('keydown', (event) => {
    // Typing in a field clears the chord outright: someone writing a remark that happens to
    // contain these letters must never trip it.
    if (isTypingTarget(event.target)) { menuBarHeld.clear(); menuBarChordFired = false; return; }

    // event.code, not event.key: with CapsLock on, Shift+P reports a lowercase 'p'.
    if (MENU_BAR_CHORD.includes(event.code)) menuBarHeld.add(event.code);

    if (menuBarChordFired) return;                       // already fired while still held down
    if (!event.shiftKey) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    // Press order does not matter -- all five simply have to be down at the same moment.
    if (!MENU_BAR_CHORD.every((code) => menuBarHeld.has(code))) return;

    menuBarChordFired = true;
    toggleMenuBarViaMain();
}, true);

document.addEventListener('keyup', (event) => {
    if (!MENU_BAR_CHORD.includes(event.code)) return;
    menuBarHeld.delete(event.code);
    // Rearm as soon as the chord is no longer complete. Auto-repeat sends keydown without
    // keyup, so holding it down still toggles once instead of flickering -- but a key that
    // never reports its keyup cannot lock the shortcut out either.
    menuBarChordFired = false;
}, true);

// Keys released while the window is not focused never send keyup, which would leave them
// stuck in the Set and let a later single keypress complete a phantom chord.
window.addEventListener('blur', () => { menuBarHeld.clear(); menuBarChordFired = false; });
document.addEventListener('visibilitychange', () => {
    if (document.hidden) { menuBarHeld.clear(); menuBarChordFired = false; }
});