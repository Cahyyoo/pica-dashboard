import { API_URL, getAuthHeaders } from './config.js';
import { showCustomAlert, navigateToRole, showCustomConfirm, formatWitaDate, formatWitaDateTime, debounce, escapeHtml } from './utils.js';
import { checkDailyUpdates, ringkasanTertunda, fetchUsersForMapping, perbaruiBadgeMenuPic } from './issues.js';
import { state } from './issue-state.js';
// -------------------------------------------

// Catat "app dibuka" — dipanggil setiap kali user benar-benar mulai memakai aplikasi,
// baik lewat login manual ('login') maupun lewat sesi tersimpan yang auto-resume tanpa
// perlu isi username/password lagi ('auto-resume'). Best-effort: tidak pernah menghalangi
// alur login/navigasi walau requestnya gagal (mis. backend sedang tidak bisa diakses).
export function trackAppOpen(source) {
    const userId = localStorage.getItem('user_id');
    if (!userId) return;

    // The token goes along so the server can identify the user itself. Until now this
    // endpoint trusted whatever userId the body claimed, which meant attendance could be
    // faked for anyone. The body still carries userId as a fallback for an expired session.
    fetch(`${API_URL}/auth/track-open`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ userId, source })
    }).catch((error) => {
        console.warn('Gagal mencatat app dibuka:', error);
    });
}

// Cek ke main process apakah app sedang berjalan dalam mode "Guest terkunci" (SSID
// SPRM-GUEST, backend tak terjangkau). Selalu dicek ulang (bukan di-cache) karena murni
// IPC lokal tanpa I/O, dan tidak pernah lock kalau bukan berjalan di dalam Electron
// (mis. saat testing di browser biasa).
export async function isGuestLockedNow() {
    try {
        const { ipcRenderer } = window.require('electron');
        return await ipcRenderer.invoke('cek-status-lock');
    } catch (e) {
        return false;
    }
}

export async function handleLogin() {
    const inputUser = document.getElementById('username').value;
    const inputPass = document.getElementById('password').value;
    const btnLogin = document.querySelector('.btn-login-main');

    if (!inputUser || !inputPass) return showCustomAlert("Warning", "Username and Password cannot be empty!");

    // Cegah submit dobel (double-click, atau Enter + klik) yang bisa mengirim request login
    // berkali-kali sebelum request sebelumnya selesai.
    if (btnLogin.disabled) return;

    try {
        btnLogin.disabled = true;
        btnLogin.innerText = "Processing...";
        const response = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: inputUser, password: inputPass })
        });
        const data = await response.json();
        btnLogin.innerText = "Sign In";
        btnLogin.disabled = false;

        if (response.ok) {
            // --- PEMBUATAN SESI PERMANEN ---
            localStorage.setItem('access_token', data.access_token);
            localStorage.setItem('user_role', data.role);
            localStorage.setItem('user_id', data.id);
            localStorage.setItem('username', inputUser);             
            localStorage.setItem('user_dept', data.department || '');
            // -------------------------------

            trackAppOpen('login');

            document.getElementById('username').value = '';
            document.getElementById('password').value = '';
            navigateToRole(data.role);
            perbaruiBadgeMenuPic();
        } else {
            showCustomAlert("Login Failed", data.message || "Incorrect username or password.");
        }
    } catch (error) {
        showCustomAlert("Server Error", "Cannot connect to the backend server.");
        btnLogin.innerText = "Sign In";
        btnLogin.disabled = false;
    }
}

// ====================================================================
// 1. TOMBOL LOGOUT: Menghapus Sesi & Kembali ke Layar Login
// ====================================================================
export async function handleLogout() {
    // Mode Guest terkunci: Logout dinonaktifkan total sampai app di-restart di jaringan yang benar.
    if (await isGuestLockedNow()) {
        return showCustomAlert(
            "Locked",
            "This device is running in Guest network mode with no backend access. Logout and Exit App are disabled — please restart the app once connected to the office network."
        );
    }

    // Validasi Gembok Harian. Pesannya MENYEBUT tugas mana -- sebelumnya hanya bilang ada
    // tugas yang belum diupdate, sehingga PIC harus mencarinya sendiri di antara 20+ baris.
    const { boleh, tertunda } = await checkDailyUpdates();
    if (!boleh) {
        return showCustomAlert(
            "Logout Denied",
            `You cannot log out. ${tertunda.length} task(s) have not been updated today:

`
            + ringkasanTertunda(tertunda)
            + `

Open Update Task List — the category cards show which ones, and inside each list they are at the top under "NOT UPDATED TODAY".`
        );
    }

    const pesan = "Are you sure you want to log out? Your session will be cleared, and you will need to re-enter your Username & Password next time.";
    showCustomConfirm("Confirm Logout", pesan, () => {
        localStorage.clear(); // Hapus memori sesi
        location.reload();    // Kembali ke awal
    });
}

