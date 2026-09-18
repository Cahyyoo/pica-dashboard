// js/issue-pdf.js
import { showCustomAlert, formatWitaDate, formatWitaDateTime, stripAutoForwardNotes, archiveMOMRecord, buildArchiveIssues, getBase64Image, reportActivity, saringIssueUntukEkspor, riwayatTerbaru, beriNapasUI } from './utils.js';
import { state } from './issue-state.js';
import { exportFilteredIssuesToExcel } from './issue-excel-export.js';

// =========================================================================
// PEMUAT jsPDF YANG MALAS (LAZY)
// =========================================================================
// jsPDF 410 KB + autotable 32 KB dulu dimuat lewat <script> di index.html, jadi ikut di-parse
// dan dieksekusi SETIAP boot -- termasuk di layar login -- padahal hanya dipakai saat menekan
// Export PDF. Sekarang disuntik saat pertama kali dibutuhkan.
// Janjinya disimpan supaya dua klik export beruntun tidak memuat dua kali, dan direset saat
// gagal supaya percobaan berikutnya boleh mencoba lagi.
let pemuatJsPDF = null;

function suntikScript(src) {
    return new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = src;
        el.onload = () => resolve();
        el.onerror = () => reject(new Error('Gagal memuat ' + src));
        document.head.appendChild(el);
    });
}

function pastikanJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
    if (!pemuatJsPDF) {
        // autotable WAJIB menyusul jsPDF, bukan paralel: plugin itu menempel ke prototype
        // jsPDF saat dieksekusi, jadi jsPDF harus sudah ada lebih dulu.
        pemuatJsPDF = suntikScript('./node_modules/jspdf/dist/jspdf.umd.min.js')
            .then(() => {
                window.jsPDF = window.jspdf.jsPDF; // nama lama, dipertahankan untuk jaga-jaga
                return suntikScript('./node_modules/jspdf-autotable/dist/jspdf.plugin.autotable.min.js');
            })
            .catch((err) => { pemuatJsPDF = null; throw err; });
    }
    return pemuatJsPDF;
}

