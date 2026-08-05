// js/issue-action.js
import { API_URL, getAuthHeaders } from './config.js';
import { showCustomAlert, showView, showCustomConfirm, stripAutoForwardNotes } from './utils.js';
import { state } from './issue-state.js';
import { loadDashboardMD, loadDashboardPIC } from './issue-dashboard.js';
import { openDetailView, backFromDetail } from './issue-detail.js';

export async function submitIssue() {
    const title = document.getElementById('issue-title').value;
    const dept = document.getElementById('issue-dept').value;
    const desc = document.getElementById('issue-desc').value;
    const dueDate = document.getElementById('issue-due-date').value;
    const correctiveAction = document.getElementById('issue-corrective-action').value;
    const category = document.getElementById('issue-category').value;
    const issuerId = localStorage.getItem('user_id');

    if (!title || !dept || !desc || !dueDate || !correctiveAction || !category) return showCustomAlert("Warning", "All fields are required!");

    try {
        const response = await fetch(`${API_URL}/issue/create`, {
            method: 'POST', headers: getAuthHeaders(),
            body: JSON.stringify({ title, department: dept, description: desc, correctiveAction, category, issuedBy: String(issuerId), dueDate: dueDate, priority: "Pending" })
        });

        if (response.ok) {
            showCustomAlert("Success", "Report submitted successfully!");
            document.getElementById('issue-title').value = '';
            document.getElementById('issue-dept').value = '';
            document.getElementById('issue-desc').value = '';
            document.getElementById('issue-due-date').value = '';
            document.getElementById('issue-corrective-action').value = '';
            document.getElementById('issue-category').value = '';
            window.backToMenu();
        } else showCustomAlert("Failed", "Server error occurred.");
    } catch (error) { showCustomAlert("Server Error", "Failed to connect to backend."); }
}

export function openUpdateFromDetail() {
    const issue = state.globalIssues.find(i => i.id === state.currentDetailId);
    if (!issue) return;

    const role = localStorage.getItem('user_role');

    // BLOKIR: Dept Head tidak bisa mengubah issue yang sudah Closed.
    // MD tetap diizinkan agar bisa membetulkan data (mis. hasil Import Excel yang keliru).
    if (issue.status === 'Closed' && role !== 'MD') {
        showCustomAlert("Access Denied", "This issue has been closed and can no longer be updated.");
        return;
    }

    openUpdateModal(issue);
}

// ==========================================
// REMARK PERPOIN & DINAMIS (setiap poin punya status In Progress/Closed sendiri,
// terpisah dari dropdown "Current Status" issue secara keseluruhan)
// ==========================================
const MAX_REMARK_POINTS = 10;

function renumberRemarkPoints() {
    const container = document.getElementById('update-remark-points-container');
    if (!container) return;
    Array.from(container.children).forEach((row, index) => {
        const numEl = row.querySelector('.remark-point-num');
        if (numEl) numEl.innerText = `${index + 1}.`;
    });
}

window.addRemarkPoint = function (text = '', status = 'Progress') {
    const container = document.getElementById('update-remark-points-container');
    if (!container) return;

    if (container.children.length >= MAX_REMARK_POINTS) {
        return showCustomAlert("Warning", `Maximum ${MAX_REMARK_POINTS} remark points allowed.`);
    }

    const uniqueId = 'remark-point-' + Date.now() + Math.random().toString(36).substr(2, 5);
    const row = document.createElement('div');
    row.id = uniqueId;
    row.className = 'remark-point-row';
    row.style.cssText = 'display: flex; align-items: center; gap: 8px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 8px;';

    row.innerHTML = `
        <span class="remark-point-num" style="font-size: 12px; font-weight: bold; color: #6b7280; min-width: 16px;"></span>
        <select class="remark-point-status" style="width: auto; margin: 0; padding: 4px 6px; font-size: 12px; flex-shrink: 0;">
            <option value="Progress">In Progress</option>
            <option value="Closed">Closed</option>
        </select>
        <input type="text" class="remark-point-text" placeholder="Describe this point..." style="flex: 1; margin: 0; padding: 6px 8px; font-size: 13px;">
        <button type="button" onclick="removeRemarkPoint('${uniqueId}')" style="background:none; border:none; color:#ef4444; cursor:pointer; font-weight:bold; font-size: 16px; padding: 0 4px; width:auto;" title="Remove">&times;</button>
    `;

    container.appendChild(row);
    row.querySelector('.remark-point-status').value = status;
    row.querySelector('.remark-point-text').value = text;

    renumberRemarkPoints();
};

