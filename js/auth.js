import { API_URL, getAuthHeaders } from './config.js';
import { showCustomAlert, navigateToRole, showCustomConfirm, formatWitaDate, formatWitaDateTime } from './utils.js';
import { checkDailyUpdates } from './issues.js';
import { state } from './issue-state.js';
// -------------------------------------------

// Catat "app dibuka" — dipanggil setiap kali user benar-benar mulai memakai aplikasi,
// baik lewat login manual ('login') maupun lewat sesi tersimpan yang auto-resume tanpa
// perlu isi username/password lagi ('auto-resume'). Best-effort: tidak pernah menghalangi
// alur login/navigasi walau requestnya gagal (mis. backend sedang tidak bisa diakses).
export function trackAppOpen(source) {
    const userId = localStorage.getItem('user_id');
    if (!userId) return;

    fetch(`${API_URL}/auth/track-open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, source })
    }).catch((error) => {
        console.warn('Gagal mencatat app dibuka:', error);
    });
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
    // Validasi Gembok Harian
    const canExit = await checkDailyUpdates();
    if (!canExit) {
        return showCustomAlert(
            "Logout Denied", 
            "You cannot log out! There are active issues assigned to you that have NOT been updated today."
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
    // Validasi Gembok Harian
    const canExit = await checkDailyUpdates();
    if (!canExit) {
        return showCustomAlert(
            "Exit Denied", 
            "You are not allowed to shut down the system! There are active issues assigned to you that have NOT been updated today."
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
        tbody.innerHTML = '';
        users.forEach((u) => {
            const deptText = u.department ? ` ${u.department}` : ''; 
            
            tbody.innerHTML += `<tr>
                <td>${u.username}</td>
                <td>${u.role.name}</td>
                <td style="text-align: center;">${deptText}</td>
                <td style="display:flex; justify-content: center; gap:5px">
                    <button class="btn-sm btn-secondary" style="text-align: center;" onclick="openEditUserModal(${u.id}, '${u.username}', '${u.role.name}', '${u.department || ''}')">Edit</button>
                    <button class="btn-sm btn-danger" onclick="deleteUser(${u.id}, '${u.username}')">Hapus</button>
                </td>
            </tr>`;
        });
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
        const res = await fetch(`${API_URL}/auth/login-logs`);
        state.loginLogs = await res.json();
        renderLoginLogsTable();
    } catch (error) {
        console.error("Failed to load login logs:", error);
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

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #6b7280; padding: 24px;">No login activity found.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map((log, index) => {
        const username = (log.user && log.user.username) || 'Unknown';
        const roleName = (log.user && log.user.role && log.user.role.name) || '-';
        const isAutoResume = log.source === 'auto-resume';
        const typeBadge = isAutoResume
            ? '<span class="badge" style="background:#e0f2fe; color:#0369a1;">Auto-Resume</span>'
            : '<span class="badge" style="background:#dcfce7; color:#15803d;">Login</span>';
        return `<tr>
            <td style="text-align: center;">${index + 1}</td>
            <td style="font-weight: 500;">${username}</td>
            <td>${roleName}</td>
            <td>${formatWitaDate(log.loggedInAt)}</td>
            <td style="text-align: center;">${formatWitaDateTime(log.loggedInAt, 'en-GB', { hour: '2-digit', minute: '2-digit' })}</td>
            <td style="text-align: center;">${typeBadge}</td>
        </tr>`;
    }).join('');
}

export function filterLoginLogs() {
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