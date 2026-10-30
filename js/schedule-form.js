// js/schedule-form.js
// Fragmen form jadwal tampil/sembunyi, dipakai ulang oleh modal kategori (Manage Categories)
// dan modal jadwal per issue. Elemen di dalamnya dicari lewat atribut data-f, BUKAN id,
// karena dua salinan fragmen ini hidup bersamaan di DOM.
//
// Frontend sengaja TIDAK menghitung kapan issue tampil -- itu dikerjakan backend
// (src/common/schedule.util.ts) dan hasilnya ditempelkan ke setiap issue sebagai
// `visibility`. Di sini hanya: menyusun JSON jadwal, mendeskripsikannya, dan meminta
// pratinjau jendela tampil ke server.
import { API_URL, getAuthHeaders } from './config.js';
import { escapeHtml, debounce, formatWitaDate, rentangHariWita } from './utils.js';

// Urutan tampil Senin..Minggu; nilainya mengikuti Date.getDay() (0 = Minggu).
const HARI = [
    { v: 1, s: 'Mon' }, { v: 2, s: 'Tue' }, { v: 3, s: 'Wed' }, { v: 4, s: 'Thu' },
    { v: 5, s: 'Fri' }, { v: 6, s: 'Sat' }, { v: 0, s: 'Sun' },
];
const NAMA_HARI = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };

// Pola di UI -> bentuk kanonik { type, interval }. "Tiap 3 bulan" dan "Tahunan" hanyalah
// MONTHLY dengan interval tetap; bulan jangkarnya = bulan tanggal mulai.
const POLA = {
    daily:     { label: 'Daily / every N days',  type: 'DAILY',   interval: null, satuan: 'day(s)' },
    weekly:    { label: 'Weekly (pick days)',    type: 'WEEKLY',  interval: null, satuan: 'week(s)' },
    monthly:   { label: 'Monthly (pick date)',   type: 'MONTHLY', interval: 1 },
    quarterly: { label: 'Every 3 months',        type: 'MONTHLY', interval: 3 },
    yearly:    { label: 'Yearly',                type: 'MONTHLY', interval: 12 },
    nmonths:   { label: 'Every N months',        type: 'MONTHLY', interval: null, satuan: 'month(s)' },
};

function polaDari(schedule) {
    if (!schedule) return 'weekly';
    if (schedule.type === 'DAILY') return 'daily';
    if (schedule.type === 'WEEKLY') return 'weekly';
    if (schedule.interval === 1) return 'monthly';
    if (schedule.interval === 3) return 'quarterly';
    if (schedule.interval === 12) return 'yearly';
    return 'nmonths';
}

