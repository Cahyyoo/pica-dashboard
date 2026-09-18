// js/issue-detail.js
import { API_URL, getAuthHeaders } from './config.js';
import { showView, getStatusBadge, formatWitaDate, escapeHtml, isEditableLastUpdate, showCustomAlert } from './utils.js';
import { state } from './issue-state.js';

// Berapa entri riwayat yang digambar lebih dulu di layar detail; sisanya menyusul lewat tombol.
// 20 dipilih karena sudah lebih panjang dari tinggi panel timeline di kiosk 1366x768, jadi pada
// issue biasa tidak ada yang berubah sama sekali. Yang terbantu adalah issue berumur panjang
// dengan ratusan entri, yang dulu dibangun ulang SELURUHNYA tiap klik Next/Prev.
const TIMELINE_AWAL = 20;

// Direset setiap openDetailView() supaya pindah issue selalu mulai dari tampilan ringkas.
// Kalau dibiarkan menempel, satu klik "show older" akan memperlambat setiap issue berikutnya
// yang dibuka lewat Next/Prev.
let timelinePenuh = false;

// Mengambil issue-nya sendiri lewat GET /issue/:id. Pada backend 2.3.0 daftar /issue hanya
// membawa SATU riwayat terbaru per issue -- cukup untuk tabel, lencana, kunci logout, dan
// remark terakhir di ekspor -- sementara linimasa di layar ini butuh seluruh riwayat.
//
// TAPI backend 2.2.0 (yang masih melayani produksi) tidak punya rute itu sama sekali, dan
// daftarnya justru membawa riwayat LENGKAP setiap issue. Karena itu fungsi ini mengenali
// backend mana yang sedang dilayani, lalu membaca dari daftar kalau perlu. Tanpa itu, beda
// versi backend membuat layar ini buntu tanpa penjelasan apa pun.

// Toast mode kompatibilitas hanya sekali per sesi -- kalau tiap membuka detail, ia berubah
// dari informasi jadi gangguan.
let modeLamaSudahDiberitahu = false;