// ====================================================================
// 2. TOMBOL EXIT APP: Mematikan Aplikasi Kiosk (Sesi Tetap Tersimpan)
// ====================================================================
export async function handleExitApp() {
    // Mode Guest terkunci: Exit App dinonaktifkan total sampai app di-restart di jaringan yang benar.
    if (await isGuestLockedNow()) {
        return showCustomAlert(
            "Locked",
            "This device is running in Guest network mode with no backend access. Logout and Exit App are disabled — please restart the app once connected to the office network."
        );
    }

    // Validasi Gembok Harian -- sama seperti handleLogout(), lengkap dengan daftar tugasnya.
    const { boleh, tertunda } = await checkDailyUpdates();
    if (!boleh) {
        return showCustomAlert(
            "Exit Denied",
            `You cannot shut down the system. ${tertunda.length} task(s) have not been updated today:

`
            + ringkasanTertunda(tertunda)
            + `

Open Update Task List — the category cards show which ones, and inside each list they are at the top under "NOT UPDATED TODAY".`
        );
    }

    const pesan = "Are you sure you want to shut down the application? Your login session is secure and will automatically resume when the device is turned back on.";
    showCustomConfirm("Shut Down System", pesan, () => {
        const { ipcRenderer } = window.require('electron');
        ipcRenderer.send('perintah-tutup-paksa'); // Tutup tanpa menghapus localStorage
    });
}

export async function loadAdminUsers() {
    try {
        const res = await fetch(`${API_URL}/auth/users`);
        const users = await res.json();
        const tbody = document.querySelector('#view-admin tbody');
        // Kumpulkan ke satu string lalu assign SEKALI (pola sama dengan renderMDTable()).
        let html = '';
        users.forEach((u) => {
            const deptText = u.department ? ` ${u.department}` : '';

            // Nilai dibawa lewat atribut data-*, BUKAN disisipkan ke dalam literal string JS
            // di dalam onclick. Nama seperti O'Brien dulu menutup literalnya lebih awal,
            // sehingga tombol Edit dan Hapus pada baris itu mati permanen dengan galat parse
            // yang tidak pernah terlihat pengguna kiosk. escapeHtml() mengamankan atributnya;
            // this.dataset mengembalikan nilai aslinya, apa pun tanda bacanya.
            html += `<tr>
                <td>${escapeHtml(u.username)}</td>
                <td>${escapeHtml(u.role.name)}</td>
                <td style="text-align: center;">${escapeHtml(deptText)}</td>
                <td style="display:flex; justify-content: center; gap:5px">
                    <button class="btn-sm btn-secondary" style="text-align: center;"
                            data-id="${u.id}" data-username="${escapeHtml(u.username)}"
                            data-role="${escapeHtml(u.role.name)}" data-dept="${escapeHtml(u.department || '')}"
                            onclick="openEditUserModal(this.dataset.id, this.dataset.username, this.dataset.role, this.dataset.dept)">Edit</button>
                    <button class="btn-sm btn-danger"
                            data-id="${u.id}" data-username="${escapeHtml(u.username)}"
                            onclick="deleteUser(this.dataset.id, this.dataset.username)">Delete</button>
                </td>
            </tr>`;
        });
        tbody.innerHTML = html;
    } catch (error) { console.error(error); }
}

export async function submitNewUser() {
    const username = document.getElementById('admin-new-username').value;
    const password = document.getElementById('admin-new-password').value;
    const role = document.getElementById('admin-new-role').value;
    const dept = document.getElementById('admin-new-dept').value;

    if (!username || !password || !role) return showCustomAlert("Warning", "Fill in the required fields!");
    if (role === 'Dept Head' && !dept) return showCustomAlert("Warning", "Dept Head must have a department!");

    try {
        const response = await fetch(`${API_URL}/auth/register`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ username, password, role, department: dept || null })
        });

        if (response.ok) {
            showCustomAlert("Success", `User ${username} registered successfully!`);
            document.getElementById('admin-new-username').value = '';
            document.getElementById('admin-new-password').value = '';
            document.getElementById('admin-new-role').value = '';
            document.getElementById('admin-new-dept').value = '';
            loadAdminUsers();
        } else {
            const errorData = await response.json();
            showCustomAlert("Failed", errorData.message || "Failed to save user.");
        }
    } catch (error) { showCustomAlert("Error", "Failed to connect to backend server."); }
}