window.removeRemarkPoint = function (id) {
    const row = document.getElementById(id);
    if (row) row.remove();
    renumberRemarkPoints();
};

// Baca ulang poin-poin remark dari update TERAKHIR (mis. yang diketik kemarin), supaya PIC
// tidak perlu mengetik ulang poin yang sama tiap hari — cukup ubah status In Progress -> Closed
// begitu poin itu selesai, atau tambah poin baru. Cuma cocok kalau formatnya persis
// "1. [Status] teks" (hasil fitur remark perpoin ini) — remark lama/bebas sebelum fitur ini
// dibiarkan diabaikan (modal tetap mulai dengan 1 poin kosong seperti biasa).
function parsePreviousRemarkPoints(issue) {
    if (!issue.histories || issue.histories.length === 0) return [];

    const latestHistory = [...issue.histories].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    const cleanedRemark = stripAutoForwardNotes(latestHistory.remark);
    if (!cleanedRemark) return [];

    const pointPattern = /^\d+\.\s*\[(In Progress|Closed)\]\s*(.+)$/i;
    const points = [];
    cleanedRemark.split('\n').forEach(line => {
        const match = line.trim().match(pointPattern);
        if (match) {
            const status = match[1].toLowerCase() === 'closed' ? 'Closed' : 'Progress';
            points.push({ text: match[2].trim(), status });
        }
    });
    return points;
}

function resetRemarkPoints(seedPoints = []) {
    const container = document.getElementById('update-remark-points-container');
    if (container) container.innerHTML = '';
    if (seedPoints.length > 0) {
        seedPoints.forEach(p => window.addRemarkPoint(p.text, p.status));
    } else {
        window.addRemarkPoint(); // Selalu mulai dengan minimal 1 poin kosong
    }
}

export function openUpdateModal(issue) {
    document.getElementById('update-id').value = issue.id;
    document.getElementById('update-status').value = issue.status;
    resetRemarkPoints(parsePreviousRemarkPoints(issue));

    const fileInput = document.getElementById('update-evidence');
    if (fileInput) fileInput.value = '';

    const selectPic = document.getElementById('update-pic');
    const currentUserId = String(localStorage.getItem('user_id'));

    if (selectPic) {
        let options = '<option value="">-- Keep Current PIC --</option>';
        let previousPicId = null;
        if (issue.involvedPicIds) {
            const historyArray = issue.involvedPicIds.split(',');
            const currentIndex = historyArray.indexOf(String(issue.picId));
            if (currentIndex > 0) previousPicId = historyArray[currentIndex - 1];
        }

        state.globalUsers.forEach(u => {
            const roleName = (typeof u.role === 'object' && u.role !== null) ? u.role.name : u.role;
            if (roleName === 'Dept Head') {
                if (String(u.id) !== String(issue.picId) && String(u.id) !== currentUserId) {
                    const deptName = u.department || 'Unknown Dept';
                    let label = `${u.username} (${deptName})`;
                    if (String(u.id) === String(previousPicId)) label = `🔙 RETURN TASK TO: ${u.username} (${deptName})`;
                    options += `<option value="${u.id}">${label}</option>`;
                }
            }
        });
        selectPic.innerHTML = options;
    }
    document.getElementById('modal-update').classList.add('show');
}

export function closeUpdateModal() {
    document.getElementById('modal-update').classList.remove('show');

    // Reset form field
    const remarkContainer = document.getElementById('update-remark-points-container');
    if (remarkContainer) remarkContainer.innerHTML = '';

    // Reset Input File
    const fileInput = document.getElementById('update-evidence');
    if (fileInput) {
        fileInput.value = ''; // Hapus file dari input
    }

    // Reset Preview UI
    const previewContainer = document.getElementById('upload-preview-container');
    const defaultContent = document.getElementById('upload-content-default');
    const wrapper = document.getElementById('upload-wrapper');

    if (previewContainer) previewContainer.innerHTML = ''; // Hapus semua gambar preview
    if (previewContainer) previewContainer.style.display = 'none';
    if (defaultContent) defaultContent.style.display = 'flex';
    if (wrapper) {
        wrapper.style.borderColor = '#d1d5db';
        wrapper.style.backgroundColor = '#f9fafb';
    }
}

