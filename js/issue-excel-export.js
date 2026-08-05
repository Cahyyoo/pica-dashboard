// js/issue-excel-export.js
// FITUR: EXPORT MINUTES OF MEETING (MD) KE FILE EXCEL (.xlsx) — MENIRU LAYOUT ASLI
// (kop logo + judul + grid peserta + info meeting, lalu tabel issue berwarna) yang dipakai
// di export PDF (js/issue-pdf.js) DAN template Excel MOM referensi yang sudah ada.
//
// Dipakai library `exceljs` (BUKAN `xlsx`/SheetJS) karena SheetJS Community Edition yang
// terpasang di project TIDAK bisa menulis warna cell/border/gambar ke file .xlsx (fitur itu
// cuma ada di SheetJS Pro yang berbayar) — sudah dites langsung, style yang diset lewat
// `.s` selalu diam-diam dibuang saat file disimpan. `exceljs` open-source/MIT dan mendukung
// penuh fill color, border, font, dan embed gambar, sehingga hasil Excel-nya bisa benar-benar
// mirip export PDF.
import { showCustomAlert, formatWitaDate, stripAutoForwardNotes, archiveMOMRecord, getBase64Image } from './utils.js';
import { state } from './issue-state.js';

function getExcelJS() {
    try {
        return window.require('exceljs');
    } catch (e) {
        return null;
    }
}

const THIN_BORDER = { style: 'thin', color: { argb: 'FF000000' } };
const ALL_BORDERS = { top: THIN_BORDER, left: THIN_BORDER, bottom: THIN_BORDER, right: THIN_BORDER };

// Kolom tabel issue: 11 kolom (No..SKALA), sama persis urutannya dengan export PDF.
const TABLE_COLS = ['No', 'Case/Notification', 'Date Issue', 'Issued', 'Corrective Action', 'PIC', 'Due Date', 'Stat', 'Remark', 'Category', 'SKALA'];
const COL_WIDTHS = [5, 32, 12, 13, 36, 14, 12, 12, 36, 12, 10];

function colorForCategory() {
    return { fill: 'FFDCFCE7', font: 'FF15803D' }; // hijau muda, sama seperti badge Category di app & PDF
}

function colorForPriority(priority) {
    const p = String(priority || '').toLowerCase();
    if (p.includes('1') || p.includes('high')) return { fill: 'FFFFCCCC', font: 'FFB40000' };   // Prio 1: merah muda
    if (p.includes('2') || p.includes('medium')) return { fill: 'FFFFFF99', font: 'FFB46400' };  // Prio 2: kuning
    return { fill: 'FFCCFFCC', font: 'FF006400' };                                               // lainnya: hijau
}

// Perkiraan jumlah baris teks setelah word-wrap, supaya row height cukup untuk menampung
// Corrective Action / Remark yang panjang (sama seperti doc.splitTextToSize() di export PDF).
function estimateWrappedLines(text, colWidthChars) {
    if (!text) return 1;
    return text.split('\n').reduce((total, line) => {
        return total + Math.max(1, Math.ceil(line.length / (colWidthChars * 1.6)));
    }, 0);
}