export async function deleteUser(id, username) {
    const pesan = `Are you sure you want to delete user: ${username}?`;

    showCustomConfirm("Delete User", pesan, async () => {
        try {
            const response = await fetch(`${API_URL}/auth/users/${id}`, { 
                method: 'DELETE',
                headers: getAuthHeaders()
            });

            if (response.ok) {
                showCustomAlert("Success", `Account ${username} has been deleted.`);
                loadAdminUsers();
            } else {
                showCustomAlert("Failed", "Cannot delete this user.");
            }
        } catch (error) { showCustomAlert("Error", "Failed to connect to server."); }
    });
}

export function openEditUserModal(id, username, role, dept) {
    document.getElementById('edit-user-id').value = id;
    document.getElementById('edit-user-username').value = username;
    document.getElementById('edit-user-role').value = role;
    document.getElementById('edit-user-dept').value = dept || '';
    document.getElementById('edit-user-password').value = '';
    document.getElementById('modal-edit-user').classList.add('show');
}

export function closeEditUserModal() {
    document.getElementById('modal-edit-user').classList.remove('show');
}

export async function submitEditUser() {
    const id = document.getElementById('edit-user-id').value;
    const username = document.getElementById('edit-user-username').value;
    const role = document.getElementById('edit-user-role').value;
    const dept = document.getElementById('edit-user-dept').value;
    const password = document.getElementById('edit-user-password').value;

    if (!username || !role) return showCustomAlert("Warning", "Username and Role are required!");
    if (role === 'Dept Head' && !dept) return showCustomAlert("Warning", "Dept Head must have a department!");

    const payload = { username, role, department: dept || null };
    if (password) payload.password = password;

    try {
        document.querySelector('button[onclick="submitEditUser()"]').innerText = "Saving...";

        const response = await fetch(`${API_URL}/auth/users/${id}`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });

        document.querySelector('button[onclick="submitEditUser()"]').innerText = "Save Changes";

        if (response.ok) {
            closeEditUserModal();
            document.getElementById('edit-user-password').value = '';
            showCustomAlert("Success", `Account data for ${username} updated successfully!`);
            loadAdminUsers(); // Muat ulang tabel
        } else {
            const errorData = await response.json();
            showCustomAlert("Failed", errorData.message || "Failed to update user.");
        }
    } catch (error) {
        showCustomAlert("Error", "Failed to connect to backend server.");
        document.querySelector('button[onclick="submitEditUser()"]').innerText = "Save Changes";
    }
}

// ==========================================
// LAPORAN JAM LOGIN USER (KHUSUS MD) — mencatat SETIAP kali user login,
// supaya MD bisa melihat jam berapa tiap user login setiap harinya.
// ==========================================
export async function loadLoginLogs() {
    try {
        // Rentang tanggal ditentukan di SERVER, bukan ditarik semua lalu difilter di sini.
        // Tanpa tanggal dipilih -> server mengirim 30 hari terakhir. Dengan tanggal dipilih ->
        // server mengirim hari itu saja. Ini yang menjaga payload tetap kecil walau riwayat
        // login sudah menumpuk bertahun-tahun.
        const dateFilter = document.getElementById('filter-date-login-logs')?.value || '';
        const url = dateFilter
            ? `${API_URL}/auth/login-logs?from=${encodeURIComponent(dateFilter)}`
            : `${API_URL}/auth/login-logs`;

        const res = await fetch(url);
        state.loginLogs = await res.json();
        state.loginLogsPage = 1;
        renderLoginLogsTable();
        await renderDeptsNotLoggedInPanel(dateFilter);
    } catch (error) {
        console.error("Failed to load login logs:", error);
    }
}

// Dipanggil saat MD mengganti tanggal di filter -- sekarang memicu ambil ulang dari server
// (bukan sekadar menyaring data yang sudah ada di memori), karena data yang dimuat hanya
// sebatas rentang yang diminta.
export async function changeLoginLogsDate() {
    await loadLoginLogs();
}

