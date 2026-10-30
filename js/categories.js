// js/categories.js
// Kategori issue yang dikelola MD (menu Manage Categories). Menggantikan daftar
// Daily/Weekly/Midyear/Annual yang dulu di-hardcode di tujuh tempat.
//
// Issue.category menyimpan NAMA kategori; `label` hanya untuk tampilan (mis. name "Weekly",
// label "Weekly BOD"). Semua pembaca memakai labelKategori() supaya rename label cukup
// dilakukan sekali di sini.
import { API_URL, getAuthHeaders } from './config.js';
import { showCustomAlert, showCustomConfirm, escapeHtml, kirimSekali, lupakanCacheIssue } from './utils.js';
import { renderScheduleForm, bacaScheduleForm, deskripsiJadwal } from './schedule-form.js';

// ==========================================
// CACHE DAFTAR KATEGORI
// ==========================================
// Daftar ini dibaca SINKRON oleh render tabel (label, urutan kartu PIC), jadi disimpan di
// modul. TTL hanya membatasi umur perubahan dari perangkat lain; perubahan dari perangkat
// ini selalu memuat ulang dengan paksa.
const TTL_MS = 60000;
let cache = { at: 0, data: [], inFlight: null };

export function muatKategori({ paksa = false } = {}) {
    if (!paksa && cache.at && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.data);
    if (cache.inFlight) return cache.inFlight;

    cache.inFlight = fetch(`${API_URL}/category`)
        .then(res => {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        })
        .then(data => {
            cache = { at: Date.now(), data: Array.isArray(data) ? data : [], inFlight: null };
            return cache.data;
        })
        .catch(err => {
            // Kegagalan tidak boleh membekukan cache, dan data lama tetap dipakai.
            cache.inFlight = null;
            throw err;
        });
    return cache.inFlight;
}

/** Seluruh kategori (aktif & nonaktif) dalam urutan yang ditetapkan MD. */
export function daftarKategori() {
    return cache.data;
}

export function kategoriAktif() {
    return cache.data.filter(k => k.isActive);
}

export function cariKategori(nama) {
    const kunci = String(nama || '').toLowerCase();
    return cache.data.find(k => k.name.toLowerCase() === kunci) || null;
}

export function labelKategori(nama) {
    const k = cariKategori(nama);
    return k ? (k.label || k.name) : (nama || '-');
}

/** Kategori aktif pertama -- pengganti literal 'Daily' sebagai fallback. Sama dengan backend. */
export function kategoriDefault() {
    const k = kategoriAktif()[0] || cache.data[0];
    return k ? k.name : 'Daily';
}

/**
 * Isi <select> kategori.
 *   placeholder: teks opsi kosong pertama (mis. "-- Select Category --")
 *   semua:       teks opsi "All" pertama (filter)
 *   hanyaAktif:  sembunyikan kategori nonaktif -- KECUALI nilai yang sedang terpilih,
 *                supaya issue lama berkategori nonaktif tetap terbaca di modal ubah
 */
export function isiSelectKategori(select, { placeholder, semua, hanyaAktif = false, terpilih } = {}) {
    const el = typeof select === 'string' ? document.getElementById(select) : select;
    if (!el) return;
    const nilai = terpilih !== undefined ? terpilih : el.value;

    let html = '';
    if (placeholder) html += `<option value="">${escapeHtml(placeholder)}</option>`;
    if (semua) html += `<option value="All">${escapeHtml(semua)}</option>`;
    cache.data
        .filter(k => !hanyaAktif || k.isActive || k.name === nilai)
        .forEach(k => {
            const teks = (k.label || k.name) + (k.isActive ? '' : ' (inactive)');
            html += `<option value="${escapeHtml(k.name)}">${escapeHtml(teks)}</option>`;
        });
    el.innerHTML = html;

    // Pertahankan pilihan lama kalau masih ada (mis. filter MD saat daftar dimuat ulang).
    if (nilai && [...el.options].some(o => o.value === nilai)) el.value = nilai;
}

