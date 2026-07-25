import { showView, showCustomAlert, closeCustomAlert, navigateToRole, loadComponent, showCustomConfirm, closeCustomConfirm } from './utils.js';
import { handleLogin, handleLogout, handleExitApp, loadAdminUsers, submitNewUser, deleteUser, openEditUserModal, closeEditUserModal, submitEditUser } from './auth.js';
import {
    loadDepartments, submitIssue, loadDashboardMD, loadDashboardPIC,
    openDetailView, backFromDetail, openUpdateFromDetail, closeUpdateModal,
    submitUpdate, openPriorityModal, closePriorityModal, submitPriority, refreshDashboardMD, refreshDashboardPIC, applyFilterMD, changeMDPage, changeMDPageSize, filterUserHistory, filterPICHistory, openUserHistory, refreshUserHistory, exportSingleIssueToPDF, exportFilteredIssuesToPDF,
    openDueDateModal, closeDueDateModal, submitDueDate, checkDailyUpdates, openAttachmentModal, closeAttachmentModal, updateFileNameDisplay, openMOMModal, submitMOMExport, closeMOMModal, loadMOMArchives, viewMOMDetail, refreshMOMArchives, closeMOMDetail, downloadMOMArchive,
    openEditAssignmentModal, closeEditAssignmentModal, submitEditAssignment,
    openCategoryModal, closeCategoryModal, submitCategory
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
    else if (viewId === 'view-admin') loadAdminUsers();
    else if (viewId === 'view-manage-dept') loadAdminDepartments();
    else if (viewId === 'view-mom-archive') loadMOMArchives();
};


window.backToMenu = () => {
    const role = localStorage.getItem('user_role');
    navigateToRole(role);
};

window.handleLogin = handleLogin;
window.handleLogout = handleLogout;
window.handleExitApp = handleExitApp;
window.submitNewUser = submitNewUser;
window.deleteUser = deleteUser;
window.openEditUserModal = openEditUserModal;
window.closeEditUserModal = closeEditUserModal;
window.submitEditUser = submitEditUser;

window.submitIssue = submitIssue;
window.openUserHistory = openUserHistory;
window.refreshUserHistory = refreshUserHistory;
window.openDetailView = openDetailView;
window.backFromDetail = backFromDetail;
window.openUpdateFromDetail = openUpdateFromDetail;
window.closeUpdateModal = closeUpdateModal;
window.submitUpdate = submitUpdate;
window.openPriorityModal = openPriorityModal;
window.closePriorityModal = closePriorityModal;
window.submitPriority = submitPriority;
window.openCategoryModal = openCategoryModal;
window.closeCategoryModal = closeCategoryModal;
window.submitCategory = submitCategory;

window.submitNewDepartment = submitNewDepartment;
window.openEditDeptModal = openEditDeptModal;
window.closeEditDeptModal = closeEditDeptModal;
window.submitEditDepartment = submitEditDepartment;
window.deleteDepartment = deleteDepartment;

window.showCustomAlert = showCustomAlert;
window.closeCustomAlert = closeCustomAlert;
window.closeCustomConfirm = closeCustomConfirm;

window.refreshDashboardPIC = refreshDashboardPIC;
window.refreshDashboardMD = refreshDashboardMD;
window.applyFilterMD = applyFilterMD;
window.changeMDPage = changeMDPage;
window.changeMDPageSize = changeMDPageSize;
window.filterUserHistory = filterUserHistory;
window.filterPICHistory = filterPICHistory;

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

        navigateToRole(savedRole);
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
            const isAllUpdated = await checkDailyUpdates();
            
            if (!isAllUpdated) {
                try {
                    const { ipcRenderer } = window.require('electron');
                    ipcRenderer.send('paksa-buka-layar');
                } catch (e) {
                    console.log("Not running in Electron environment");
                }
                
                // Alert sudah diubah ke bahasa Inggris
                showCustomAlert(
                    "System Alert", 
                    "It's past 10:00 AM! You have not reported the progress (Update Action) for your active PICA today. Please complete it immediately."
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
        
        // 1. Cek layar mana yang sedang aktif / terbuka saat ini
        const activeScreen = document.querySelector('.screen[style*="display: block"]') 
                          || document.querySelector('.screen[style*="display: flex"]');
        
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
        document.getElementById('update-title').innerText = "Unduhan Selesai!";
        document.getElementById('progress-text').innerText = `Versi ${version} siap dipasang.`;
        
        const btnRestart = document.getElementById('btn-restart-update');
        btnRestart.style.display = 'block';
        
        // 4. Kirim perintah maut untuk menutup aplikasi jika tombol diklik!
        btnRestart.addEventListener('click', () => {
            btnRestart.innerText = "Mengeksekusi...";
            btnRestart.disabled = true;
            ipcRenderer.send('eksekusi-update-sekarang'); 
        });
    });

} catch (error) {
    console.warn("Fitur IPC Auto-Updater hanya berjalan di dalam Electron.");
}