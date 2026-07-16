// js/issue-import.js
// FITUR: IMPORT DAFTAR ISSUE PICA DARI FILE EXCEL (.xlsx / .xls / .csv)
//
// Aturan pengisian (sesuai kebutuhan bisnis):
// - "Issued By", "PIC", DAN "Department" -> SELALU tetap: default "MD" (Department) dan akun MD
//   yang sedang login (Issued By/PIC). Tidak perlu pilih department manual lagi.
//   Kolom "Issued" dan "PIC" pada file Excel hanya disimpan sebagai catatan referensi di Remark,
//   tidak dipakai untuk menentukan siapa Issued By / PIC / Department-nya.
import { API_URL, getAuthHeaders } from './config.js';
import { showCustomAlert } from './utils.js';
import { state } from './issue-state.js';
import { loadDashboardMD, fetchUsersForMapping } from './issue-dashboard.js';

const EXPECTED_HEADERS = ['Case/Notification', 'Date Issue', 'Issued', 'Corrective Action', 'PIC', 'Due Date', 'Stat', 'Remark', 'SKALA'];
const DEFAULT_DEPARTMENT = 'MD';

// PENTING: TIDAK mengandalkan window.XLSX (global dari <script> tag). Karena window ini
// berjalan dengan nodeIntegration:true, Electron menyuntikkan `exports`/`module` ke SETIAP
// script (termasuk <script src> biasa). UMD loader SheetJS mendeteksi itu sebagai environment
// CommonJS dan mengisi library ke global `exports`, BUKAN ke `window.XLSX` — sehingga
// `window.XLSX` yang tersisa cuma objek kosong tanpa `.utils`/`.write`.
// Solusinya: ambil library langsung lewat window.require('xlsx') (Node require, tersedia
// karena nodeIntegration:true), persis seperti pola window.require('electron') di file lain.
function getXlsx() {
    try {
        return window.require('xlsx');
    } catch (e) {
        return null;
    }
}

function normalizeStatus(text) {
    const t = String(text || '').toLowerCase();
    if (t.includes('clos')) return 'Closed';
    if (t.includes('progr')) return 'Progress';
    if (t.includes('open')) return 'Open';
    return 'Open';
}

function normalizePriority(text) {
    const t = String(text || '').toLowerCase();
    if (/prio\s*1|priority\s*1/.test(t)) return 'Prio 1';
    if (/prio\s*2|priority\s*2/.test(t)) return 'Prio 2';
    if (/prio\s*3|priority\s*3/.test(t)) return 'Prio 3';
    return 'Pending';
}

function normalizeDueDate(text) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    // Sudah dalam format ISO (yyyy-mm-dd) hasil parsing XLSX dengan cellDates
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.substring(0, 10);

    // Coba format umum dd/mm/yyyy atau d/m/yyyy
    const m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
        let [, d, mo, y] = m;
        if (y.length === 2) y = `20${y}`;
        return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }

    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
    return '';
}

// ==========================================
// MODAL: BUKA / TUTUP
// ==========================================
export async function openImportModal() {
    await fetchUsersForMapping();

    state.importRows = [];
    const fileInput = document.getElementById('import-file-input');
    if (fileInput) fileInput.value = '';

    updateImportInfoBanner();
    renderImportPreview();

    document.getElementById('modal-import-excel').classList.add('show');
}

export function closeImportModal() {
    document.getElementById('modal-import-excel').classList.remove('show');
    state.importRows = [];
}

// ==========================================
// TAMPILKAN SIAPA YANG AKAN JADI ISSUED BY, PIC & DEPARTMENT (SELALU MD)
// ==========================================
function updateImportInfoBanner() {
    const infoEl = document.getElementById('import-pic-info');
    if (!infoEl) return;

    const currentUsername = localStorage.getItem('username') || 'MD';
    infoEl.innerHTML = `<span style="color:#059669;">✓ Issued By and PIC will both be set to: <strong>${currentUsername}</strong> &nbsp;|&nbsp; Department will be set to: <strong>${DEFAULT_DEPARTMENT}</strong></span>`;
}