/** Isi semua dropdown kategori statis di layar. Dipanggil saat boot dan setelah MD mengubah kategori. */
export async function muatDropdownKategori({ paksa = false } = {}) {
    try {
        await muatKategori({ paksa });
    } catch (e) {
        console.error('Gagal memuat kategori:', e);
    }
    isiSelectKategori('issue-category', { placeholder: '-- Select Category --', hanyaAktif: true });
    isiSelectKategori('filter-category-md', { semua: 'All Categories' });
}

// ==========================================
// LAYAR MANAGE CATEGORIES (khusus MD)
// ==========================================
export async function loadAdminCategories() {
    const tbody = document.getElementById('tbody-manage-category');
    if (!tbody) return;
    try {
        await muatKategori({ paksa: true });
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#ef4444;">Failed to load categories.</td></tr>';
        return;
    }
    gambarTabelAdmin();
}

function gambarTabelAdmin() {
    const tbody = document.getElementById('tbody-manage-category');
    if (!tbody) return;
    const daftar = cache.data;

    if (daftar.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#6b7280; padding:24px;">No categories yet.</td></tr>';
        return;
    }

    // Satu string, satu assign (pola sama dengan loadAdminDepartments()).
    let html = '';
    daftar.forEach((k, i) => {
        const dipakai = k.issueCount > 0;
        html += `
            <tr${k.isActive ? '' : ' class="baris-nonaktif"'}>
                <td style="text-align: center; white-space: nowrap;">
                    <button class="btn-sm btn-secondary btn-ikon" title="Move up" ${i === 0 ? 'disabled' : ''}
                            onclick="moveCategory(${k.id}, -1)">&#9650;</button>
                    <button class="btn-sm btn-secondary btn-ikon" title="Move down" ${i === daftar.length - 1 ? 'disabled' : ''}
                            onclick="moveCategory(${k.id}, 1)">&#9660;</button>
                </td>
                <td>
                    <div style="font-weight: 600;">${escapeHtml(k.label || k.name)}</div>
                    ${k.label && k.label !== k.name ? `<div class="u-petunjuk">Stored as: ${escapeHtml(k.name)}</div>` : ''}
                </td>
                <td style="font-size: 13px;">${escapeHtml(deskripsiJadwal(k.schedule))}</td>
                <td style="text-align: center;">${k.issueCount}</td>
                <td style="text-align: center;">${k.isActive
                    ? '<span class="badge badge-updated">Active</span>'
                    : '<span class="badge badge-exempt">Inactive</span>'}</td>
                <td>
                    <div style="display: flex; gap: 6px; justify-content: center;">
                        <button class="btn-sm btn-secondary" onclick="openCategoryForm(${k.id})">Edit</button>
                        <button class="btn-sm btn-secondary" onclick="toggleCategoryActive(${k.id})">${k.isActive ? 'Deactivate' : 'Activate'}</button>
                        <button class="btn-sm btn-danger" onclick="deleteCategory(${k.id})" ${dipakai ? 'disabled title="Still used by issues — deactivate it instead"' : ''}>Delete</button>
                    </div>
                </td>
            </tr>`;
    });
    tbody.innerHTML = html;
}

/** Dipanggil setelah setiap perubahan: data kategori, dropdown, dan cache issue ikut segar. */
async function setelahBerubah() {
    // Jadwal kategori menentukan `visibility` setiap issue, jadi data issue yang tersimpan basi.
    lupakanCacheIssue();
    await muatDropdownKategori({ paksa: true });
    gambarTabelAdmin();
}

async function pesanGalat(response, cadangan) {
    try {
        const data = await response.json();
        const pesan = Array.isArray(data.message) ? data.message.join('\n') : data.message;
        return pesan || cadangan;
    } catch {
        return cadangan;
    }
}