export async function submitUpdate() {
    const id = document.getElementById('update-id').value;
    const status = document.getElementById('update-status').value;

    // Gabungkan poin-poin remark dinamis jadi satu teks bernomor, masing-masing dengan
    // tag status sendiri (In Progress/Closed) — terpisah dari status issue secara keseluruhan.
    // WAJIB: minimal 1 poin terisi, dan tiap poin yang diisi minimal 10 karakter.
    const MIN_REMARK_POINT_LENGTH = 10;
    const statusLabel = { Progress: 'In Progress', Closed: 'Closed' };
    const remarkPoints = [];
    let hasTooShortPoint = false;
    document.querySelectorAll('#update-remark-points-container .remark-point-row').forEach(row => {
        const text = row.querySelector('.remark-point-text').value.trim();
        const pointStatus = row.querySelector('.remark-point-status').value;
        if (!text) return; // Baris kosong dilewati, tidak dianggap error
        if (text.length < MIN_REMARK_POINT_LENGTH) { hasTooShortPoint = true; return; }
        remarkPoints.push(`[${statusLabel[pointStatus] || pointStatus}] ${text}`);
    });

    if (hasTooShortPoint) {
        return showCustomAlert("Warning", `Each remark point must be at least ${MIN_REMARK_POINT_LENGTH} characters long.`);
    }
    if (remarkPoints.length === 0) {
        return showCustomAlert("Warning", `Please fill in at least one remark point (minimum ${MIN_REMARK_POINT_LENGTH} characters) describing today's progress.`);
    }

    let remark = remarkPoints.map((p, i) => `${i + 1}. ${p}`).join('\n');

    const selectPic = document.getElementById('update-pic');
    const newPicId = selectPic ? selectPic.value : null;

    if (newPicId) {
        const selectedPicText = selectPic.options[selectPic.selectedIndex].text;
        const autoNote = `[🔄 Task Forwarded to: ${selectedPicText}]`;
        remark = remark ? `${remark} | ${autoNote}` : autoNote;
    }

    // 1. Gunakan FormData (Bukan JSON.stringify) karena kita mengirim File
    const formData = new FormData();
    formData.append('status', status);
    if (remark) formData.append('remark', remark);
    if (newPicId) formData.append('picId', newPicId);
    
    // 2. Tangkap elemen input file dan lakukan looping untuk memasukkan SEMUA file
    const fileInput = document.getElementById('update-evidence');
    if (fileInput && fileInput.files.length > 0) {
        for (let i = 0; i < fileInput.files.length; i++) {
            formData.append('evidence', fileInput.files[i]); 
        }
    }

    // 3. Modifikasi Headers (Hapus Content-Type agar browser mengatur boundary multipart/form-data otomatis)
    const headers = getAuthHeaders();
    delete headers['Content-Type']; 

    try {
        const response = await fetch(`${API_URL}/issue/update/${id}`, {
            method: 'PATCH', 
            headers: headers, 
            body: formData // Kirim FormData
        });
        
        if (response.ok) {
            closeUpdateModal();
            
            // Kosongkan input file setelah sukses agar tidak terbawa ke update berikutnya
            if (fileInput) fileInput.value = '';
            
            showCustomAlert("Success", newPicId ? "Task forwarded successfully!" : "Progress updated successfully.");
            
            if (localStorage.getItem('user_role') === 'MD') await loadDashboardMD();
            else await loadDashboardPIC();
            
            if (newPicId && localStorage.getItem('user_role') === 'Dept Head') showView('view-pic-update');
            else openDetailView(Number(id)); 
        } else {
            showCustomAlert("Failed", "Error occurred during update.");
        }
    } catch (error) { 
        showCustomAlert("Error", "Server error."); 
    }
}

export function openPriorityModal(id, currentPrio) {
    document.getElementById('prio-issue-id').value = id;
    document.getElementById('prio-select').value = currentPrio || 'Menunggu Review';
    document.getElementById('modal-priority').classList.add('show');
}

export function closePriorityModal() { document.getElementById('modal-priority').classList.remove('show'); }

export async function submitPriority() {
    const id = document.getElementById('prio-issue-id').value;
    const priority = document.getElementById('prio-select').value;
    try {
        const response = await fetch(`${API_URL}/issue/priority/${id}`, {
            method: 'PATCH', headers: getAuthHeaders(), body: JSON.stringify({ priority })
        });
        if (response.ok) {
            closePriorityModal();
            showCustomAlert("Success", "Priority scale updated successfully!");
            await loadDashboardMD();
            if (document.getElementById('view-issue-detail').classList.contains('active')) openDetailView(Number(id));
        } else showCustomAlert("Failed", "An error occurred.");
    } catch (error) { showCustomAlert("Error", "Server error."); }
}

// ==========================================
// FUNGSI UBAH KATEGORI (HANYA UNTUK MD)
// ==========================================
export function openCategoryModal(id, currentCategory) {
    document.getElementById('cat-issue-id').value = id;
    document.getElementById('cat-select').value = currentCategory || 'Daily';
    document.getElementById('modal-category').classList.add('show');
}