function beritahuModeLama() {
    if (modeLamaSudahDiberitahu) return;
    modeLamaSudahDiberitahu = true;
    console.warn('Backend tidak menyediakan GET /issue/:id (versi 2.2.0). Detail dibaca dari '
               + 'daftar issue, dan Edit this update dinonaktifkan.');
    showCustomAlert("Compatibility Mode",
        "Running against an older backend \u2014 'Edit this update' is unavailable.");
}
export async function openDetailView(id) {
    state.currentDetailId = id;
    timelinePenuh = false;

    let issue = null;

    // Sekali terbukti backend lama, rute itu tidak diketuk lagi: menghemat satu round-trip per
    // pembukaan detail dan tidak membanjiri log server dengan 404.
    if (state.backendPunyaDetail !== false) {
        try {
            const res = await fetch(`${API_URL}/issue/${id}`, { headers: getAuthHeaders() });
            if (res.ok) {
                issue = await res.json();
                state.backendPunyaDetail = true;
            } else if (res.status === 404) {
                // Dua 404 dengan arti BERLAWANAN, dan hanya bisa dibedakan dari bodinya:
                //   "Cannot GET /issue/12"  -> 404 bawaan NestJS, RUTE-nya tidak terdaftar
                //   "Issue tidak ditemukan" -> NotFoundException, ISSUE-nya yang tidak ada
                // Hanya yang pertama boleh memicu fallback. Kalau keduanya disamakan, membuka
                // issue yang baru saja dihapus akan diam-diam menampilkan data basi dari daftar
                // alih-alih memberi tahu bahwa issue-nya sudah tidak ada.
                const body = await res.json().catch(() => ({}));
                state.backendPunyaDetail = !String(body.message || '').startsWith('Cannot GET');
            }
        } catch (e) {
            // Galat jaringan tidak memberi tahu apa pun tentang VERSI backend, jadi penandanya
            // sengaja dibiarkan apa adanya -- jangan sampai WiFi yang putus sesaat memvonis
            // backend baru sebagai backend lama untuk sisa sesi.
            console.error('Gagal memuat detail issue:', e);
        }
    }

    if (!issue && state.backendPunyaDetail === false) {
        // Di backend 2.2.0 daftar /issue membawa SELURUH riwayat setiap issue (diukur langsung
        // di produksi: 83 dari 97 issue punya lebih dari satu entri, terbanyak 69). Jadi
        // linimasanya utuh -- kekhawatiran "daftar cuma bawa satu riwayat" hanya berlaku untuk
        // backend 2.3.0. Ini juga persis perilaku rilis 2.2.1 sebelum endpoint detail ada.
        issue = state.globalIssues.find(i => i.id === id) || null;
        if (issue) beritahuModeLama();
    }

    if (!issue) {
        state.detailIssue = null;
        return showCustomAlert("Error", "Failed to load issue detail. Check your connection and try again.");
    }
    state.detailIssue = issue;
    
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
        const issuerUser = state.userById.get(String(issue.issuedBy));
        issuerName = issuerUser ? issuerUser.username : `ID: ${issue.issuedBy}`;
    }
    const role = localStorage.getItem('user_role');
    const elIssuer = document.getElementById('detail-issuer');
    if (elIssuer) {
        if (role === 'MD') {
            elIssuer.innerHTML = `<span style="cursor:pointer; border-bottom: 1px dashed #1591DC;" onclick="openEditAssignmentModal(${issue.id}, ${issue.picId || 'null'}, ${issue.issuedBy || 'null'})" title="Edit Assignment">${escapeHtml(issuerName)} ✏️</span>`;
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

    const picUser = state.userById.get(String(issue.picId));
    const picName = picUser ? picUser.username : 'Unassigned';

    const elPic = document.getElementById('detail-pic');
    if (elPic) {
        if (role === 'MD') {
            elPic.innerHTML = `<span style="cursor:pointer; color:#0ea5e9; border-bottom: 1px dashed #0ea5e9;" onclick="openEditAssignmentModal(${issue.id}, ${issue.picId || 'null'}, ${issue.issuedBy || 'null'})" title="Edit Assignment">${escapeHtml(picName)} ✏️</span>`;
        } else {
            elPic.innerText = picName;
        }
    }

    document.getElementById('detail-desc').innerText = issue.description || '-';
    document.getElementById('detail-corrective-action').innerText = issue.correctiveAction || '-';
    document.getElementById('detail-status').innerHTML = getStatusBadge(issue.status);
    document.getElementById('detail-prio').innerHTML = `<span class="badge badge-prio">${escapeHtml(issue.priority)}</span>`;

    const elCategory = document.getElementById('detail-category');
    if (elCategory) {
        const categoryText = issue.category || '-';
        if (role === 'MD') {
            elCategory.innerHTML = `<span style="cursor:pointer; color:#16a34a; border-bottom: 1px dashed #16a34a;" onclick="openCategoryModal(${issue.id}, '${issue.category || 'Daily'}')" title="Change Category">${escapeHtml(categoryText)} ✏️</span>`;
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

    // (id yang benar adalah 'btn-export-single' -- sebelumnya salah tulis 'btn-detail-export'
    // sehingga toggle visibility ini tidak pernah berjalan sama sekali)
    const btnExport = document.getElementById('btn-export-single');
    if (btnExport) btnExport.style.display = (role === 'MD' || role === 'KTT') ? 'block' : 'none';

    // Edit & Delete Issue: khusus MD
    const btnEdit = document.getElementById('btn-detail-edit');
    if (btnEdit) btnEdit.style.display = (role === 'MD') ? 'block' : 'none';

    const btnDelete = document.getElementById('btn-detail-delete');
    if (btnDelete) btnDelete.style.display = (role === 'MD') ? 'block' : 'none';

    gambarTimeline(issue);
    showView('view-issue-detail');
}

// =========================================================
// RENDER TIMELINE & TOMBOL ATTACHMENT (LAMPIRAN FILE)
// =========================================================
// Dipisah dari openDetailView() supaya tombol "show older" bisa menggambar ulang TANPA
// menembak jaringan lagi -- seluruh riwayatnya sudah ada di tangan.
function gambarTimeline(issue) {
    const timelineContainer = document.getElementById('detail-timeline');
    if (!issue.histories || issue.histories.length === 0) {
        timelineContainer.innerHTML = `<div style="color:#9ca3af; font-size:13px; font-style:italic;">No actions have been taken yet.</div>`;
    } else {
        // Kumpulkan seluruh entri timeline ke satu string lalu assign SEKALI.
        // Ini lokasi paling kritis untuk pola tersebut: satu issue yang di-update harian
        // selama setahun punya ~250 histori, dan render ini terulang tiap klik Next/Prev
        // di halaman detail. Dengan `innerHTML +=` biayanya O(n^2).
        // Mengumpulkan ke satu string sudah menghilangkan O(n^2), tapi 250 entri TETAP berarti
        // 250 blok DOM dibangun ulang setiap klik Next/Prev. Jadi hanya sebagian dirender dulu.
        const semuaHist = issue.histories;
        const perluDipotong = !timelinePenuh && semuaHist.length > TIMELINE_AWAL;

        // Urutan riwayat dari backend TIDAK dipercaya -- isEditableLastUpdate() pun menghitung
        // entri terbaru sendiri alih-alih mengandalkan posisi. Jadi ujung mana yang "lama"
        // ditentukan dari stempel waktunya, lalu SELALU ujung lama itu yang disembunyikan,
        // sehingga urutan tampil yang sudah dikenal user tidak berubah sedikit pun. Entri
        // terbaru -- satu-satunya yang bisa punya tombol Edit -- karenanya selalu ikut tampil.
        let daftarTampil = semuaHist;
        let tersembunyi = 0;
        let lamaDiAwal = false;
        if (perluDipotong) {
            const tAwal = new Date(semuaHist[0].createdAt).getTime();
            const tAkhir = new Date(semuaHist[semuaHist.length - 1].createdAt).getTime();
            lamaDiAwal = !(tAwal > tAkhir);   // NaN pun jatuh ke sini: potong dari depan
            tersembunyi = semuaHist.length - TIMELINE_AWAL;
            daftarTampil = lamaDiAwal ? semuaHist.slice(tersembunyi) : semuaHist.slice(0, TIMELINE_AWAL);
        }

        let timelineHTML = '';
        daftarTampil.forEach((hist) => {
            const updateStr = formatWitaDate(hist.createdAt, 'en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            const remarkHTML = hist.remark ? `<p class="timeline-remark">${escapeHtml(hist.remark)}</p>` : `<p class="timeline-remark" style="color:#9ca3af; font-style:italic;">No additional remarks.</p>`;

            // An edited entry says so. Without this the timeline would quietly present
            // corrected text as if it were what was originally written.
            const editedHTML = hist.editedAt
                ? `<span class="badge badge-exempt" style="font-size:10px; padding:2px 8px; margin-left:8px;">edited ${formatWitaDate(hist.editedAt, 'en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>`
                : '';

            // Only ever on the newest entry, and only when the request would actually succeed.
            const editBtnHTML = isEditableLastUpdate(issue, hist)
                ? `<button type="button" class="btn-sm btn-secondary" style="margin-top:10px;" onclick="openEditUpdateModal(${hist.id}); return false;">Edit this update</button>`
                : '';
            
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

            timelineHTML += `
                <div class="timeline-item" data-history-id="${hist.id}">
                    <div class="timeline-date">
                        <span style="display:flex; gap:8px; align-items:center;">Update: ${getStatusBadge(hist.status)}${editedHTML}</span>
                        <span style="color:#1591DC;">${updateStr}</span>
                    </div>
                    <div class="">
                        ${remarkHTML}
                        ${attachmentHTML}
                        ${editBtnHTML}
                    </div>
                </div>`;
        });

        // Tombolnya diletakkan tepat di ujung yang dipotong, supaya arah "lebih lama" terbaca
        // sesuai urutan yang sedang tampil.
        if (perluDipotong) {
            const tombol = `<button type="button" class="btn-sm btn-secondary" style="margin: 8px 0;"`
                + ` onclick="tampilkanSeluruhRiwayat(); return false;">Show ${tersembunyi} older update(s)</button>`;
            timelineHTML = lamaDiAwal ? tombol + timelineHTML : timelineHTML + tombol;
        }

        timelineContainer.innerHTML = timelineHTML;
    }
}

export function backFromDetail() {
    const role = localStorage.getItem('user_role');
    // KTT juga akan dikembalikan ke layar tabel monitoring
    if (role === 'MD' || role === 'KTT') showView('view-md'); 
    // window.showView (bukan showView impor): versi window itu yang memicu
    // loadDashboardPIC(). Dengan showView polos, kembali dari detail TIDAK memuat ulang
    // tabel -- PIC yang baru saja mengisi update akan melihat badge "Not Updated" basi
    // dan mengira simpanannya gagal. Rute PIC satu-satunya yang perlu ini; MD sudah
    // memuat ulang sendiri di dalam handler simpannya.
    else if (role === 'Dept Head') window.showView('view-pic-update');
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
export async function navigateIssue(direction) {
    const currentIndex = state.currentIssueIds.indexOf(state.currentDetailId);
    if (currentIndex === -1) return; // Mencegah error jika ID tidak ditemukan

    const nextIndex = currentIndex + direction;
    
    // Pastikan index baru tidak keluar dari batas array
    if (nextIndex >= 0 && nextIndex < state.currentIssueIds.length) {
        const nextId = state.currentIssueIds[nextIndex];
        
        // Buka detail yang baru (ini akan otomatis me-render ulang seluruh halaman detail)
        await openDetailView(nextId); 
    }
}

// WAJIB: Ekspos fungsi ke global agar bisa dipanggil dari HTML onclick
window.navigateIssue = navigateIssue;

// Menggambar ulang panel riwayat dengan seluruh entri. Sengaja TIDAK memanggil openDetailView()
// lagi: itu akan menembak jaringan untuk data yang sudah dipegang, dan mereset penanda di bawah.
window.tampilkanSeluruhRiwayat = function () {
    timelinePenuh = true;
    if (state.detailIssue) gambarTimeline(state.detailIssue);
};