// ==========================================
// UNDUH TEMPLATE EXCEL CONTOH
// ==========================================
export async function downloadImportTemplate() {
    const XLSX = getXlsx();
    if (!XLSX) return showCustomAlert("Error", "Excel library failed to load.");

    let base64;
    try {
        const sampleRow = {
            'Case/Notification': 'Example: New container post required',
            'Date Issue': '2026-06-14',
            'Issued': 'MD',
            'Corrective Action': 'Actions already taken so far...',
            'PIC': 'MD',
            'Due Date': '2026-05-31',
            'Stat': 'Progress',
            'Remark': 'Additional notes...',
            'SKALA': 'Prio 2'
        };
        const ws = XLSX.utils.json_to_sheet([sampleRow], { header: EXPECTED_HEADERS });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Template');
        base64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
    } catch (error) {
        console.error(error);
        showCustomAlert("Error", `Failed to generate the Excel template: ${error && error.message ? error.message : error}`);
        return;
    }

    // PENTING: Tidak pakai XLSX.writeFile()/blob-download langsung. Karena window ini berjalan
    // dalam mode kiosk dengan nodeIntegration:true, jalur download browser biasa tidak reliable.
    // Jadi dipakai jalur IPC 'simpan-file' yang sama persis dengan yang sudah terbukti jalan
    // untuk export PDF (lihat js/issue-pdf.js), yaitu memunculkan native Save-As dialog.
    try {
        const { ipcRenderer } = window.require('electron');
        const dataUri = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`;
        const result = await ipcRenderer.invoke('simpan-file', dataUri, 'PICA_Import_Template.xlsx', {
            title: 'Save Excel Template',
            filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
        });

        if (result.success) showCustomAlert("Success", "Excel template saved successfully!");
        else if (!result.canceled) showCustomAlert("Error", result.error || "Failed to save the Excel template.");
    } catch (err) {
        // Fallback: bukan environment Electron (mis. dibuka langsung di browser saat development)
        try {
            const byteChars = atob(base64);
            const byteNumbers = new Array(byteChars.length);
            for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
            const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'PICA_Import_Template.xlsx';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        } catch (fallbackErr) {
            console.error(fallbackErr);
            showCustomAlert("Error", "A system communication error occurred while saving the template.");
        }
    }
}

// ==========================================
// BACA & PARSE FILE EXCEL YANG DIPILIH USER
// ==========================================
export async function handleImportFileSelect(inputEl) {
    const file = inputEl.files && inputEl.files[0];
    if (!file) return;

    const XLSX = getXlsx();
    if (!XLSX) {
        showCustomAlert("Error", "Excel library failed to load. Please restart the application.");
        return;
    }

    try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '' });

        // Cari baris header (baris yang mengandung kolom "Case/Notification")
        let headerRowIndex = -1;
        let colMap = {};
        for (let r = 0; r < rows.length; r++) {
            const testMap = detectColumns(rows[r]);
            if (testMap.title !== undefined) { headerRowIndex = r; colMap = testMap; break; }
        }

        if (headerRowIndex === -1) {
            showCustomAlert("Failed", "Header row not found. Ensure the file contains a 'Case/Notification' column.");
            return;
        }

        const parsedRows = [];
        for (let r = headerRowIndex + 1; r < rows.length; r++) {
            const cells = rows[r];
            if (!cells || cells.every(c => String(c || '').trim() === '')) continue;

            const get = (key) => colMap[key] !== undefined ? String(cells[colMap[key]] || '').trim() : '';

            const title = get('title');
            if (!title) continue;

            parsedRows.push({
                title,
                dateIssueRaw: get('dateIssue'),
                correctiveAction: get('correctiveAction'),
                dueDate: normalizeDueDate(get('dueDate')),
                status: normalizeStatus(get('status')),
                remark: get('remark'),
                priority: normalizePriority(get('priority')),
                // Disimpan hanya sebagai referensi di Remark. Issued By & PIC selalu = MD yang login.
                issuerRaw: get('issuer'),
                picRaw: get('pic')
            });
        }

        if (parsedRows.length === 0) {
            showCustomAlert("Warning", "No data rows found below the header row.");
            return;
        }

        state.importRows = parsedRows;
        renderImportPreview();
    } catch (error) {
        console.error(error);
        showCustomAlert("Error", "Failed to read the Excel file. Ensure the format is .xlsx, .xls, or .csv.");
    }
}

function detectColumns(headerCells) {
    if (!Array.isArray(headerCells)) return {};
    const map = {};
    headerCells.forEach((cell, idx) => {
        const h = String(cell || '').toLowerCase().trim();
        if (!h) return;
        if (map.title === undefined && (h.includes('case') || h.includes('notification'))) map.title = idx;
        else if (map.dueDate === undefined && h.includes('due')) map.dueDate = idx;
        else if (map.dateIssue === undefined && h.includes('date')) map.dateIssue = idx;
        else if (map.issuer === undefined && h === 'issued') map.issuer = idx;
        else if (map.correctiveAction === undefined && h.includes('corrective')) map.correctiveAction = idx;
        else if (map.pic === undefined && h === 'pic') map.pic = idx;
        else if (map.status === undefined && h.startsWith('stat')) map.status = idx;
        else if (map.remark === undefined && h.includes('remark')) map.remark = idx;
        else if (map.priority === undefined && (h.includes('skala') || h.includes('scale') || h.includes('prio'))) map.priority = idx;
    });
    return map;
}

// ==========================================
// RENDER TABEL PREVIEW SEBELUM DI-IMPORT
// ==========================================
function renderImportPreview() {
    const tbody = document.getElementById('import-preview-tbody');
    const summary = document.getElementById('import-summary');
    const previewWrap = document.getElementById('import-preview-wrap');
    const btnSubmit = document.getElementById('btn-import-submit');
    if (!tbody) return;

    const rows = state.importRows || [];

    if (rows.length === 0) {
        tbody.innerHTML = '';
        if (previewWrap) previewWrap.style.display = 'none';
        if (summary) summary.innerText = '';
        if (btnSubmit) btnSubmit.disabled = true;
        return;
    }

    let rowsHTML = '';
    rows.forEach((row, index) => {
        rowsHTML += `<tr>
            <td style="text-align:center;">${index + 1}</td>
            <td style="max-width:260px; white-space:normal;">${row.title}</td>
            <td style="white-space:nowrap;">${row.dueDate || '-'}</td>
            <td style="text-align:center;">${row.status}</td>
            <td style="text-align:center;">${row.priority}</td>
        </tr>`;
    });

    tbody.innerHTML = rowsHTML;
    if (previewWrap) previewWrap.style.display = 'flex';
    if (summary) summary.innerText = `${rows.length} row(s) ready to import.`;

    if (btnSubmit) btnSubmit.disabled = false;
}

// ==========================================
// EKSEKUSI IMPORT: LOOP CREATE + UPDATE PER BARIS
// ==========================================
export async function submitImportRows() {
    const department = DEFAULT_DEPARTMENT;

    const rows = state.importRows || [];
    if (rows.length === 0) return showCustomAlert("Warning", "No data to import. Please select an Excel file first.");

    const btnSubmit = document.getElementById('btn-import-submit');
    const progressEl = document.getElementById('import-progress');
    if (btnSubmit) btnSubmit.disabled = true;

    const currentUserId = localStorage.getItem('user_id');
    const currentUsername = localStorage.getItem('username') || '';
    let created = 0, failed = 0;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (progressEl) progressEl.innerText = `Importing... ${i + 1}/${rows.length}`;

        try {
            const createRes = await fetch(`${API_URL}/issue/create`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    title: row.title,
                    department,
                    description: row.correctiveAction || row.title,
                    issuedBy: String(currentUserId),
                    dueDate: row.dueDate || new Date().toISOString().split('T')[0],
                    priority: row.priority
                })
            });

            if (!createRes.ok) { failed++; continue; }
            created++;

            let createdIssue = null;
            try { createdIssue = await createRes.json(); } catch (e) { /* respons bukan JSON */ }
            const newId = createdIssue ? (createdIssue.id || (createdIssue.data && createdIssue.data.id)) : null;

            if (newId) {
                const remarkParts = [];
                if (row.dateIssueRaw) remarkParts.push(`Original Date Issue: ${row.dateIssueRaw}`);
                if (row.remark) remarkParts.push(row.remark);
                if (row.issuerRaw) remarkParts.push(`Original Issued (Excel): ${row.issuerRaw}`);
                if (row.picRaw) remarkParts.push(`Original PIC (Excel): ${row.picRaw}`);
                remarkParts.push(`[Imported via Excel by ${currentUsername}]`);

                const formData = new FormData();
                formData.append('status', row.status);
                formData.append('correctiveAction', row.correctiveAction || '');
                formData.append('remark', remarkParts.join(' | '));
                formData.append('picId', String(currentUserId));

                const headers = getAuthHeaders();
                delete headers['Content-Type'];

                try {
                    await fetch(`${API_URL}/issue/update/${newId}`, { method: 'PATCH', headers, body: formData });
                } catch (e) { /* baris tetap dianggap terbuat walau update lanjutan gagal */ }
            }
        } catch (error) {
            failed++;
        }
    }

    if (btnSubmit) btnSubmit.disabled = false;
    if (progressEl) progressEl.innerText = '';

    closeImportModal();
    await loadDashboardMD();

    showCustomAlert(
        failed > 0 ? "Import Finished with Issues" : "Success",
        `${created} of ${rows.length} issue(s) imported successfully. Issued By and PIC were both set to ${currentUsername}, Department set to ${department}.${failed > 0 ? ` ${failed} row(s) failed.` : ''}`
    );
}