export function closeCategoryModal() { document.getElementById('modal-category').classList.remove('show'); }

export async function submitCategory() {
    const id = document.getElementById('cat-issue-id').value;
    const category = document.getElementById('cat-select').value;
    try {
        const response = await fetch(`${API_URL}/issue/category/${id}`, {
            method: 'PATCH', headers: getAuthHeaders(), body: JSON.stringify({ category })
        });
        if (response.ok) {
            closeCategoryModal();
            showCustomAlert("Success", "Category updated successfully!");
            await loadDashboardMD();
            if (document.getElementById('view-issue-detail').classList.contains('active')) openDetailView(Number(id));
        } else showCustomAlert("Failed", "An error occurred.");
    } catch (error) { showCustomAlert("Error", "Server error."); }
}

// ==========================================
// FUNGSI UBAH DUE DATE (HANYA UNTUK MD)
// ==========================================
export function openDueDateModal(id, currentDueDate) {
    document.getElementById('due-date-issue-id').value = id;
    
    // Ubah format tanggal dari database (ISO) menjadi format YYYY-MM-DD untuk input kalender HTML
    let formattedDate = '';
    if (currentDueDate && currentDueDate !== 'null' && currentDueDate !== 'undefined') {
        const d = new Date(currentDueDate);
        if (!isNaN(d.getTime())) {
            formattedDate = d.toISOString().split('T')[0];
        }
    }
    
    document.getElementById('due-date-input').value = formattedDate;
    document.getElementById('modal-due-date').classList.add('show');
}

export function closeDueDateModal() { 
    document.getElementById('modal-due-date').classList.remove('show');
}

export async function submitDueDate() {
    const id = document.getElementById('due-date-issue-id').value;
    const newDueDate = document.getElementById('due-date-input').value;

    if (!newDueDate) return showCustomAlert("Warning", "Please select a valid date!");

    try {
        // PERHATIAN: Endpoint ini bergantung pada sistem Backend (NestJS) Anda.
        // Jika Anda menggunakan endpoint '/issue/update/:id', silakan ganti URL-nya ke sana.
        const response = await fetch(`${API_URL}/issue/due-date/${id}`, {
            method: 'PATCH', 
            headers: getAuthHeaders(), 
            body: JSON.stringify({ dueDate: newDueDate })
        });
        
        if (response.ok) {
            closeDueDateModal();
            showCustomAlert("Success", "Target due date updated successfully!");
            
            // Muat ulang tabel dashboard MD
            if (document.getElementById('view-md').classList.contains('active')) {
                await loadDashboardMD();
            }
            // Jika MD mengubahnya dari dalam layar detail, muat ulang detailnya
            if (document.getElementById('view-issue-detail').classList.contains('active')) {
                openDetailView(Number(id));
            }
        } else {
            showCustomAlert("Failed", "An error occurred while updating the due date.");
        }
    } catch (error) {
        showCustomAlert("Error", "Server error.");
    }
}

// =========================================================
// FITUR EDIT ASSIGNMENT (KHUSUS MD) - MEMPERBAIKI ISSUED BY & PIC YANG SALAH
// Dipakai antara lain untuk membetulkan hasil Import Excel
// yang gagal dicocokkan otomatis dengan user sistem.
// =========================================================
export function openEditAssignmentModal(id, currentPicId, currentIssuedBy) {
    document.getElementById('edit-assignment-issue-id').value = id;

    const issuerSelect = document.getElementById('edit-assignment-issuer-select');
    if (issuerSelect) {
        let options = '';
        state.globalUsers.forEach(u => {
            const roleName = (typeof u.role === 'object' && u.role !== null) ? u.role.name : u.role;
            options += `<option value="${u.id}">${u.username} (${roleName})</option>`;
        });
        issuerSelect.innerHTML = options;
        issuerSelect.value = currentIssuedBy ? String(currentIssuedBy) : '';
    }

    const picSelect = document.getElementById('edit-assignment-pic-select');
    if (picSelect) {
        let options = '<option value="">-- Unassigned --</option>';
        state.globalUsers.forEach(u => {
            const roleName = (typeof u.role === 'object' && u.role !== null) ? u.role.name : u.role;
            if (roleName === 'Dept Head') {
                const deptName = u.department || 'Unknown Dept';
                options += `<option value="${u.id}">${u.username} (${deptName})</option>`;
            }
        });
        picSelect.innerHTML = options;
        picSelect.value = currentPicId ? String(currentPicId) : '';
    }

    document.getElementById('modal-edit-assignment').classList.add('show');
}

export function closeEditAssignmentModal() {
    document.getElementById('modal-edit-assignment').classList.remove('show');
}