// ==========================================
// PANEL "DEPARTEMEN BELUM LOGIN HARI INI" — ringkasan cepat untuk MD, terpisah dari
// filter tanggal tabel di bawahnya (panel ini SELALU mengacu ke tanggal WITA hari ini,
// bukan tanggal yang sedang difilter user).
// ==========================================
async function renderDeptsNotLoggedInPanel(dateFilter = '') {
    const container = document.getElementById('login-logs-dept-alert');
    if (!container) return;

    try {
        // state.globalUsers tidak otomatis terisi kalau MD langsung buka Login Activity
        // tanpa pernah membuka MD Dashboard dulu -- jadi selalu panggil ulang di sini.
        // Saling bebas -> dijalankan bersamaan, bukan berurutan.
        const [, deptRes] = await Promise.all([
            fetchUsersForMapping(),
            fetch(`${API_URL}/department`),
        ]);
        state.departments = deptRes.ok ? await deptRes.json() : [];

        const todayWita = formatWitaDate(new Date(), 'en-CA');

        // Panel ini SELALU soal hari ini, terlepas dari tanggal apa yang sedang dilihat di
        // tabel. Kalau tidak ada filter tanggal, data 30 hari terakhir yang sudah dimuat
        // pasti memuat hari ini -- tidak perlu request tambahan. Hanya kalau MD sedang
        // melihat tanggal lain, hari ini diambil terpisah supaya panel tidak salah lapor.
        let logsHariIni = state.loginLogs || [];
        if (dateFilter && dateFilter !== todayWita) {
            try {
                const res = await fetch(`${API_URL}/auth/login-logs?from=${encodeURIComponent(todayWita)}`);
                logsHariIni = res.ok ? await res.json() : [];
            } catch (e) {
                console.warn('Gagal mengambil log hari ini untuk panel departemen:', e);
                logsHariIni = [];
            }
        }

        const deptsWithUsers = new Set(
            (state.globalUsers || []).filter(u => u.department).map(u => u.department)
        );
        const deptsLoggedInToday = new Set(
            logsHariIni
                .filter(log => log.user?.department && formatWitaDate(log.loggedInAt, 'en-CA') === todayWita)
                .map(log => log.user.department)
        );

        const notLoggedInToday = state.departments.filter(d => deptsWithUsers.has(d.name) && !deptsLoggedInToday.has(d.name));
        const deptsWithNoUsers = state.departments.filter(d => !deptsWithUsers.has(d.name));

        let html = '';
        if (notLoggedInToday.length === 0) {
            html += `<div style="background:#dcfce7; color:#15803d; border-radius:8px; padding:10px 14px; font-size:13px; font-weight:500;">✅ All departments with a Dept Head have logged in today.</div>`;
        } else {
            const chips = notLoggedInToday.map(d => `<span class="badge" style="background:#fef3c7; color:#92400e;">${escapeHtml(d.name)}</span>`).join(' ');
            html += `<div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:10px 14px;">
                <div style="font-size:13px; font-weight:600; color:#92400e; margin-bottom:6px;">⚠️ Not logged in today (${notLoggedInToday.length}):</div>
                <div style="display:flex; gap:6px; flex-wrap:wrap;">${chips}</div>
            </div>`;
        }
        if (deptsWithNoUsers.length > 0) {
            html += `<div style="font-size:11px; color:#9ca3af; margin-top:6px; font-style:italic;">${deptsWithNoUsers.length} department(s) have no Dept Head assigned yet: ${escapeHtml(deptsWithNoUsers.map(d => d.name).join(', '))}</div>`;
        }

        container.innerHTML = html;
    } catch (error) {
        console.error("Failed to render depts-not-logged-in panel:", error);
        container.innerHTML = '';
    }
}