/** Tanggal hari ini menurut kalender WITA, 'YYYY-MM-DD'. */
export function hariIniWita() {
    const { awal } = rentangHariWita();
    return new Date(awal + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' (tanggal WITA dari backend) -> "03 Nov 2026". */
export function formatTanggalJadwal(ymd) {
    if (!ymd) return '-';
    return formatWitaDate(`${ymd}T00:00:00+08:00`, 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Ringkasan satu baris, mis. "Every 2 weeks on Mon & Thu · shown 1 day". */
export function deskripsiJadwal(schedule) {
    if (!schedule) return 'Always shown';
    const n = schedule.interval || 1;
    let pola;
    if (schedule.type === 'DAILY') {
        pola = n === 1 ? 'Every day' : `Every ${n} days`;
    } else if (schedule.type === 'WEEKLY') {
        const hari = [...(schedule.daysOfWeek || [])]
            .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
            .map(h => NAMA_HARI[h]).join(' & ');
        pola = (n === 1 ? 'Every week' : `Every ${n} weeks`) + ` on ${hari}`;
    } else {
        const tgl = `day ${schedule.dayOfMonth}`;
        if (n === 1) pola = `Monthly on ${tgl}`;
        else if (n === 3) pola = `Every 3 months on ${tgl}`;
        else if (n === 12) pola = `Yearly on ${tgl}`;
        else pola = `Every ${n} months on ${tgl}`;
    }
    const d = schedule.durationDays || 1;
    let teks = `${pola} · shown ${d} day${d === 1 ? '' : 's'}`;
    teks += ` · from ${formatTanggalJadwal(schedule.startDate)}`;
    if (schedule.endDate) teks += ` to ${formatTanggalJadwal(schedule.endDate)}`;
    return teks;
}

/** Status tampil saat ini dari `issue.visibility` (dihitung backend). */
export function deskripsiVisibilitas(visibility) {
    if (!visibility || visibility.visible !== false) {
        return visibility && visibility.until ? `Shown until ${formatTanggalJadwal(visibility.until)}` : 'Shown';
    }
    return visibility.nextShowAt ? `Hidden · shows ${formatTanggalJadwal(visibility.nextShowAt)}` : 'Hidden · schedule ended';
}

// --------------------------------------------------------------------------- render

/**
 * @param {HTMLElement} wadah
 * @param {object} opsi
 *   - jenis: 'category' | 'issue'
 *   - schedule: jadwal yang sedang berlaku (null = tanpa jadwal)
 *   - mode: (issue) 'INHERIT' | 'ALWAYS' | 'CUSTOM'
 *   - jadwalKategori: (issue) jadwal kategori issue ini, untuk keterangan opsi "Follow category"
 */
export function renderScheduleForm(wadah, opsi) {
    if (!wadah) return;
    const { jenis, schedule = null, mode = 'INHERIT', jadwalKategori = null } = opsi;
    const s = schedule || {};
    const pola = polaDari(schedule);
    const hariTerpilih = new Set(s.daysOfWeek || [1]);

    const pemilih = jenis === 'issue'
        ? `<div class="jadwal-mode">
               ${opsiMode('INHERIT', mode, 'Follow category', deskripsiJadwal(jadwalKategori))}
               ${opsiMode('ALWAYS', mode, 'Always shown', 'Ignore the category schedule.')}
               ${opsiMode('CUSTOM', mode, 'Custom schedule', 'Use a schedule for this issue only.')}
           </div>`
        : `<label class="jadwal-cek"><input type="checkbox" data-f="aktif" ${schedule ? 'checked' : ''}>
               Use a show schedule <span class="u-petunjuk">(unchecked = issues are always shown)</span></label>`;

    wadah.innerHTML = `
        ${pemilih}
        <div class="jadwal-isi" data-f="isi">
            <div class="jadwal-dua-kolom">
                <div>
                    <label class="u-label">Repeat</label>
                    <select class="u-mt-6" data-f="pola">
                        ${Object.entries(POLA).map(([k, p]) => `<option value="${k}" ${k === pola ? 'selected' : ''}>${p.label}</option>`).join('')}
                    </select>
                </div>
                <div data-f="grup-interval">
                    <label class="u-label">Every <span data-f="satuan"></span></label>
                    <input class="u-mt-6" type="number" min="1" max="365" data-f="interval" value="${Number(s.interval) || 1}">
                </div>
            </div>

            <div data-f="grup-hari" class="u-mt-6">
                <label class="u-label">On days</label>
                <div class="jadwal-hari">
                    ${HARI.map(h => `<label class="jadwal-chip"><input type="checkbox" data-f="hari" value="${h.v}" ${hariTerpilih.has(h.v) ? 'checked' : ''}><span>${h.s}</span></label>`).join('')}
                </div>
            </div>

            <div data-f="grup-tanggal" class="u-mt-6">
                <label class="u-label">On day of month <span class="u-petunjuk">(29-31 fall back to the last day of shorter months)</span></label>
                <input class="u-mt-6" type="number" min="1" max="31" data-f="tanggal" value="${Number(s.dayOfMonth) || 1}">
            </div>

            <div class="jadwal-tiga-kolom u-mt-6">
                <div>
                    <label class="u-label">Starts on <span class="u-bahaya">*</span></label>
                    <input class="u-mt-6" type="date" data-f="mulai" value="${escapeHtml(s.startDate || hariIniWita())}">
                </div>
                <div>
                    <label class="u-label">Ends on <span class="u-petunjuk">(optional)</span></label>
                    <input class="u-mt-6" type="date" data-f="akhir" value="${escapeHtml(s.endDate || '')}">
                </div>
                <div>
                    <label class="u-label">Shown for (days)</label>
                    <input class="u-mt-6" type="number" min="1" max="366" data-f="durasi" value="${Number(s.durationDays) || 1}">
                </div>
            </div>

            <div class="jadwal-pratinjau" data-f="pratinjau"></div>
        </div>`;

    const segarkan = () => {
        sesuaikanTampilan(wadah, jenis);
        pratinjauDebounced(wadah, jenis);
    };
    wadah.oninput = segarkan;
    wadah.onchange = segarkan;
    sesuaikanTampilan(wadah, jenis);
    perbaruiPratinjau(wadah, jenis);
}

function opsiMode(nilai, aktif, judul, ket) {
    return `<label class="jadwal-mode-opsi">
        <input type="radio" name="jadwal-mode" data-f="mode" value="${nilai}" ${nilai === aktif ? 'checked' : ''}>
        <span><strong>${judul}</strong><span class="u-petunjuk">${escapeHtml(ket)}</span></span>
    </label>`;
}

const ambil = (wadah, f) => wadah.querySelector(`[data-f="${f}"]`);

function isiAktif(wadah, jenis) {
    if (jenis === 'issue') {
        const m = wadah.querySelector('[data-f="mode"]:checked');
        return !!m && m.value === 'CUSTOM';
    }
    return !!ambil(wadah, 'aktif')?.checked;
}

// Menampilkan hanya field yang relevan untuk pola terpilih.
function sesuaikanTampilan(wadah, jenis) {
    const isi = ambil(wadah, 'isi');
    if (isi) isi.hidden = !isiAktif(wadah, jenis);

    const p = POLA[ambil(wadah, 'pola').value] || POLA.weekly;
    ambil(wadah, 'grup-interval').hidden = p.interval !== null;
    ambil(wadah, 'satuan').innerText = p.satuan || '';
    ambil(wadah, 'grup-hari').hidden = p.type !== 'WEEKLY';
    ambil(wadah, 'grup-tanggal').hidden = p.type !== 'MONTHLY';
}

// --------------------------------------------------------------------------- baca

/** Susun jadwal kanonik dari isi form. Validasi lengkap tetap di backend. */
function susunJadwal(wadah) {
    const p = POLA[ambil(wadah, 'pola').value] || POLA.weekly;
    const jadwal = {
        type: p.type,
        interval: p.interval ?? parseInt(ambil(wadah, 'interval').value, 10),
        startDate: ambil(wadah, 'mulai').value,
        durationDays: parseInt(ambil(wadah, 'durasi').value, 10),
    };
    const akhir = ambil(wadah, 'akhir').value;
    if (akhir) jadwal.endDate = akhir;
    if (p.type === 'WEEKLY') {
        jadwal.daysOfWeek = [...wadah.querySelectorAll('[data-f="hari"]:checked')].map(c => Number(c.value));
    }
    if (p.type === 'MONTHLY') jadwal.dayOfMonth = parseInt(ambil(wadah, 'tanggal').value, 10);
    return jadwal;
}

/** Pemeriksaan ringan supaya kesalahan umum langsung terlihat tanpa bolak-balik ke server. */
function periksa(jadwal) {
    if (!jadwal.startDate) return 'Please fill in the start date.';
    if (!Number.isInteger(jadwal.interval) || jadwal.interval < 1) return 'The repeat interval must be at least 1.';
    if (!Number.isInteger(jadwal.durationDays) || jadwal.durationDays < 1) return 'The show duration must be at least 1 day.';
    if (jadwal.type === 'WEEKLY' && jadwal.daysOfWeek.length === 0) return 'Pick at least one day of the week.';
    if (jadwal.type === 'MONTHLY' && !(jadwal.dayOfMonth >= 1 && jadwal.dayOfMonth <= 31)) return 'The day of month must be 1 - 31.';
    if (jadwal.endDate && jadwal.endDate < jadwal.startDate) return 'The end date cannot be before the start date.';
    return null;
}

/**
 * Hasil: { galat } bila tidak valid, atau
 *   kategori -> { schedule }           (null = selalu tampil)
 *   issue    -> { mode, schedule }     (schedule hanya untuk CUSTOM)
 */
export function bacaScheduleForm(wadah, jenis) {
    const aktif = isiAktif(wadah, jenis);
    const mode = jenis === 'issue' ? (wadah.querySelector('[data-f="mode"]:checked')?.value || 'INHERIT') : null;

    if (!aktif) return jenis === 'issue' ? { mode, schedule: null } : { schedule: null };

    const schedule = susunJadwal(wadah);
    const galat = periksa(schedule);
    if (galat) return { galat };
    return jenis === 'issue' ? { mode, schedule } : { schedule };
}

// --------------------------------------------------------------------------- pratinjau

async function perbaruiPratinjau(wadah, jenis) {
    const el = ambil(wadah, 'pratinjau');
    if (!el || !isiAktif(wadah, jenis)) return;

    const jadwal = susunJadwal(wadah);
    const galat = periksa(jadwal);
    if (galat) {
        el.innerHTML = `<span class="u-bahaya">${escapeHtml(galat)}</span>`;
        return;
    }

    // Penanda urutan: jawaban yang datang terlambat dari ketikan sebelumnya diabaikan.
    const nomor = (wadah._nomorPratinjau = (wadah._nomorPratinjau || 0) + 1);
    el.innerHTML = '<span class="u-petunjuk">Checking schedule…</span>';
    try {
        const res = await fetch(`${API_URL}/category/schedule/preview`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(jadwal),
        });
        const data = await res.json();
        if (nomor !== wadah._nomorPratinjau) return;

        if (!res.ok) {
            const pesan = Array.isArray(data.message) ? data.message.join(', ') : data.message;
            el.innerHTML = `<span class="u-bahaya">${escapeHtml(pesan || 'Invalid schedule.')}</span>`;
            return;
        }
        el.innerHTML = data.length === 0
            ? '<span class="u-petunjuk">No upcoming show window — issues will stay hidden.</span>'
            : `<strong>Next show windows:</strong><ul>${data.map(w => `<li>${formatTanggalJadwal(w.start)}${w.end !== w.start ? ' – ' + formatTanggalJadwal(w.end) : ''}</li>`).join('')}</ul>`;
    } catch (e) {
        if (nomor === wadah._nomorPratinjau) el.innerHTML = '<span class="u-petunjuk">Preview unavailable (server unreachable).</span>';
    }
}

const pratinjauDebounced = debounce(perbaruiPratinjau, 400);