export async function submitEditAssignment() {
    const id = document.getElementById('edit-assignment-issue-id').value;
    const issuerSelect = document.getElementById('edit-assignment-issuer-select');
    const picSelect = document.getElementById('edit-assignment-pic-select');

    const issuedBy = issuerSelect.value;
    const picId = picSelect.value;

    if (!issuedBy) return showCustomAlert("Warning", "Issued By cannot be empty!");

    const issuerLabel = issuerSelect.options[issuerSelect.selectedIndex].text;
    const picLabel = picId ? picSelect.options[picSelect.selectedIndex].text : 'Unassigned';

    const issue = state.globalIssues.find(i => String(i.id) === String(id));
    const currentStatus = issue ? issue.status : 'Open';

    const formData = new FormData();
    formData.append('status', currentStatus);
    formData.append('remark', `[✏️ Assignment corrected manually by MD — Issued By: ${issuerLabel}, PIC: ${picLabel}]`);
    formData.append('issuedBy', issuedBy);
    if (picId) formData.append('picId', picId);

    const headers = getAuthHeaders();
    delete headers['Content-Type'];

    try {
        const response = await fetch(`${API_URL}/issue/update/${id}`, {
            method: 'PATCH', headers, body: formData
        });

        if (response.ok) {
            closeEditAssignmentModal();
            showCustomAlert("Success", "Assignment updated successfully!");
            await loadDashboardMD();
            if (document.getElementById('view-issue-detail').classList.contains('active')) openDetailView(Number(id));
        } else {
            showCustomAlert("Failed", "An error occurred while updating the assignment.");
        }
    } catch (error) {
        showCustomAlert("Error", "Server error.");
    }
}

// =========================================================
// FITUR EDIT ISSUE PENUH (KHUSUS MD) - Title, Description, Corrective Action
// Field lain (Status, Priority, Category, Due Date, PIC/Issued By) sudah punya jalur edit
// sendiri-sendiri, jadi sengaja tidak diulang di modal ini. Department TIDAK bisa diedit
// karena tidak disimpan sebagai kolom di Issue -- cuma dipakai sesaat saat issue dibuat
// untuk mencari PIC awal.
// =========================================================
export function openEditIssueModal() {
    const issue = state.globalIssues.find(i => i.id === state.currentDetailId);
    if (!issue) return;

    document.getElementById('edit-issue-id').value = issue.id;
    document.getElementById('edit-issue-title').value = issue.caseNotification || '';
    document.getElementById('edit-issue-description').value = issue.description || '';
    document.getElementById('edit-issue-corrective-action').value = issue.correctiveAction || '';
    document.getElementById('modal-edit-issue').classList.add('show');
}

export function closeEditIssueModal() {
    document.getElementById('modal-edit-issue').classList.remove('show');
}

export async function submitEditIssue() {
    const id = document.getElementById('edit-issue-id').value;
    const title = document.getElementById('edit-issue-title').value.trim();
    const description = document.getElementById('edit-issue-description').value.trim();
    const correctiveAction = document.getElementById('edit-issue-corrective-action').value.trim();

    if (!title || !description || !correctiveAction) {
        return showCustomAlert("Warning", "Title, Description, and Corrective Action cannot be empty!");
    }

    try {
        const response = await fetch(`${API_URL}/issue/${id}`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify({ title, description, correctiveAction })
        });

        if (response.ok) {
            closeEditIssueModal();
            showCustomAlert("Success", "Issue updated successfully!");
            await loadDashboardMD();
            openDetailView(Number(id));
        } else {
            showCustomAlert("Failed", "An error occurred while updating the issue.");
        }
    } catch (error) {
        showCustomAlert("Error", "Server error.");
    }
}

// =========================================================
// FITUR HAPUS ISSUE (KHUSUS MD)
// =========================================================
export function confirmDeleteIssue() {
    const issue = state.globalIssues.find(i => i.id === state.currentDetailId);
    if (!issue) return;

    const message = `Are you sure you want to permanently delete this issue?\n\n"${issue.caseNotification}"\n\nThis action cannot be undone — all progress history will be deleted as well.`;
    showCustomConfirm("Delete Issue", message, async () => {
        try {
            const response = await fetch(`${API_URL}/issue/${issue.id}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });

            if (response.ok) {
                showCustomAlert("Success", "Issue has been permanently deleted.");
                await loadDashboardMD();
                backFromDetail();
            } else {
                showCustomAlert("Failed", "An error occurred while deleting the issue.");
            }
        } catch (error) {
            showCustomAlert("Error", "Server error.");
        }
    });
}