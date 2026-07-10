// js/issue-dashboard.js
import { API_URL } from './config.js';
import { showCustomAlert, showView, getStatusBadge, getDailyUpdateBadge } from './utils.js';
import { state } from './issue-state.js';
import { openDetailView } from './issue-detail.js';
import { exportFilteredIssuesToPDF } from './issue-pdf.js';

export async function fetchUsersForMapping() {
    try {
        const res = await fetch(`${API_URL}/auth/users`);
        if (res.ok) state.globalUsers = await res.json();
    } catch (error) { console.warn("Gagal mapping user:", error); }
}

export async function openUserHistory() {
    try {
        await fetchUsersForMapping();
        const res = await fetch(`${API_URL}/issue`);
        state.globalIssues = await res.json(); 
        
        const tbody = document.querySelector('#view-user-history tbody');
        if (!tbody) return;
        tbody.innerHTML = ''; 
        
        const currentUserId = String(localStorage.getItem('user_id'));
        const myIssues = state.globalIssues.filter(i => String(i.issuedBy) === currentUserId);

        const statusOrder = { 'Open': 1, 'Progress': 2, 'Closed': 3 };
        myIssues.sort((a, b) => {
            const weightA = statusOrder[a.status] || 4;
            const weightB = statusOrder[b.status] || 4;
            
            if (weightA !== weightB) {
                return weightA - weightB;
            }
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

        if (myIssues.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #6b7280; padding: 24px;">You haven't created any reports yet.</td></tr>`;
            showView('view-user-history'); return;
        }

        state.currentIssueIds = myIssues.map(i => i.id);

        myIssues.forEach((item, index) => {
            const dateStr = new Date(item.createdAt).toLocaleDateString('en-GB');
            const picUser = state.globalUsers.find(u => String(u.id) === String(item.picId));
            const picName = picUser ? picUser.username : 'Unassigned';
            
            tbody.innerHTML += `<tr>
                <td style="text-align: center;">${index + 1}</td>
                <td>${item.caseNotification}</td> <td>${dateStr}</td>
                <td style="font-weight: 500; color: #1591DC;">${picName}</td> <td style="text-align: center;">${getStatusBadge(item.status)}</td>
                <td style="text-align: center;"><button class="btn-sm" onclick="openDetailView(${item.id})">View Details</button></td>
            </tr>`;
        });
        showView('view-user-history');
    } catch (error) { showCustomAlert("Error", "Failed to load report history."); }
}

export async function refreshUserHistory() {
    try {
        const btnRefresh = document.querySelector('#view-user-history button[onclick="refreshUserHistory()"]');
        if (btnRefresh) btnRefresh.innerText = "Refreshing...";
        await openUserHistory();
        if (btnRefresh) btnRefresh.innerText = "Refresh Data";
        showCustomAlert("Success", "History data has been successfully refreshed!");
    } catch (error) { showCustomAlert("Error", "Failed to refresh history data."); }
}

export async function refreshDashboardMD() {
    try {
        const btnRefresh = document.querySelector('button[onclick="refreshDashboardMD()"]');
        if (btnRefresh) btnRefresh.innerText = "Refreshing...";
        await loadDashboardMD();
        if (btnRefresh) btnRefresh.innerText = "Refresh Data";
        showCustomAlert("Success", "Dashboard data has been successfully refreshed!");
    } catch (error) { showCustomAlert("Error", "Failed to refresh dashboard data."); }
}

export async function refreshDashboardPIC() {
    try {
        const btnRefresh = document.querySelector('button[onclick="refreshDashboardPIC()"]');
        if (btnRefresh) btnRefresh.innerText = "Refreshing...";
        
        // Panggil fungsi load bawaan PIC yang sudah Anda buat sebelumnya
        await loadDashboardPIC();
        
        if (btnRefresh) btnRefresh.innerText = "Refresh Data";
        showCustomAlert("Success", "Task list data has been successfully refreshed!");
    } catch (error) { 
        showCustomAlert("Error", "Failed to refresh task list data."); 
    }
}

export async function loadDashboardMD() {
    try {
        await fetchUsersForMapping(); 
        const res = await fetch(`${API_URL}/issue`);
        state.globalIssues = await res.json(); 
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
    const startDateFilter = document.getElementById('filter-date-start-md').value;
    const endDateFilter = document.getElementById('filter-date-end-md').value;

    // 2. Saring data globalIssues
    const filteredIssues = state.globalIssues.filter(item => {
        const matchStatus = (statusFilter === 'All') || (item.status === statusFilter);
        const matchScale = (scaleFilter === 'All') || (item.priority === scaleFilter);

        let matchDate = true;
        if (startDateFilter || endDateFilter) {
            const issueDate = new Date(item.createdAt);
            const start = startDateFilter ? new Date(startDateFilter) : null;
            if (start) start.setHours(0, 0, 0, 0);

            const end = endDateFilter ? new Date(endDateFilter) : null;
            if (end) end.setHours(23, 59, 59, 999);

            if (start && end) matchDate = issueDate >= start && issueDate <= end;
            else if (start) matchDate = issueDate >= start;
            else if (end) matchDate = issueDate <= end;
        }

        // --- TAMBAHAN LOGIKA UNTUK SEARCH TEXT ---
        // Cari nama PIC & Issuer untuk dicocokkan dengan teks pencarian
        const issuerUser = state.globalUsers.find(u => String(u.id) === String(item.issuedBy));
        const issuerName = issuerUser ? issuerUser.username : (item.issuedBy ? `ID: ${item.issuedBy}` : 'Unknown');
        
        const picUser = state.globalUsers.find(u => String(u.id) === String(item.picId));
        const picName = picUser ? picUser.username : 'Unassigned';

        const safeTitle = (item.caseNotification || '').toLowerCase();
        const safePic = picName.toLowerCase();
        const safeIssuer = issuerName.toLowerCase();
        const safeId = String(item.id || '').toLowerCase();

        const matchSearch = safeTitle.includes(searchFilter) || 
                            safePic.includes(searchFilter) || 
                            safeIssuer.includes(searchFilter) || 
                            safeId.includes(searchFilter);

        // Harus lolos SEMUA filter
        return matchStatus && matchScale && matchDate && matchSearch;
    });

    const statusOrder = { 'Open': 1, 'Progress': 2, 'Closed': 3 };
    filteredIssues.sort((a, b) => {
        const weightA = statusOrder[a.status] || 4;
        const weightB = statusOrder[b.status] || 4;
        
        // 1. Prioritas Pertama: Urutkan berdasarkan Status
        if (weightA !== weightB) {
            return weightA - weightB;
        }
        
        // 2. Prioritas Kedua: Jika statusnya SAMA, urutkan berdasarkan Tanggal (Terbaru ke Terlama)
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        
        return dateB - dateA; // Hasil positif akan menempatkan tanggal terbaru di atas
    });

    // Setiap kali filter/pencarian berubah, kembali ke halaman 1
    state.mdFilteredIssues = filteredIssues;
    state.mdCurrentPage = 1;
    renderMDTable();
}

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
    const pageSize = (pageSizeValue === 'All') ? Math.max(totalItems, 1) : parseInt(pageSizeValue, 10);

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
        tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: #6b7280; padding: 24px;">No data found matching the selected filters.</td></tr>`;
        return;
    }

    // Variabel penampung HTML agar render lebih cepat (Optimasi)
    let rowsHTML = '';

    pageItems.forEach((item, index) => {
        const dateStr = new Date(item.createdAt).toLocaleDateString('en-GB');
        const dueDateStr = item.dueDate ? new Date(item.dueDate).toLocaleDateString('en-GB') : '-';

        let dueDateDisplay = dueDateStr;
        if (role === 'MD') {
            dueDateDisplay = `<span style="cursor:pointer; color:#d97706; border-bottom: 1px dashed #d97706;" onclick="openDueDateModal(${item.id}, '${item.dueDate}')" title="Change Due Date">${dueDateStr}</span>`;
        }

        const issuerUser = state.globalUsers.find(u => String(u.id) === String(item.issuedBy));
        const issuerName = issuerUser ? issuerUser.username : (item.issuedBy ? `ID: ${item.issuedBy}` : 'Unknown');

        const picUser = state.globalUsers.find(u => String(u.id) === String(item.picId));
        const picName = picUser ? picUser.username : 'Unassigned';

        let prioBadge = `<span class="badge badge-prio">${item.priority}</span>`;
        if (role === 'MD') {
            prioBadge = `<span class="badge badge-prio" style="cursor:pointer; border:1px dashed #d97706;" onclick="openPriorityModal(${item.id}, '${item.priority}')" title="Change Priority">${item.priority}</span>`;
        }

        rowsHTML += `<tr>
            <td style="text-align: center;">${startIndex + index + 1}</td>
            <td>${item.caseNotification}</td>
            <td style="font-weight: 500; color: #1591DC;">${issuerName}</td>
            <td>${dateStr}</td>
            <td>${dueDateDisplay}</td>
            <td style="font-weight: 500;">${picName}</td>
            <td style="text-align: center;">${getStatusBadge(item.status)}</td>
            <td style="text-align: center;">${prioBadge}</td>
            <td style="text-align: center;">${getDailyUpdateBadge(item)}</td>
            <td style="text-align: center;"><button class="btn-sm" onclick="openDetailView(${item.id})">View Details</button></td>
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
    
    // Saring berdasarkan kepemilikan (User yang membuat) DAN teks pencarian
    const filteredIssues = state.globalIssues.filter(item => {
        const isMine = String(item.issuedBy) === currentUserId;
        
        const picUser = state.globalUsers.find(u => String(u.id) === String(item.picId));
        const picName = picUser ? picUser.username.toLowerCase() : 'unassigned';
        const safeTitle = (item.caseNotification || '').toLowerCase();
        const safeId = String(item.id || '').toLowerCase();
        
        const matchSearch = safeTitle.includes(searchFilter) || 
                            picName.includes(searchFilter) || 
                            safeId.includes(searchFilter);
                            
        return isMine && matchSearch;
    });

    const statusOrder = { 'Open': 1, 'Progress': 2, 'Closed': 3 };
    filteredIssues.sort((a, b) => {
        const weightA = statusOrder[a.status] || 4;
        const weightB = statusOrder[b.status] || 4;
        
        if (weightA !== weightB) {
            return weightA - weightB;
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    state.currentIssueIds = filteredIssues.map(i => i.id);
    
    tbody.innerHTML = '';
    if (filteredIssues.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #6b7280; padding: 24px;">No data found matching the selected filters.</td></tr>`;
        return;
    }
    
    filteredIssues.forEach((item, index) => {
        const dateStr = new Date(item.createdAt).toLocaleDateString('en-GB');
        const picUser = state.globalUsers.find(u => String(u.id) === String(item.picId));
        const picName = picUser ? picUser.username : 'Unassigned';
        
        tbody.innerHTML += `<tr>
            <td style="text-align: center;">${index + 1}</td>
            <td>${item.caseNotification}</td> <td>${dateStr}</td>
            <td style="font-weight: 500; color: #1591DC;">${picName}</td> <td style="text-align: center;">${getStatusBadge(item.status)}</td>
            <td style="text-align: center;"><button class="btn-sm" onclick="openDetailView(${item.id})">View Details</button></td>
        </tr>`;
    });
}

// ==========================================
// FITUR SEARCH UNTUK PIC (DEPT HEAD)
// ==========================================
export function filterPICHistory() {
    const tbody = document.querySelector('#view-pic-update tbody');
    if (!tbody) return;
    
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

    const statusOrder = { 'Open': 1, 'Progress': 2, 'Closed': 3 };
    filteredIssues.sort((a, b) => {
        const weightA = statusOrder[a.status] || 4;
        const weightB = statusOrder[b.status] || 4;
        
        if (weightA !== weightB) {
            return weightA - weightB;
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    state.currentIssueIds = filteredIssues.map(i => i.id);

    const picTotalCount = document.getElementById('pic-total-count');
    if (picTotalCount) picTotalCount.innerText = filteredIssues.length;

    tbody.innerHTML = '';
    if (filteredIssues.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #6b7280; padding: 24px;">No data found matching the selected filters.</td></tr>`;
        return;
    }

    filteredIssues.forEach((item, index) => {
        const dueDateStr = item.dueDate ? new Date(item.dueDate).toLocaleDateString('en-GB') : '-';
        const prioBadge = `<span class="badge badge-prio">${item.priority}</span>`;

        tbody.innerHTML += `<tr>
            <td style="text-align: center;">${index + 1}</td>
            <td>${item.caseNotification}</td> <td>${dueDateStr}</td>
            <td style="text-align: center;">${prioBadge}</td>
            <td style="text-align: center;">${getStatusBadge(item.status)}</td>
            <td style="text-align: center;">${getDailyUpdateBadge(item)}</td>
            <td style="text-align: center;"><button class="btn-sm" onclick="openDetailView(${item.id})">View Details</button></td>
        </tr>`;
    });
}

export async function loadDashboardPIC() {
    try {
        await fetchUsersForMapping(); 
        const res = await fetch(`${API_URL}/issue`);
        state.globalIssues = await res.json(); 
        const tbody = document.querySelector('#view-pic-update tbody');
        if (!tbody) return;
        tbody.innerHTML = ''; 
        
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

        const statusOrder = { 'Open': 1, 'Progress': 2, 'Closed': 3 };
        activeIssues.sort((a, b) => {
            const weightA = statusOrder[a.status] || 4;
            const weightB = statusOrder[b.status] || 4;
            
            // 1. Urutkan berdasarkan Status
            if (weightA !== weightB) {
                return weightA - weightB;
            }
            
            // 2. Jika status sama, urutkan berdasarkan Tanggal Terbaru
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

        state.currentIssueIds = activeIssues.map(i => i.id);

        const picTotalCount = document.getElementById('pic-total-count');
        if (picTotalCount) picTotalCount.innerText = activeIssues.length;

        if (activeIssues.length === 0) {
            tbody.innerHTML = `
                <tr><td colspan="7" style="text-align: center; padding: 48px 24px; background-color: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                        <div style="color: #6b7280; font-size: 15px; font-weight: 500;">No Tasks Assigned</div>
                        <div style="color: #9ca3af; font-size: 13px; margin-top: 4px; font-style: italic;">You're all caught up! There are no active issues assigned to you at the moment.</div>
                </td></tr>`;
            return;
        }

        activeIssues.forEach((item, index) => {
            const dueDateStr = item.dueDate ? new Date(item.dueDate).toLocaleDateString('en-GB') : '-';
            const prioBadge = `<span class="badge badge-prio">${item.priority}</span>`;

            tbody.innerHTML += `<tr>
                <td style="text-align: center;">${index + 1}</td>
                <td>${item.caseNotification}</td> <td>${dueDateStr}</td>
                <td style="text-align: center;">${prioBadge}</td>
                <td style="text-align: center;">${getStatusBadge(item.status)}</td>
                <td style="text-align: center;">${getDailyUpdateBadge(item)}</td>
                <td style="text-align: center;"><button class="btn-sm" onclick="openDetailView(${item.id})">View Details</button></td>
            </tr>`;
        });
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
        // Sesuaikan dengan port backend NestJS Anda (biasanya 3000)
        const apiUrl = 'http://192.168.100.205:3000';
        // const apiUrl = 'http://localhost:3000';
        const token = localStorage.getItem('access_token');

        // Panggil endpoint GET dari backend NestJS
        const response = await fetch(`${apiUrl}/arsip-mom`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) throw new Error("Failed to fetch archives");

        const result = await response.json();
        
        if (result.success && result.data.length > 0) {
            tbody.innerHTML = ''; // Bersihkan tabel
            
            state.cachedMOMArchives = result.data;

            result.data.forEach((arsip, index) => {
                const tr = document.createElement('tr');
                
                // Format tanggal export menjadi format yang rapi (English)
                const exportDate = new Date(arsip.tanggalExport || arsip.tanggal_export).toLocaleString('en-GB', { 
                    day: '2-digit', month: 'short', year: 'numeric', 
                    hour: '2-digit', minute: '2-digit' 
                });

                tr.innerHTML = `
                    <td style="text-align:center;">${index + 1}</td>
                    <td style="font-weight: 500;">${exportDate}</td>
                    <td>${arsip.chairman || '-'}</td>
                    <td>${arsip.notulen || '-'}</td>
                    <td>${arsip.location || '-'}</td>
                    <td style="text-align:center;">
                        <button class="btn-sm" style="background-color: #1591DC;" onclick="viewMOMDetail(${arsip.id})">View Detail</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
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
export function viewMOMDetail(id) {
    const archive = state.cachedMOMArchives.find(a => a.id === id);
    if (!archive) return showCustomAlert("Error", "Archive data not found in memory!");

    document.getElementById('det-mom-notulen').innerText = archive.notulen || '-';
    document.getElementById('det-mom-chairman').innerText = archive.chairman || '-';
    document.getElementById('det-mom-date').innerText = archive.date || '-';
    document.getElementById('det-mom-time').innerText = archive.time || '-';
    document.getElementById('det-mom-location').innerText = archive.location || '-';

    let participants = archive.participants || archive.participants;
    if (typeof participants === 'string') {
        try { participants = JSON.parse(participants); } catch (e) { participants = []; }
    }
    document.getElementById('det-mom-participants').innerText = Array.isArray(participants) && participants.length > 0 ? participants.join(', ') : '-';

    let issues = archive.dataIssues || archive.data_issues;
    if (typeof issues === 'string') {
        try { issues = JSON.parse(issues); } catch (e) { issues = []; }
    }

    const tbody = document.getElementById('det-mom-issues');
    tbody.innerHTML = '';
    
    if (Array.isArray(issues) && issues.length > 0) {
        issues.forEach((item, idx) => {
            const prioBadge = item.priority ? `<span class="badge badge-prio">${item.priority}</span>` : '-';
            
            // PERBAIKAN: Baris tabel dicetak dengan padding yang lebih luas dan border bawah tipis
            tbody.innerHTML += `
                <tr style="border-bottom: 1px solid #e5e7eb; transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='#f9fafb'" onmouseout="this.style.backgroundColor='transparent'">
                    <td style="padding: 12px 16px; text-align: center; color: #4b5563;">${idx + 1}</td>
                    <td style="padding: 12px 16px; font-weight: 500; color: #111827;">${item.caseNotification || '-'}</td>
                    <td style="padding: 12px 16px; text-align: center;">${getStatusBadge(item.status)}</td>
                    <td style="padding: 12px 16px; text-align: center;">${prioBadge}</td>
                </tr>
            `;
        });
    } else {
        tbody.innerHTML = '<tr><td colspan="4" style="padding: 24px; text-align: center; color: #6b7280; font-style: italic;">No issue data recorded in this meeting.</td></tr>';
    }

    // Sambungkan tombol download ke ID ini
    document.getElementById('btn-redownload').setAttribute('onclick', `downloadMOMArchive(${id})`);

    // Tampilkan Modal dengan Transisi
    const modal = document.getElementById('modal-mom-detail');
    const modalContent = document.getElementById('modal-mom-detail-content');
    
    modal.style.visibility = 'visible';
    modal.style.opacity = '1';
    if (modalContent) modalContent.style.transform = 'scale(1)';
}

export function closeMOMDetail() {
    const modal = document.getElementById('modal-mom-detail');
    const modalContent = document.getElementById('modal-mom-detail-content');
    
    modal.style.opacity = '0';
    if (modalContent) modalContent.style.transform = 'scale(0.95)';
    
    setTimeout(() => {
        modal.style.visibility = 'hidden';
    }, 250); 
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
 // FITUR RE-DOWNLOAD PDF ARSIP
 // ==========================================
 export async function downloadMOMArchive(id) {
     const archive = state.cachedMOMArchives.find(a => a.id === id);
     if (!archive) return showCustomAlert("Error", "Archive data not found in memory!");

     // Ekstrak data JSON kembali menjadi format objek aslinya
     let parsedParticipants = archive.participants;
     let parsedIssues = archive.dataIssues || archive.data_issues;

     if (typeof parsedParticipants === 'string') {
         try { parsedParticipants = JSON.parse(parsedParticipants); } catch (e) { parsedParticipants = []; }
     }
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

     // Tutup modal agar rapi, lalu jalankan fungsi PDF
     closeMOMDetail();
     await exportFilteredIssuesToPDF('MD', momData);
 }