export async function exportFilteredIssuesToExcel(role, momData = null) {
    const userRole = localStorage.getItem('user_role');
    if (userRole !== 'MD' && userRole !== 'KTT') {
        return showCustomAlert("Access Denied", "Only Management (MD) is allowed to export Excel reports.");
    }

    const ExcelJS = getExcelJS();
    if (!ExcelJS) return showCustomAlert("Error", "Excel library failed to load.");

    // ==========================================
    // DATA DEFAULT (JIKA momData KOSONG / BYPASS) — sama seperti exportFilteredIssuesToPDF
    // ==========================================
    const dNotulen = momData && momData.notulen ? momData.notulen : "P. Ikhsan";
    const dChairman = momData && momData.chairman ? momData.chairman : "P. Putu";
    const dTime = momData && momData.time ? momData.time : "13.30-15.30";
    const dLocation = momData && momData.location ? momData.location : "Site office molore";

    let dDate = formatWitaDate(new Date());
    if (momData && momData.date) dDate = formatWitaDate(momData.date);

    const defaultParticipants = ["", "", ""];
    const pNames = momData ? momData.participants : defaultParticipants;

    // ==========================================
    // LOGIKA FILTERING DATA TABEL — SAMA PERSIS SEPERTI exportFilteredIssuesToPDF
    // ==========================================
    let filteredData = [];

    if (momData && momData.dataIssues) {
        filteredData = momData.dataIssues;
    } else if (role === 'MD') {
        const statusFilter = document.getElementById('filter-status-md').value;
        const scaleFilter = document.getElementById('filter-scale-md').value;
        const categoryFilter = document.getElementById('filter-category-md').value;
        const startDateFilter = document.getElementById('filter-date-start-md').value;
        const endDateFilter = document.getElementById('filter-date-end-md').value;

        filteredData = state.globalIssues.filter(item => {
            const matchStatus = (statusFilter === 'All') ? (item.status !== 'Closed') : (item.status === statusFilter);
            const matchScale = (scaleFilter === 'All') || (item.priority === scaleFilter);
            const matchCategory = (categoryFilter === 'All') || (item.category === categoryFilter);
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
            return matchStatus && matchScale && matchCategory && matchDate;
        });
    }

    if (filteredData.length === 0) {
        return showCustomAlert("Warning", "No issues match the current filters. Adjust the filters before exporting.");
    }

    const cleanParticipants = (pNames || []).filter(name => name && name.trim() !== '');

    // ==========================================
    // BANGUN WORKBOOK
    // ==========================================
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Minutes of Meeting', { views: [{ showGridLines: false }] });

    COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    // ------------------------------------------
    // BARIS 1-5: KOP "MINUTES OF MEETING" (logo | judul + grid peserta | info meeting)
    // Meniru geometri kop di export PDF: kotak logo (kolom A:B), judul + grid peserta 7 kolom
    // (kolom C:I), dan kotak info Notulen/Chairman/Date/Time/Location (kolom J:K).
    // ------------------------------------------
    ws.mergeCells('A1:B4');
    const logoCell = ws.getCell('A1');
    logoCell.border = ALL_BORDERS;
    logoCell.alignment = { horizontal: 'center', vertical: 'middle' };

    const logoBase64 = await getBase64Image('./public/img/logo_aspire.png');
    if (logoBase64) {
        const imageId = workbook.addImage({ base64: logoBase64, extension: 'png' });
        ws.addImage(imageId, { tl: { col: 0.15, row: 0.15 }, ext: { width: 90, height: 88 } });
    } else {
        logoCell.value = 'ASPIRE\nstargate';
        logoCell.font = { bold: true, size: 11, color: { argb: 'FF2196F3' } };
        logoCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    }

    ws.mergeCells('C1:I1');
    const titleCell = ws.getCell('C1');
    titleCell.value = 'MINUTES OF MEETING';
    titleCell.font = { bold: true, size: 13 };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    for (let c = 3; c <= 9; c++) ws.getCell(1, c).border = ALL_BORDERS;

    // Grid peserta: 7 kolom (C..I) x 3 baris (2,3,4) = 21 slot, urutan diisi PER KOLOM
    // (kolom pertama slot 1-3, kolom kedua slot 4-6, dst) — sama persis seperti export PDF.
    for (let colIdx = 0; colIdx < 7; colIdx++) {
        for (let rowIdx = 0; rowIdx < 3; rowIdx++) {
            const participantIndex = colIdx * 3 + rowIdx;
            const cell = ws.getCell(2 + rowIdx, 3 + colIdx);
            cell.value = `${participantIndex + 1}  ${pNames[participantIndex] || ''}`;
            cell.font = { size: 8 };
            cell.alignment = { horizontal: 'left', vertical: 'middle' };
            cell.border = ALL_BORDERS;
        }
    }

    // Kotak info meeting (Notulen/Chairman/Date/Time/Location) — kolom J:K, baris 1-5
    const infoRows = [
        ['Notulen', dNotulen],
        ['Chairman', dChairman],
        ['Date', dDate],
        ['Time', dTime],
        ['Location', dLocation],
    ];
    infoRows.forEach(([label, value], i) => {
        const rowNum = i + 1;
        ws.mergeCells(rowNum, 10, rowNum, 11); // J:K
        const cell = ws.getCell(rowNum, 10);
        cell.value = `${label}\t: ${value}`;
        cell.font = { size: 9 };
        cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
        cell.border = ALL_BORDERS;
    });

    for (let r = 1; r <= 4; r++) { ws.getRow(r).height = 20; }
    ws.getRow(5).height = 18;

    // Baris 6 dibiarkan kosong sebagai spacer sebelum tabel issue
    ws.getRow(6).height = 8;

    // ------------------------------------------
    // TABEL ISSUE — mulai baris 7 (header) — kolom & warna sama persis dengan export PDF
    // ------------------------------------------
    const headerRowNum = 7;
    const headerRow = ws.getRow(headerRowNum);
    TABLE_COLS.forEach((label, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = label;
        cell.font = { bold: true };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = ALL_BORDERS;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    });
    headerRow.height = 22;
    ws.autoFilter = { from: { row: headerRowNum, column: 1 }, to: { row: headerRowNum, column: TABLE_COLS.length } };

    filteredData.forEach((item, index) => {
        const issuerUser = state.globalUsers.find(u => String(u.id) === String(item.issuedBy));
        const issuerName = issuerUser ? issuerUser.username : `ID: ${item.issuedBy}`;
        const picUser = state.globalUsers.find(u => String(u.id) === String(item.picId));
        const picName = picUser ? picUser.username : '-';

        const correctiveActions = item.correctiveAction || item.description || '-';

        // Remark cuma menampilkan update PALING AKHIR (bukan gabungan seluruh riwayat) — riwayat
        // lengkapnya tetap bisa dilihat di timeline "Progress & Status History" halaman detail issue.
        let remarks = '-';
        if (item.histories && item.histories.length > 0) {
            const latestHistory = [...item.histories].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
            const cleanedRemark = stripAutoForwardNotes(latestHistory.remark);
            if (cleanedRemark) remarks = cleanedRemark;
        }

        const rowValues = [
            index + 1,
            item.caseNotification || '-',
            formatWitaDate(item.createdAt, 'en-US'),
            issuerName,
            correctiveActions,
            picName,
            formatWitaDate(item.dueDate, 'en-US'),
            item.status,
            remarks,
            item.category || '-',
            item.priority || 'Prio 2'
        ];

        const excelRow = ws.getRow(headerRowNum + 1 + index);
        rowValues.forEach((val, i) => {
            const cell = excelRow.getCell(i + 1);
            cell.value = val;
            cell.border = ALL_BORDERS;
            cell.alignment = { vertical: 'middle', wrapText: true, horizontal: (i === 0 || i === 7 || i === 9 || i === 10) ? 'center' : 'left' };
        });

        // WARNAI KOLOM "Stat" (index 7) -> Biru muda, sama seperti export PDF
        const statCell = excelRow.getCell(8);
        statCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B0F0' } };
        statCell.font = { bold: true };

        // WARNAI KOLOM "Category" (index 9) -> Hijau muda
        const catColor = colorForCategory();
        const catCell = excelRow.getCell(10);
        catCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: catColor.fill } };
        catCell.font = { bold: true, color: { argb: catColor.font } };

        // WARNAI KOLOM "SKALA" (index 10) -> sesuai prioritas
        const prioColor = colorForPriority(item.priority);
        const prioCell = excelRow.getCell(11);
        prioCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: prioColor.fill } };
        prioCell.font = { bold: true, color: { argb: prioColor.font } };

        const maxLines = Math.max(
            estimateWrappedLines(correctiveActions, COL_WIDTHS[4]),
            estimateWrappedLines(remarks, COL_WIDTHS[8]),
            estimateWrappedLines(item.caseNotification, COL_WIDTHS[1]),
            1
        );
        excelRow.height = Math.min(120, Math.max(20, maxLines * 14));
    });

    // ==========================================
    // BUNGKUS DATA ARSIP — SAMA PERSIS DENGAN exportFilteredIssuesToPDF
    // ==========================================
    const archiveObject = {
        tanggalExport: new Date().toISOString(),
        notulen: dNotulen,
        chairman: dChairman,
        date: dDate,
        time: dTime,
        location: dLocation,
        participants: cleanParticipants,
        dataIssues: filteredData
    };

    try {
        const buffer = await workbook.xlsx.writeBuffer();
        const base64 = arrayBufferToBase64(buffer);
        const { ipcRenderer } = window.require('electron');
        const dataUri = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`;
        const result = await ipcRenderer.invoke('simpan-file', dataUri, `Minutes_Of_Meeting_${new Date().getTime()}.xlsx`, {
            title: 'Save Excel Export',
            filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
        });

        if (result.success) {
            // Jika ini proses download ulang dari Arsip MOM, jangan simpan ke DB lagi!
            if (momData && momData.isArchive) {
                showCustomAlert("Success", "Archived Excel file has been successfully downloaded!");
                return;
            }

            const archived = await archiveMOMRecord(archiveObject);
            if (archived) {
                showCustomAlert("Success", "Excel exported & Archive successfully saved to server!");
            } else {
                showCustomAlert("Warning", "Excel exported, but failed to save archive to server.");
            }
        } else if (!result.canceled) {
            showCustomAlert("Error", "Failed to save the Excel file to local storage.");
        }
    } catch (err) {
        console.error("System Error: ", err);
        showCustomAlert("Error", "A system error occurred while trying to export.");
    }
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}