async function kirim(path, method, body) {
    return fetch(`${API_URL}/category${path}`, {
        method,
        headers: getAuthHeaders(),
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

// ---- Tambah / edit ----------------------------------------------------------------

export function openCategoryForm(id) {
    const k = id ? cache.data.find(x => x.id === Number(id)) : null;
    document.getElementById('catf-title').innerText = k ? 'Edit Category' : 'Add Category';
    document.getElementById('catf-id').value = k ? k.id : '';
    document.getElementById('catf-name').value = k ? k.name : '';
    document.getElementById('catf-label').value = k ? (k.label || '') : '';
    document.getElementById('catf-active').checked = k ? k.isActive : true;
    renderScheduleForm(document.getElementById('catf-schedule'), { jenis: 'category', schedule: k ? k.schedule : null });
    document.getElementById('modal-category-form').classList.add('show');
}

export function closeCategoryForm() {
    document.getElementById('modal-category-form').classList.remove('show');
}

export async function submitCategoryForm() {
    const id = document.getElementById('catf-id').value;
    const name = document.getElementById('catf-name').value.trim();
    const label = document.getElementById('catf-label').value.trim();
    const isActive = document.getElementById('catf-active').checked;

    if (!name) return showCustomAlert('Warning', 'Category name cannot be empty!');
    const jadwal = bacaScheduleForm(document.getElementById('catf-schedule'), 'category');
    if (jadwal.galat) return showCustomAlert('Warning', jadwal.galat);

    const lama = id ? cache.data.find(x => x.id === Number(id)) : null;
    const lanjut = () => kirimSekali('btn-submit-category-form', 'Saving...', async () => {
        try {
            const response = await kirim(id ? `/${id}` : '', id ? 'PATCH' : 'POST', {
                name, label: label || null, isActive, schedule: jadwal.schedule,
            });
            if (!response.ok) {
                return showCustomAlert('Failed', await pesanGalat(response, 'Failed to save category.'));
            }
            closeCategoryForm();
            showCustomAlert('Success', `Category ${label || name} saved successfully!`);
            await setelahBerubah();
        } catch (e) {
            showCustomAlert('Error', 'Failed to connect to backend server.');
        }
    });

    // Rename memindahkan SEMUA issue berkategori lama -- konfirmasi dulu, karena nama itu
    // juga yang tertulis di laporan MOM dan file Excel yang diimpor ulang.
    if (lama && lama.name !== name && lama.issueCount > 0) {
        return showCustomConfirm('Rename Category',
            `Renaming "${lama.name}" to "${name}" will also move its ${lama.issueCount} issue(s) to the new name.\n\nContinue?`,
            lanjut);
    }
    return lanjut();
}

// ---- Aktif / nonaktif, hapus, urutan ----------------------------------------------

export async function toggleCategoryActive(id) {
    const k = cache.data.find(x => x.id === Number(id));
    if (!k) return;
    try {
        const response = await kirim(`/${k.id}`, 'PATCH', { isActive: !k.isActive });
        if (!response.ok) return showCustomAlert('Failed', await pesanGalat(response, 'Failed to update category.'));
        await setelahBerubah();
    } catch (e) {
        showCustomAlert('Error', 'Failed to connect to backend server.');
    }
}

export function deleteCategory(id) {
    const k = cache.data.find(x => x.id === Number(id));
    if (!k) return;
    showCustomConfirm('Delete Category', `Are you sure you want to delete category:\n${k.label || k.name}?`, async () => {
        try {
            const response = await kirim(`/${k.id}`, 'DELETE');
            if (!response.ok) return showCustomAlert('Failed', await pesanGalat(response, 'Failed to delete category.'));
            showCustomAlert('Success', `Category ${k.label || k.name} has been deleted.`);
            await setelahBerubah();
        } catch (e) {
            showCustomAlert('Error', 'Failed to connect to backend server.');
        }
    });
}

export async function moveCategory(id, arah) {
    const ids = cache.data.map(k => k.id);
    const i = ids.indexOf(Number(id));
    const j = i + arah;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];

    try {
        const response = await kirim('/reorder', 'PATCH', { ids });
        if (!response.ok) return showCustomAlert('Failed', await pesanGalat(response, 'Failed to reorder categories.'));
        await setelahBerubah();
    } catch (e) {
        showCustomAlert('Error', 'Failed to connect to backend server.');
    }
}
