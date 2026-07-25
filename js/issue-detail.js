// js/issue-detail.js
import { API_URL } from './config.js';
import { showView, getStatusBadge, formatWitaDate } from './utils.js';
import { state } from './issue-state.js';

export function openDetailView(id) {
    state.currentDetailId = id; 
    const issue = state.globalIssues.find(i => i.id === id);
    if (!issue) return;
    
    const currentIndex = state.currentIssueIds.indexOf(id);
    const totalIssues = state.currentIssueIds.length;
    
    if (totalIssues > 0 && currentIndex !== -1) {
        document.getElementById('detail-page-info').innerText = `${currentIndex + 1} / ${totalIssues}`;
        
        // Matikan tombol Kiri jika di halaman pertama, Kanan jika di akhir
        const btnPrev = document.getElementById('btn-prev-issue');
        const btnNext = document.getElementById('btn-next-issue');
        
        btnPrev.disabled = (currentIndex === 0);
        btnPrev.style.opacity = (currentIndex === 0) ? '0.4' : '1';
        btnPrev.style.cursor = (currentIndex === 0) ? 'not-allowed' : 'pointer';

        btnNext.disabled = (currentIndex === totalIssues - 1);
        btnNext.style.opacity = (currentIndex === totalIssues - 1) ? '0.4' : '1';
        btnNext.style.cursor = (currentIndex === totalIssues - 1) ? 'not-allowed' : 'pointer';
    }
    
    document.getElementById('detail-title').innerText = issue.caseNotification;
    document.getElementById('detail-created').innerText = formatWitaDate(issue.createdAt);

    let issuerName = '-';
    if (issue.issuedBy) {
        const issuerUser = state.globalUsers.find(u => String(u.id) === String(issue.issuedBy));
        issuerName = issuerUser ? issuerUser.username : `ID: ${issue.issuedBy}`;
    }
    const role = localStorage.getItem('user_role');
    const elIssuer = document.getElementById('detail-issuer');
    if (elIssuer) {
        if (role === 'MD') {
            elIssuer.innerHTML = `<span style="cursor:pointer; border-bottom: 1px dashed #1591DC;" onclick="openEditAssignmentModal(${issue.id}, ${issue.picId || 'null'}, ${issue.issuedBy || 'null'})" title="Edit Assignment">${issuerName} ✏️</span>`;
        } else {
            elIssuer.innerText = issuerName;
        }
    }

    const elDueDate = document.getElementById('detail-due-date');
    if (elDueDate) {
        const dueDateText = formatWitaDate(issue.dueDate);
        if (role === 'MD') {
            elDueDate.innerHTML = `<span style="cursor:pointer; color:#ef4444; border-bottom: 1px dashed #ef4444;" onclick="openDueDateModal(${issue.id}, '${issue.dueDate}')" title="Change Due Date">${dueDateText} ✏️</span>`;
        } else {
            elDueDate.innerText = dueDateText;
        }
    }

    const picUser = state.globalUsers.find(u => String(u.id) === String(issue.picId));
    const picName = picUser ? picUser.username : 'Unassigned';

    const elPic = document.getElementById('detail-pic');
    if (elPic) {
        if (role === 'MD') {
            elPic.innerHTML = `<span style="cursor:pointer; color:#0ea5e9; border-bottom: 1px dashed #0ea5e9;" onclick="openEditAssignmentModal(${issue.id}, ${issue.picId || 'null'}, ${issue.issuedBy || 'null'})" title="Edit Assignment">${picName} ✏️</span>`;
        } else {
            elPic.innerText = picName;
        }
    }

    document.getElementById('detail-desc').innerText = issue.description || '-';
    document.getElementById('detail-corrective-action').innerText = issue.correctiveAction || '-';
    document.getElementById('detail-status').innerHTML = getStatusBadge(issue.status);
    document.getElementById('detail-prio').innerHTML = `<span class="badge badge-prio">${issue.priority}</span>`;

    const elCategory = document.getElementById('detail-category');
    if (elCategory) {
        const categoryText = issue.category || '-';
        if (role === 'MD') {
            elCategory.innerHTML = `<span style="cursor:pointer; color:#16a34a; border-bottom: 1px dashed #16a34a;" onclick="openCategoryModal(${issue.id}, '${issue.category || 'Daily'}')" title="Change Category">${categoryText} ✏️</span>`;
        } else {
            elCategory.innerText = categoryText;
        }
    }

    const currentUserId = Number(localStorage.getItem('user_id'));

    // MD dapat mengupdate/memperbaiki SELURUH progres PICA, termasuk yang sudah Closed
    // (dibutuhkan untuk membetulkan data hasil Import Excel yang keliru).
    // Dept Head hanya dapat mengupdate task miliknya sendiri dan tidak bisa jika sudah Closed.
    const btnUpdate = document.getElementById('btn-detail-update');
    if (btnUpdate) {
        const isMD = (role === 'MD');
        const isOwnerDeptHead = (role === 'Dept Head' && issue.picId === currentUserId && issue.status !== 'Closed');
        btnUpdate.style.display = (isMD || isOwnerDeptHead) ? 'block' : 'none';
    }

    const btnExport = document.getElementById('btn-detail-export');
    if (btnExport) btnExport.style.display = (role === 'MD') ? 'block' : 'none';

    // =========================================================
    // RENDER TIMELINE & TOMBOL ATTACHMENT (LAMPIRAN FILE)
    // =========================================================
    const timelineContainer = document.getElementById('detail-timeline');
    timelineContainer.innerHTML = ''; 
    if (!issue.histories || issue.histories.length === 0) {
        timelineContainer.innerHTML = `<div style="color:#9ca3af; font-size:13px; font-style:italic;">No actions have been taken yet.</div>`;
    } else {
        issue.histories.forEach((hist) => {
            const updateStr = formatWitaDate(hist.createdAt, 'en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            const remarkHTML = hist.remark ? `<p class="timeline-remark">${hist.remark}</p>` : `<p class="timeline-remark" style="color:#9ca3af; font-style:italic;">No additional remarks.</p>`;
            
            // --- UBAH LOGIKA TOMBOL LAMPIRAN DI SINI ---
            let attachmentHTML = '';
            if (hist.evidenceUrl) {
                attachmentHTML += `<div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed #e5e7eb; display: flex; gap: 8px; flex-wrap: wrap;">`;
                
                // Pecah string berdasar koma
                const fileUrls = hist.evidenceUrl.split(',');
                
                fileUrls.forEach((url, fileIndex) => {
                    const fullUrl = `${API_URL}${url}`;
                    
                    // KUNCI PENGAMAN: Tambahkan type="button" dan return false;
                    attachmentHTML += `
                        <button type="button" onclick="openAttachmentModal('${fullUrl}'); return false;" style="width: auto; margin: 0; display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #3957ED; font-weight: 600; background: #E0F2FE; padding: 6px 12px; border-radius: 6px; transition: 0.2s; border: 1px solid #80C8F6; cursor: pointer;">
                            📄 File ${fileIndex + 1}
                        </button>
                    `;
                });
                
                attachmentHTML += `</div>`;
            }

            timelineContainer.innerHTML += `
                <div class="timeline-item">
                    <div class="timeline-date">
                        <span style="display:flex; gap:8px;">Update: ${getStatusBadge(hist.status)}</span>
                        <span style="color:#1591DC;">${updateStr}</span>
                    </div>
                    <div class="">
                        ${remarkHTML}
                        ${attachmentHTML}
                    </div>
                </div>`;
        });
    }
    showView('view-issue-detail');
}

export function backFromDetail() {
    const role = localStorage.getItem('user_role');
    // KTT juga akan dikembalikan ke layar tabel monitoring
    if (role === 'MD' || role === 'KTT') showView('view-md'); 
    else if (role === 'Dept Head') showView('view-pic-update');
    else if (role === 'User') showView('view-user-history'); 
}

// ==========================================
// FUNGSI BARU: MODAL VIEWER LAMPIRAN
// ==========================================
export function openAttachmentModal(url) {
    const contentDiv = document.getElementById('attachment-content');
    
    // Deteksi tipe file dari akhir URL untuk menentukan cara menampilkannya
    const isPDF = url.toLowerCase().endsWith('.pdf');
    
    if (isPDF) {
        // Jika PDF, gunakan iframe agar bisa di-scroll
        contentDiv.innerHTML = `<iframe src="${url}" style="width: 100%; height: 100%; border: none;"></iframe>`;
    } else {
        // Jika gambar (JPG/PNG), gunakan tag img
        contentDiv.innerHTML = `<img src="${url}" style="max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px;" alt="Attachment Evidence">`;
    }
    
    document.getElementById('modal-attachment').classList.add('show');
}

export function closeAttachmentModal() {
    document.getElementById('modal-attachment').classList.remove('show');
    // Kosongkan isi HTML agar file (terutama PDF) berhenti di-load saat modal ditutup
    document.getElementById('attachment-content').innerHTML = ''; 
}

// ==========================================
// INTERAKSI UI & MULTI-PREVIEW UPLOAD FILE
// ==========================================
export function updateFileNameDisplay(input) {
    // Gunakan setTimeout agar UI tidak membeku saat dialog file baru saja ditutup
    setTimeout(() => {
        const previewContainer = document.getElementById('upload-preview-container');
        const defaultContent = document.getElementById('upload-content-default');
        const wrapper = document.getElementById('upload-wrapper');

        if (!previewContainer) return;
        previewContainer.innerHTML = '';

        if (input.files && input.files.length > 0) {
            defaultContent.style.display = 'none';
            previewContainer.style.display = 'flex';
            wrapper.style.borderColor = '#3957ED';

            Array.from(input.files).forEach(file => {
                const thumbDiv = document.createElement('div');
                thumbDiv.style.cssText = 'width: 70px; height: 70px; border-radius: 6px; border: 1px solid #ddd; display: flex; align-items: center; justify-content: center; background: #eee; overflow: hidden;';
                
                if (file.type.startsWith('image/')) {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        thumbDiv.innerHTML = `<img src="${e.target.result}" style="width: 100%; height: 100%; object-fit: cover;">`;
                    };
                    reader.readAsDataURL(file);
                } else {
                    thumbDiv.innerHTML = '📄';
                }
                previewContainer.appendChild(thumbDiv);
            });
        }
    }, 0); // Tunggu 100ms agar dialog benar-benar tertutup
}

// ==========================================
// FITUR NAVIGASI NEXT / PREV ISSUE
// ==========================================
export function navigateIssue(direction) {
    const currentIndex = state.currentIssueIds.indexOf(state.currentDetailId);
    if (currentIndex === -1) return; // Mencegah error jika ID tidak ditemukan

    const nextIndex = currentIndex + direction;
    
    // Pastikan index baru tidak keluar dari batas array
    if (nextIndex >= 0 && nextIndex < state.currentIssueIds.length) {
        const nextId = state.currentIssueIds[nextIndex];
        
        // Buka detail yang baru (ini akan otomatis me-render ulang seluruh halaman detail)
        openDetailView(nextId); 
    }
}

// WAJIB: Ekspos fungsi ke global agar bisa dipanggil dari HTML onclick
window.navigateIssue = navigateIssue;