function renderLoginLogsTable() {
    const tbody = document.querySelector('#view-login-logs tbody');
    if (!tbody) return;

    const searchFilter = (document.getElementById('search-login-logs')?.value || '').toLowerCase();
    const dateFilter = document.getElementById('filter-date-login-logs')?.value || '';

    const filtered = (state.loginLogs || []).filter(log => {
        const username = (log.user && log.user.username) || '';
        const matchSearch = username.toLowerCase().includes(searchFilter);
        // Bandingkan tanggal WITA (bukan tanggal UTC mentah), supaya filter tanggal sesuai
        // dengan apa yang ditampilkan ke user (formatWitaDate juga pakai timezone WITA).
        const matchDate = !dateFilter || formatWitaDate(log.loggedInAt, 'en-CA') === dateFilter;
        return matchSearch && matchDate;
    });

    const countEl = document.getElementById('login-logs-total-count');
    if (countEl) countEl.innerText = filtered.length;

    // Jelaskan rentang data yang sedang dimuat. Tanpa ini, MD bisa mengira riwayat lama
    // hilang padahal cuma di luar jendela default 30 hari -- datanya tetap utuh di database
    // dan bisa dilihat dengan memilih tanggal.
    const hintEl = document.getElementById('login-logs-range-hint');
    if (hintEl) {
        hintEl.innerText = dateFilter
            ? ` — ${formatWitaDate(dateFilter)}`
            : ' — last 30 days (pick a date to view older)';
    }

    // --- PAGINATION ---
    // Tabel ini tumbuh terus (trackAppOpen mencatat tiap login DAN tiap auto-resume), jadi
    // tanpa pagination jumlah barisnya tak terbatas. Terukur: 15.000 log = 4.892 ms render,
    // dan itu terulang di SETIAP ketukan keyboard di kotak search. Dengan pagination,
    // biayanya tetap konstan berapa pun total lognya. Pola mengikuti renderMDTable().
    const totalItems = filtered.length;
    const pageSizeSelect = document.getElementById('login-logs-page-size');
    const pageSize = parseInt(pageSizeSelect ? pageSizeSelect.value : '50', 10) || 50;

    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (state.loginLogsPage > totalPages) state.loginLogsPage = totalPages;
    if (state.loginLogsPage < 1) state.loginLogsPage = 1;

    const startIndex = (state.loginLogsPage - 1) * pageSize;
    const pageItems = filtered.slice(startIndex, startIndex + pageSize);

    const pageInfo = document.getElementById('login-logs-page-info');
    if (pageInfo) pageInfo.innerText = `Page ${state.loginLogsPage} of ${totalPages}`;

    const btnPrev = document.getElementById('login-logs-btn-prev');
    if (btnPrev) btnPrev.disabled = (state.loginLogsPage <= 1);

    const btnNext = document.getElementById('login-logs-btn-next');
    if (btnNext) btnNext.disabled = (state.loginLogsPage >= totalPages);

    if (pageItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #6b7280; padding: 24px;">No login activity found.</td></tr>`;
        return;
    }

    tbody.innerHTML = pageItems.map((log, index) => {
        const username = (log.user && log.user.username) || 'Unknown';
        const roleName = (log.user && log.user.role && log.user.role.name) || '-';
        const isAutoResume = log.source === 'auto-resume';
        const typeBadge = isAutoResume
            ? '<span class="badge" style="background:#e0f2fe; color:#0369a1;">Auto-Resume</span>'
            : '<span class="badge" style="background:#dcfce7; color:#15803d;">Login</span>';
        return `<tr>
            <td style="text-align: center;">${startIndex + index + 1}</td>
            <td style="font-weight: 500;">${escapeHtml(username)}</td>
            <td>${escapeHtml(roleName)}</td>
            <td>${formatWitaDate(log.loggedInAt)}</td>
            <td style="text-align: center;">${formatWitaDateTime(log.loggedInAt, 'en-GB', { hour: '2-digit', minute: '2-digit' })}</td>
            <td style="text-align: center;">${typeBadge}</td>
        </tr>`;
    }).join('');
}

export function filterLoginLogs() {
    // Filter/pencarian berubah -> selalu kembali ke halaman 1 (sama seperti applyFilterMD)
    state.loginLogsPage = 1;
    renderLoginLogsTable();
}

export function changeLoginLogsPage(direction) {
    state.loginLogsPage += direction;
    renderLoginLogsTable();
}

export function changeLoginLogsPageSize() {
    state.loginLogsPage = 1;
    renderLoginLogsTable();
}

export async function refreshLoginLogs() {
    try {
        const btnRefresh = document.querySelector('#view-login-logs button[onclick="refreshLoginLogs()"]');
        if (btnRefresh) btnRefresh.innerText = "Refreshing...";
        await loadLoginLogs();
        if (btnRefresh) btnRefresh.innerText = "Refresh Data";
        showCustomAlert("Success", "Login activity data has been successfully refreshed!");
    } catch (error) {
        showCustomAlert("Error", "Failed to refresh login activity data.");
    }
}

export const filterLoginLogsDebounced = debounce(filterLoginLogs, 250);
