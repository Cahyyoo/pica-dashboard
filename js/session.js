import { API_URL } from './config.js';

// ====================================================================
// SESI KEDALUWARSA: PAKSA LOGIN ULANG
// ====================================================================
// Token dari backend hanya berlaku 1 hari, tapi kiosk auto-resume dengan token yang sama
// selamanya. Hampir semua endpoint tidak mengecek token, jadi app terlihat normal -- sampai
// endpoint yang mewajibkannya (mis. "Edit this update") menolak dengan "Sesi tidak dikenali".
// Modul ini sengaja terpisah dari auth.js: issue-action.js juga memakainya, sedangkan auth.js
// mengimpor issues.js (yang me-re-export issue-action.js) -- impor balik akan membuat siklus.

// Pesan backend saat token tidak lagi diterima (issue.service.ts, editHistory).
export const PESAN_SESI_DITOLAK = 'Sesi tidak dikenali';

// Membaca klaim `exp` (detik) dari payload JWT TANPA verifikasi tanda tangan -- di sini cukup
// untuk tahu kapan token habis; keputusan sah tetap di backend. null kalau token tidak punya
// `exp`; melempar error kalau token rusak.
function bacaExpToken(token) {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const { exp } = JSON.parse(atob(payload));
    return typeof exp === 'number' ? exp : null;
}

// Token rusak dianggap kedaluwarsa.
export function tokenSudahKedaluwarsa() {
    const token = localStorage.getItem('access_token');
    if (!token) return false;
    try {
        const exp = bacaExpToken(token);
        return exp !== null && Date.now() >= exp * 1000;
    } catch (e) {
        return true;
    }
}

// Timer yang menyala TEPAT saat token habis, supaya app pindah ke layar login saat itu juga --
// bukan menunggu tick cek per menit di startBackgroundMonitor(). Cek per menit tetap ada sebagai
// cadangan: saat backend putus paksaLoginUlang() menunda, dan selama laptop sleep timer ikut berhenti.
// Dipanggil setiap kali sesi dimulai (login manual & auto-resume); timer lama selalu dibatalkan.
let timerPaksaLogin = null;

export function jadwalkanPaksaLogin() {
    clearTimeout(timerPaksaLogin);
    timerPaksaLogin = null;

    const token = localStorage.getItem('access_token');
    if (!token) return;
    let exp;
    try {
        exp = bacaExpToken(token);
    } catch (e) {
        return; // token rusak -- sudah ditangani tokenSudahKedaluwarsa() di cek per menit
    }
    if (exp === null) return;

    // +1 detik supaya saat menyala token pasti sudah lewat. Dibatasi ke batas maksimum
    // setTimeout (~24,8 hari) -- nilai yang melewatinya membuat timer justru menyala seketika.
    const sisa = Math.min(Math.max(0, exp * 1000 - Date.now()) + 1000, 2147483647);
    timerPaksaLogin = setTimeout(() => paksaLoginUlang(), sisa);
}

// Hapus sesi lalu kembali ke layar login. Sengaja MELEWATI gembok harian (checkDailyUpdates):
// ini bukan logout sukarela, dan setelah user yang sama login lagi gembok tetap berlaku.
//
// Ditunda (return false) kalau backend tak terjangkau -- user tidak akan bisa login dan malah
// terjebak di layar login. Sengaja memakai ping, BUKAN status kunci Guest: saat app sudah terbuka
// main.js tidak pernah memindah WiFi otomatis, dan kunci Guest tidak menyala di WiFi rumah.
// Pemanggil berkala (startBackgroundMonitor) akan mencoba lagi menit berikutnya.
export async function paksaLoginUlang() {
    const pembatal = new AbortController();
    const timer = setTimeout(() => pembatal.abort(), 3000);
    try {
        const res = await fetch(`${API_URL}/department`, { method: 'GET', signal: pembatal.signal });
        if (!res.ok) return false;
    } catch (e) {
        return false;
    } finally {
        clearTimeout(timer);
    }

    localStorage.clear(); // sama seperti handleLogout()
    localStorage.setItem('sesi_kedaluwarsa', '1'); // dibaca layar login setelah reload
    location.reload();
    return true;
}
