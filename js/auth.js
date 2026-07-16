import { API_URL, getAuthHeaders } from './config.js';
import { showCustomAlert, navigateToRole, showCustomConfirm } from './utils.js';
import { checkDailyUpdates } from './issues.js'; 
// -------------------------------------------

export async function handleLogin() {
    const inputUser = document.getElementById('username').value;
    const inputPass = document.getElementById('password').value;

    if (!inputUser || !inputPass) return showCustomAlert("Warning", "Username and Password cannot be empty!");

    try {
        document.querySelector('.btn-login-main').innerText = "Processing...";
        const response = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: inputUser, password: inputPass })
        });
        const data = await response.json();
        document.querySelector('.btn-login-main').innerText = "Sign In";

        if (response.ok) {
            // --- PEMBUATAN SESI PERMANEN ---
            localStorage.setItem('access_token', data.access_token);
            localStorage.setItem('user_role', data.role);
            localStorage.setItem('user_id', data.id);
            localStorage.setItem('username', inputUser);             
            localStorage.setItem('user_dept', data.department || ''); 
            // -------------------------------
            
            document.getElementById('username').value = '';
            document.getElementById('password').value = '';
            navigateToRole(data.role);
        } else {
            showCustomAlert("Login Failed", data.message || "Incorrect username or password.");
        }
    } catch (error) {
        showCustomAlert("Server Error", "Cannot connect to the backend server.");
        document.querySelector('.btn-login-main').innerText = "Sign In";
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