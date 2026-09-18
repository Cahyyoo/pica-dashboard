// js/issue-guard.js
import { tugasTertunda, ambilIssueRingkas } from './utils.js';

/**
 * Mengembalikan { boleh, tertunda } -- bukan cuma true/false seperti sebelumnya.
 *
 * Pemanggilnya butuh tahu tugas MANA yang menahan, bukan sekadar bahwa ada yang menahan:
 * pesan "There are active issues that have NOT been updated today" memaksa PIC mencari
 * sendiri di antara 20+ baris, dan itulah yang membuat tugas Weekly di bawah tidak pernah
 * ketemu. Sekarang pesannya bisa menyebutkan judulnya.
 *
 * `boleh: true` dikembalikan juga saat server tidak bisa dihubungi atau peran bukan
 * Dept Head -- kegagalan jaringan tidak boleh mengunci orang di dalam aplikasi.
 */
export async function checkDailyUpdates() {
    const role = localStorage.getItem('user_role');
    const userId = String(localStorage.getItem('user_id'));

    if (role !== 'Dept Head') return { boleh: true, tertunda: [] };

    try {
        // ?ringkas=1 -- fungsi ini hanya membaca status, picId, dan entri riwayat TERBARU.
        // Tanpa bendera ini, menekan Logout menarik seluruh riwayat semua issue lebih dulu,
        // yang di kiosk terbaca sebagai tombol yang tidak bereaksi.
        const allIssues = await ambilIssueRingkas();

        // Kriterianya dipegang tugasTertunda()/blokTugasPic() di utils.js -- fungsi yang SAMA
        // dengan yang membangun blok "Belum diupdate hari ini" di layar Task List. Dulu kedua
        // tempat ini menulis kriterianya sendiri-sendiri dan sudah berbeda: tabel ikut
        // menampilkan tugas Closed dan tugas yang user-nya cuma mantan PIC, penjaga ini tidak.
        //
        // Status "Continue" = pekerjaan sengaja dilanjutkan hari berikutnya: tetap aktif dan
        // tetap bisa diisi, tapi TIDAK menahan Logout/Exit App. Dievaluasi ulang tiap kali
        // fungsi ini dipanggil, jadi begitu statusnya kembali ke Open/Progress kuncinya berlaku lagi.
        const tertunda = tugasTertunda(allIssues, userId);
        return { boleh: tertunda.length === 0, tertunda };
    } catch (error) {
        console.error("Gagal memvalidasi status harian:", error);
        return { boleh: true, tertunda: [] };
    }
}

/** Ringkasan judul tugas tertunda untuk ditampilkan di pesan. Dipotong supaya kotak
 *  pesan tidak meluber saat tertundanya banyak. */
export function ringkasanTertunda(tertunda, maks = 5) {
    const judul = tertunda.slice(0, maks).map(t => '• ' + (t.caseNotification || '(untitled)'));
    const sisa = tertunda.length - judul.length;
    if (sisa > 0) judul.push(`• ...and ${sisa} more`);
    return judul.join('\n');
}