export async function exportSingleIssueToPDF() {
    const userRole = localStorage.getItem('user_role');
    if (userRole !== 'MD' && userRole !== 'KTT') {
        return showCustomAlert("Access Denied", "Only Management (MD) is allowed to export PDF reports.");
    }

    const issue = state.detailIssue;
    if (!issue) return showCustomAlert("Error", "No report data found.");

    try {
        await pastikanJsPDF();
    } catch (e) {
        console.error(e);
        return showCustomAlert("Error", "Failed to load the PDF engine. Please restart the app.");
    }

    // Tampilkan dulu bahwa app sedang bekerja, lalu beri satu frame untuk melukisnya. Pembuatan
    // PDF di bawah sepenuhnya sinkron dan memblokir UI sampai selesai.
    showCustomAlert("Please Wait", "Preparing the report...");
    await beriNapasUI();

    const { jsPDF } = window.jspdf; 
    const doc = new jsPDF();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(21, 145, 220); 
    doc.text("PICA ISSUE REPORT", 14, 20);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    doc.text(`Generated Date: ${formatWitaDateTime(new Date())}`, 14, 26);

    doc.setDrawColor(229, 231, 235);
    doc.line(14, 30, 196, 30);

    const issuerUser = state.userById.get(String(issue.issuedBy));
    const issuerName = issuerUser ? issuerUser.username : `ID: ${issue.issuedBy}`;
    const picUser = state.userById.get(String(issue.picId));
    const picName = picUser ? picUser.username : 'Unassigned';

    const safeTitle = (issue.caseNotification || '').replace(/[^\x20-\x7E\n]/g, '');

    doc.autoTable({
        startY: 35,
        theme: 'plain',
        body: [
            ["Case / Title:", safeTitle],
            ["Report Date:", formatWitaDate(issue.createdAt)],
            ["Issued By (Reporter):", issuerName],
            ["Target Due Date:", formatWitaDate(issue.dueDate)],
            ["PIC Assigned:", picName],
            ["Priority Scale:", issue.priority],
            ["Category:", issue.category || '-'],
            ["Current Status:", issue.status],
        ],
        columnStyles: {
            0: { fontStyle: 'bold', cellWidth: 45, textColor: [107, 114, 128] },
            1: { textColor: [17, 24, 39] }
        }
    });

    let finalY = doc.lastAutoTable.finalY + 12;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(17, 24, 39);
    doc.text("Initial Description", 14, finalY);
    
    finalY += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(75, 85, 99);
    
    const safeDesc = (issue.description || '-').replace(/[^\x20-\x7E\n]/g, '');
    const splitDesc = doc.splitTextToSize(safeDesc, 182);
    doc.text(splitDesc, 14, finalY);

    finalY += (splitDesc.length * 5) + 12;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(17, 24, 39);
    doc.text("Corrective Action", 14, finalY);

    finalY += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(75, 85, 99);

    const safeCorrectiveAction = (issue.correctiveAction || '-').replace(/[^\x20-\x7E\n]/g, '');
    const splitCorrectiveAction = doc.splitTextToSize(safeCorrectiveAction, 182);
    doc.text(splitCorrectiveAction, 14, finalY);

    finalY += (splitCorrectiveAction.length * 5) + 12;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(17, 24, 39);
    doc.text("Progress & Status History", 14, finalY);

    const historyRows = [];
    if (issue.histories && issue.histories.length > 0) {
        issue.histories.forEach((h, index) => {
            const cleanedRemark = stripAutoForwardNotes(h.remark);
            let safeRemark = (cleanedRemark || '-').replace(/[^\x20-\x7E\n]/g, '') || '-';

            historyRows.push([
                index + 1,
                formatWitaDate(h.createdAt, 'en-GB', {day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'}),
                h.status,
                safeRemark
            ]);
        });
    } else {
        historyRows.push([{ content: "No progress updates yet.", colSpan: 4, styles: { halign: 'center', fontStyle: 'italic', textColor: [156, 163, 175] } }]);
    }

    doc.autoTable({
        startY: finalY + 4,
        head: [["No", "Date & Time", "Status", "Remarks / Notes"]],
        body: historyRows,
        headStyles: { fillColor: [21, 145, 220], textColor: [255, 255, 255], fontStyle: 'bold' },
        styles: { fontSize: 9 },
        theme: 'striped'
    });

    try {
        const { ipcRenderer } = window.require('electron');
        const pdfBase64 = doc.output('datauristring');
        const result = await ipcRenderer.invoke('simpan-pdf', pdfBase64, `PICA-Report-Detail-${issue.id}.pdf`);
        
        if (result.success) {
            showCustomAlert("Success", "PDF file has been successfully saved!");
            reportActivity('EXPORT_PDF_SINGLE', {
                targetType: 'issue',
                targetId: issue.id,
                targetLabel: issue.caseNotification,
                summary: 'Single-issue PDF exported',
            });
        }
        else if (!result.canceled) showCustomAlert("Error", "Failed to save the PDF file.");
    } catch (err) {
        console.error(err);
        showCustomAlert("Error", "A system communication error occurred.");
    }
}

// =========================================================================
// LOGIKA MODAL MANUAL INPUT MOM (OPTIMASI PERFORMA)
// =========================================================================

// 1. FUNGSI PRELOAD: Merakit 21 input secara diam-diam di latar belakang
// =========================================================================
// LOGIKA MODAL MANUAL INPUT MOM (FORM ABSENSI DINAMIS)
// =========================================================================

function preloadMOMInputs() {
    const container = document.getElementById('mom-participants-container');
    if (container && !document.getElementById('btn-add-participant')) {
        container.innerHTML = ''; // Bersihkan kontainer bawaan HTML
        container.style.display = 'block'; // Ubah layout utama
        
        // 1. Buat div pembungkus khusus untuk list peserta
        const listDiv = document.createElement('div');
        listDiv.id = 'dynamic-participants-list';
        listDiv.style.display = 'grid';
        listDiv.style.gridTemplateColumns = 'repeat(auto-fit, minmax(200px, 1fr))';
        listDiv.style.gap = '12px';
        listDiv.style.marginBottom = '16px';
        container.appendChild(listDiv);

        // 2. Buat tombol biru "+ Add Participant"
        const btnAdd = document.createElement('button');
        btnAdd.id = 'btn-add-participant';
        btnAdd.className = 'btn-sm';
        btnAdd.style.backgroundColor = '#1591DC';
        btnAdd.style.margin = '0';
        btnAdd.innerText = '+ Add Participant';
        btnAdd.onclick = () => window.addParticipantInput();
        container.appendChild(btnAdd);

        // 3. Masukkan peserta default (opsional, agar tidak kosong melompong saat dibuka)
        const defaultParticipants = ["", "", ""];
        defaultParticipants.forEach(name => window.addParticipantInput(name));
    }
}

// Fungsi global untuk menambah input kolom peserta baru
window.addParticipantInput = function(value = '') {
    const listDiv = document.getElementById('dynamic-participants-list');
    if (!listDiv) return;

    // Kunci maksimal 21 peserta agar grid PDF tidak rusak!
    if (listDiv.children.length >= 21) {
        return showCustomAlert("Warning", "Maximum 21 participants allowed to fit the PDF layout!");
    }

    const uniqueId = 'participant-' + Date.now() + Math.random().toString(36).substr(2, 5);
    const div = document.createElement('div');
    div.id = uniqueId;
    div.style.display = 'flex';
    div.style.alignItems = 'center';
    div.style.gap = '8px';
    div.style.background = '#f3f4f6';
    div.style.padding = '6px 12px';
    div.style.borderRadius = '6px';
    div.style.border = '1px solid #e5e7eb';

    div.innerHTML = `
        <span class="p-num" style="font-size:13px; font-weight:bold; color:#4b5563; min-width: 20px;"></span>
        <input type="text" class="mom-p-input" value="${value}" style="border: none; background: transparent; outline: none; width: 100%; font-size: 13px; color: #111827;" placeholder="Participant Name">
        <button onclick="window.removeParticipantInput('${uniqueId}')" style="background:none; border:none; color:#ef4444; cursor:pointer; font-weight:bold; font-size: 18px; padding: 0 4px;" title="Remove">&times;</button>
    `;
    
    listDiv.appendChild(div);
    window.updateParticipantNumbers(); // Rapikan nomor
};

// Fungsi global untuk menghapus baris peserta
window.removeParticipantInput = function(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
    window.updateParticipantNumbers(); // Rapikan ulang nomor saat ada yang dihapus
};

// Fungsi global untuk mengurutkan angka (1, 2, 3...)
window.updateParticipantNumbers = function() {
    const listDiv = document.getElementById('dynamic-participants-list');
    if (!listDiv) return;
    Array.from(listDiv.children).forEach((child, index) => {
        const numSpan = child.querySelector('.p-num');
        if (numSpan) numSpan.innerText = `${index + 1}.`;
    });
};

// CATATAN: dulu di sini ada `setTimeout(preloadMOMInputs, 2000)` di level modul, sehingga 2 detik
// setelah app dibuka form absensi MOM dirakit sendiri walau user tidak pernah menyentuh fitur
// export. Sekarang dipanggil dari openMOMModal() saja -- fungsinya memang idempoten (dijaga
// pemeriksaan #btn-add-participant), jadi aman dipanggil tiap kali modal dibuka.

// format: 'pdf' (default) atau 'excel' — menentukan tombol "Export PDF"/"Export Excel" mana
// di dashboard MD yang membuka modal ini, supaya submitMOMExport() tahu harus generate yang mana.
export function openMOMModal(format = 'pdf') {
    preloadMOMInputs();

    const dateInput = document.getElementById('mom-date');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

    const formatInput = document.getElementById('mom-export-format');
    if (formatInput) formatInput.value = format;

    const btnGenerate = document.getElementById('btn-mom-generate');
    if (btnGenerate) btnGenerate.innerText = format === 'excel' ? 'Generate Excel' : 'Generate PDF';

    document.getElementById('modal-mom-export').style.display = 'flex';
}

export function closeMOMModal() {
    document.getElementById('modal-mom-export').style.display = 'none';
}

export function submitMOMExport() {
    try {
        const notulen = document.getElementById('mom-notulen').value.trim();
        const chairman = document.getElementById('mom-chairman').value.trim();
        const date = document.getElementById('mom-date').value;
        const time = document.getElementById('mom-time').value.trim();
        const location = document.getElementById('mom-location').value.trim();

        if (!notulen || !chairman || !date || !time || !location) {
            return showCustomAlert("Warning", "Please complete Note Taker, Chairman, Date, Time, and Location before exporting.");
        }

        const momData = { notulen, chairman, date, time, location, participants: [] };

        // AMBIL DATA DARI SELURUH INPUT DINAMIS YANG ADA DI LAYAR
        const inputs = document.querySelectorAll('.mom-p-input');
        inputs.forEach(input => {
            if (input.value.trim() !== '') {
                momData.participants.push(input.value.trim());
            }
        });

        const formatInput = document.getElementById('mom-export-format');
        const format = formatInput ? formatInput.value : 'pdf';

        closeMOMModal();
        if (format === 'excel') exportFilteredIssuesToExcel('MD', momData);
        else exportFilteredIssuesToPDF('MD', momData);

    } catch (error) {
        console.error("Failed while generating export: ", error);
        showCustomAlert("Export Failed", "System error while retrieving form data: " + error.message);
    }
}

// =========================================================================
// FORMAT BARU: EXPORT MINUTES OF MEETING (MENERIMA DATA MANUAL)
// =========================================================================
export async function exportFilteredIssuesToPDF(role, momData = null) {
    const userRole = localStorage.getItem('user_role');
    if (userRole !== 'MD' && userRole !== 'KTT') {
        return showCustomAlert("Access Denied", "Only Management (MD) is allowed to export PDF reports.");
    }

    try {
        await pastikanJsPDF();
    } catch (e) {
        console.error(e);
        return showCustomAlert("Error", "Failed to load the PDF engine. Please restart the app.");
    }

    // Tampilkan dulu bahwa app sedang bekerja, lalu beri satu frame untuk melukisnya. Pembuatan
    // PDF di bawah sepenuhnya sinkron dan memblokir UI sampai selesai.
    showCustomAlert("Please Wait", "Preparing the report...");
    await beriNapasUI();

    const { jsPDF } = window.jspdf; 
    const doc = new jsPDF('l', 'mm', 'a4'); // Kertas A4 Landscape

    // ==========================================
    // DATA DEFAULT (JIKA momData KOSONG / BYPASS)
    // ==========================================
    const dNotulen = momData && momData.notulen ? momData.notulen : "P. Ikhsan";
    const dChairman = momData && momData.chairman ? momData.chairman : "P. Putu";
    const dTime = momData && momData.time ? momData.time : "13.30-15.30";
    const dLocation = momData && momData.location ? momData.location : "Site office molore";
    
    // Format Tanggal (Dari input Date HTML ke Format Lokal GB)
    let dDate = formatWitaDate(new Date());
    if (momData && momData.date) {
        dDate = formatWitaDate(momData.date);
    }

    // Peserta Default (Jika kosong)
    const defaultParticipants = ["", "", ""];
    // `participants` di database bertipe `Json?` (nullable, schema.prisma) dan arsip lama
    // bisa menyimpannya sebagai null. Dinormalkan SEKALI di sini supaya setiap pemakaian
    // di bawah aman. Dulu null lolos sampai ke dereferensi: jalur PDF melempar di dua
    // tempat dan jalur Excel di satu tempat lain -- untuk masukan yang sama persis.
    const pNames = momData
        ? (Array.isArray(momData.participants) ? momData.participants : [])
        : defaultParticipants;


    // ... (LOGIKA FILTERING DATA TABEL TETAP SAMA SEPERTI SEBELUMNYA) ...
    let filteredData = [];

    if (momData && momData.dataIssues) {
        filteredData = momData.dataIssues;
    }

    else if (role === 'MD') {
        // Semua filter -- TERMASUK kotak pencarian 'search-md' -- dibaca lewat satu
        // penyaring bersama di utils.js. Blok ini dulu disalin utuh di sini dan di
        // jalur satunya, dan keduanya sama-sama melewatkan kotak pencarian itu.
        filteredData = saringIssueUntukEkspor(state.globalIssues, state.globalUsers);
    }

    // Jalur Excel sudah punya penjaga ini; jalur PDF belum -- akibatnya MD yang
    // filternya tidak mencocokkan apa pun tetap mendapat PDF berisi tabel kosong,
    // dan (kalau ini ekspor MOM) tabel kosong itu ikut terarsip permanen.
    if (!filteredData || filteredData.length === 0) {
        return showCustomAlert("Warning", "No issues match the current filters. Adjust the filters before exporting.");
    }

    // ==========================================
    // MENGGAMBAR KOP "MINUTES OF MEETING" 
    // ==========================================
    doc.setLineWidth(0.5);
    doc.setDrawColor(0, 0, 0); 
    doc.rect(10, 10, 277, 25);
    doc.line(40, 10, 40, 35);   
    doc.line(227, 10, 227, 35); 

    // Logo & Judul (Versi Gambar)
    // Pastikan path ini sesuai dengan lokasi file logo Anda di folder project
    const logoBase64 = await getBase64Image('./public/img/logo_aspire.png'); 
    
    if (logoBase64) {
        // (Base64Data, Format, Posisi X, Posisi Y, Lebar, Tinggi)
        // Diberi padding 2mm agar posisinya pas di tengah kotak berukuran 30x25
        doc.addImage(logoBase64, 'PNG', 12, 12, 26, 21);
    } else {
        // Fallback: Jika gambar tidak ditemukan, kembalikan ke teks semula
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.setTextColor(33, 150, 243);
        doc.text("ASPIRE", 25, 21, { align: "center" });
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        doc.text("stargate", 25, 26, { align: "center" });
    }

    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("MINUTES OF MEETING", 133.5, 16, { align: "center" });
    doc.line(40, 19, 227, 19); 

    // Grid Peserta Rapat
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.line(40, 24.3, 227, 24.3);
    doc.line(40, 29.6, 227, 29.6);

    let startX = 40;
    const colWidth = 187 / 7;
    for (let i = 1; i < 7; i++) doc.line(startX + (colWidth * i), 19, startX + (colWidth * i), 35);
    
    // Tulis Nama Peserta dari Inputan
    let pIdx = 0;
    for (let col = 0; col < 7; col++) {
        for (let row = 0; row < 3; row++) {
            if (pIdx < 21) {
                const xPos = startX + (col * colWidth) + 1.5;
                const yPos = 23 + (row * 5.3);
                // Cetak format: "1 P. Putu"
                doc.text(`${pIdx + 1}  ${pNames[pIdx] || ''}`, xPos, yPos);
                pIdx++;
            }
        }
    }

    // Info Meeting dari Inputan
    doc.setFontSize(8);
    const infoX = 229;
    doc.text(`Note Taker: ${dNotulen}`, infoX, 14);
    doc.line(227, 15, 287, 15);
    doc.text(`Chairman  : ${dChairman}`, infoX, 19);
    doc.line(227, 20, 287, 20);
    doc.text(`Date      : ${dDate}`, infoX, 24);
    doc.line(227, 25, 287, 25);
    doc.text(`Time      : ${dTime}`, infoX, 29);
    doc.line(227, 30, 287, 30);
    doc.text(`Location  : ${dLocation}`, infoX, 34);

    // ==========================================
    // 3. MENYUSUN DATA TABEL (MEMBUAT LIST BERNOMOR)
    // ==========================================
    // Index user sekali (O(m)). Hanya dipakai untuk data live & arsip bentuk LAMA -- arsip
    // bentuk baru sudah membawa nama hasil resolusi, jadi tidak bergantung globalUsers.
    const userById = state.userById;

    const tableBody = filteredData.map((item, index) => {
        // Arsip bentuk BARU menyimpan nama (snapshot permanen); data live & arsip bentuk
        // LAMA menyimpan id yang perlu di-resolve saat render.
        let issuerName = item.issuerName;
        if (!issuerName) {
            const issuerUser = userById.get(String(item.issuedBy));
            issuerName = issuerUser ? issuerUser.username : `ID: ${item.issuedBy}`;
        }
        let picName = item.picName;
        if (!picName) {
            const picUser = userById.get(String(item.picId));
            picName = picUser ? picUser.username : '-';
        }
        const safeTitle = (item.caseNotification || '-').replace(/[^\x20-\x7E\n]/g, '');

        // Corrective Action sekarang diisi sekali di awal (saat issue dibuat), bukan per-history lagi.
        const correctiveActions = (item.correctiveAction || item.description || '-').replace(/[^\x20-\x7E\n]/g, '');

        // Remark cuma menampilkan update PALING AKHIR (bukan gabungan seluruh riwayat) — riwayat
        // lengkapnya tetap bisa dilihat di timeline "Progress & Status History" halaman detail issue.
        // Arsip bentuk BARU sudah menyimpan hasil akhirnya di latestRemark, jadi seluruh
        // array histories tidak perlu ikut disimpan. Bentuk LAMA dihitung seperti semula.
        let remarks = "-";
        if (typeof item.latestRemark === 'string') {
            if (item.latestRemark) remarks = item.latestRemark.replace(/[^\x20-\x7E\n]/g, '');
        } else if (item.histories && item.histories.length > 0) {
            const latestHistory = riwayatTerbaru(item.histories);
            const cleanedRemark = stripAutoForwardNotes(latestHistory.remark);
            if (cleanedRemark) remarks = cleanedRemark.replace(/[^\x20-\x7E\n]/g, '');
        }

        return [
            index + 1,
            safeTitle,
            formatWitaDate(item.createdAt, 'en-US'), // Format M/D/YYYY
            issuerName,
            correctiveActions,
            picName,
            formatWitaDate(item.dueDate, 'en-US'),
            item.status,
            remarks,
            item.category || '-',
            item.priority || 'Prio 2'
        ];
    });

    // ==========================================
    // 4. MENGGAMBAR TABEL AUTOTABLE
    // ==========================================
    doc.autoTable({
        startY: 38, // Mulai tepat di bawah kop tabel
        margin: { left: 10, right: 10 },
        head: [["No", "Case/Notification", "Date Issued", "Issued", "Corrective Action", "PIC", "Due Date", "Status", "Remark", "Category", "SCALE"]],
        body: tableBody,
        theme: 'grid',
        headStyles: {
            fillColor: [255, 255, 255],
            textColor: [0, 0, 0],
            fontStyle: 'bold',
            halign: 'center',
            valign: 'middle',
            lineWidth: 0.5,
            lineColor: [0, 0, 0] // Garis hitam solid
        },
        styles: {
            fontSize: 8,
            textColor: [0, 0, 0],
            lineWidth: 0.5,
            lineColor: [0, 0, 0], // Garis hitam untuk semua kotak
            valign: 'middle'
        },
        columnStyles: {
            0: { halign: 'center', cellWidth: 10 },
            1: { cellWidth: 52 },
            2: { halign: 'center', cellWidth: 16 },
            3: { halign: 'center', cellWidth: 14 },
            4: { cellWidth: 48 }, // Corrective Action Lebar
            5: { halign: 'center', cellWidth: 22 },
            6: { halign: 'center', cellWidth: 16 },
            7: { halign: 'center', cellWidth: 14, fontStyle: 'bold' }, // Status
            8: { cellWidth: 48 }, // Remark Lebar
            9: { halign: 'center', cellWidth: 18, fontStyle: 'bold' }, // Category
            10: { halign: 'center', cellWidth: 19, fontStyle: 'bold' }  // SKALA
        },
        didParseCell: function (data) {
            if (data.section === 'body') {
                // WARNAI KOLOM STATUS (Kolom ke-7) -> Biru Muda
                if (data.column.index === 7) {
                    data.cell.styles.fillColor = [0, 176, 240];
                }

                // WARNAI KOLOM CATEGORY (Kolom ke-9) -> Hijau Muda
                if (data.column.index === 9) {
                    data.cell.styles.fillColor = [220, 252, 231];
                    data.cell.styles.textColor = [21, 128, 61];
                }

                // WARNAI KOLOM SKALA/PRIO (Kolom ke-10)
                if (data.column.index === 10) {
                    const prioText = data.cell.raw.toString().toLowerCase();
                    if (prioText.includes('1') || prioText.includes('high')) {
                        // Prio 1 -> Background Merah Muda / Teks Merah
                        data.cell.styles.fillColor = [255, 204, 204]; 
                        data.cell.styles.textColor = [180, 0, 0];
                    } else if (prioText.includes('2') || prioText.includes('medium')) {
                        // Prio 2 -> Background Kuning / Teks Oren
                        data.cell.styles.fillColor = [255, 255, 153]; 
                        data.cell.styles.textColor = [180, 100, 0];
                    } else {
                        // Lainnya -> Hijau
                        data.cell.styles.fillColor = [204, 255, 204]; 
                        data.cell.styles.textColor = [0, 100, 0];
                    }
                }
            }
        }
    });

    // ==========================================
    // 5. BUNGKUS DATA & SIMPAN KE PDF DAN DATABASE
    // ==========================================
    const archiveObject = {
        tanggalExport: new Date().toISOString(),
        notulen: dNotulen,
        chairman: dChairman,
        date: dDate,
        time: dTime,
        location: dLocation,
        participants: pNames.filter(name => name && name.trim() !== ''), // Hapus peserta kosong
        // Dirampingkan dulu: buang histories, simpan remark terakhir yang sudah dihitung.
        dataIssues: buildArchiveIssues(filteredData, userById)
    };

    try {
        // A. Simpan PDF ke Windows secara lokal
        const { ipcRenderer } = window.require('electron');
        const pdfBase64 = doc.output('datauristring');
        const result = await ipcRenderer.invoke('simpan-pdf', pdfBase64, `Minutes_Of_Meeting_${new Date().getTime()}.pdf`);
        
        if (result.success) {
            
            // Jika ini proses download ulang, jangan simpan ke DB lagi!
            if (momData && momData.isArchive) {
                showCustomAlert("Success", "Archived PDF file has been successfully downloaded!");
                reportActivity('EXPORT_MOM_REDOWNLOAD', {
                    targetType: 'mom',
                    changes: { format: 'pdf', issueCount: filteredData.length },
                    summary: 'Archived MOM re-downloaded as PDF',
                });
                return; 
            }

            // B. JIKA PDF BARU SUKSES DISIMPAN, KIRIM DATA KE BACKEND (NESTJS)
            const archived = await archiveMOMRecord(archiveObject);

            if (archived) {
                showCustomAlert("Success", "PDF exported & Archive successfully saved to server!");
            } else {
                showCustomAlert("Warning", "PDF exported, but failed to save archive to server.");
            }

        } else if (!result.canceled) {
            showCustomAlert("Error", "Failed to save the PDF file to local storage.");
        }
    } catch (err) {
        console.error("System Error: ", err);
        showCustomAlert("Error", "A system error occurred while trying to export.");
    }
}
