// js/issue-action.js
import { API_URL, getAuthHeaders } from './config.js';
import { showCustomAlert, showView } from './utils.js';
import { state } from './issue-state.js';
import { loadDashboardMD, loadDashboardPIC } from './issue-dashboard.js';
import { openDetailView } from './issue-detail.js';

export async function submitIssue() {
    const title = document.getElementById('issue-title').value;
    const dept = document.getElementById('issue-dept').value;
    const desc = document.getElementById('issue-desc').value;
    const dueDate = document.getElementById('issue-due-date').value;
    const issuerId = localStorage.getItem('user_id');
    
    if (!title || !dept || !desc || !dueDate) return showCustomAlert("Warning", "All fields are required!");
    
    try {
        const response = await fetch(`${API_URL}/issue/create`, {
            method: 'POST', headers: getAuthHeaders(),
            body: JSON.stringify({ title, department: dept, description: desc, issuedBy: String(issuerId), dueDate: dueDate, priority: "Pending" })
        });
        
        if (response.ok) {
            showCustomAlert("Success", "Report submitted successfully!");
            document.getElementById('issue-title').value = ''; 
            document.getElementById('issue-dept').value = ''; 
            document.getElementById('issue-desc').value = ''; 
            document.getElementById('issue-due-date').value = '';
            window.backToMenu();
        } else showCustomAlert("Failed", "Server error occurred.");
    } catch (error) { showCustomAlert("Server Error", "Failed to connect to backend."); }
}

export function openUpdateFromDetail() {
    const issue = state.globalIssues.find(i => i.id === state.currentDetailId);
    
    if (issue) {
        // BLOKIR: Hentikan proses jika statusnya sudah Closed
        if (issue.status === 'Closed') {
            showCustomAlert("Access Denied", "This issue has been closed and can no longer be updated.");
            return; // Perintah 'return' akan menghentikan eksekusi kode ke bawah
        }
        
        // Jika statusnya belum Closed, lanjutkan buka modal
        openUpdateModal(issue); 
    }
}

export function openUpdateModal(issue) {
    document.getElementById('update-id').value = issue.id;
    document.getElementById('update-status').value = issue.status;
    document.getElementById('update-action').value = '';
    document.getElementById('update-remark').value = '';

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
    document.getElementById('update-action').value = '';
    document.getElementById('update-remark').value = '';

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
    const action = document.getElementById('update-action').value;
    let remark = document.getElementById('update-remark').value;
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
    formData.append('correctiveAction', action);
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