// js/issues.js
import { API_URL } from './config.js';

// --- EKSPOR SELURUH FILE MODULAR AGAR SISTEM (app.js) TETAP BISA MEMBACANYA ---
export * from './issue-guard.js';
export * from './issue-pdf.js';
export * from './issue-action.js';
export * from './issue-detail.js';
export * from './issue-dashboard.js';

// ==========================================
// MENGAMBIL DEPARTEMEN & MENYUNTIKKAN KE DROPDOWN
// (Dibiarkan disini karena file ini cukup ringkas dan bersifat umum)
// ==========================================
export async function loadDepartments() {
    try {
        const response = await fetch(`${API_URL}/department`);
        if (!response.ok) return;
        const depts = await response.json();
        let optionsHtml = '<option value="">-- Select Department --</option>';
        depts.forEach(d => {
            optionsHtml += `<option value="${d.name}">${d.name}</option>`;
        });

        const deptIssue = document.getElementById('issue-dept');
        const deptAdminNew = document.getElementById('admin-new-dept');
        const deptAdminEdit = document.getElementById('edit-user-dept'); 

        if (deptIssue) deptIssue.innerHTML = optionsHtml;
        if (deptAdminNew) deptAdminNew.innerHTML = optionsHtml;
        if (deptAdminEdit) deptAdminEdit.innerHTML = optionsHtml; 
    } catch (error) { console.error(error); }
}