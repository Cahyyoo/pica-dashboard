const { app, BrowserWindow, ipcMain, dialog, powerMonitor } = require('electron'); // 'globalShortcut' dihapus
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { installKeyGuards } = require('./keyguard');
const { installContextMenu } = require('./contextmenu');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os'); // dipakai untuk os.tmpdir() -- lokasi file XML sementara Task Scheduler
// Dipakai ulang khusus untuk baca SSID WiFi aktif via `netsh` (execFile, BUKAN exec/shell,
// tidak ada input dinamis yang diinterpolasi jadi aman dari command injection).
const { execFile } = require('child_process');

log.transports.file.level = 'info';
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
log.info('--- Aplikasi PICA Dinyalakan ---');

let isDialogOpen = false;
let isQuitting = false;
let mainWindow;
// true kalau app sedang dalam mode "Guest terkunci" (SSID SPRM-GUEST, backend tak terjangkau
// dari jaringan itu) -- selama true, Exit App & Logout dinonaktifkan. TIDAK lagi butuh restart
// untuk lepas -- lihat startRuntimeNetworkMonitor() di bawah, otomatis lepas begitu backend
// terjangkau lagi. Hanya bisa menyala DI TENGAH SESI (app sudah terbuka lalu jaringan memburuk):
// saat boot app tidak pernah dibuka sebelum backend benar-benar terjangkau.
let isGuestLocked = false;
let runtimeNetworkMonitor = null;
// Timer patroli saat app BELUM terbuka (backend tak terjangkau). setTimeout berantai,
// bukan setInterval -- lihat startBackgroundPatrol().
let patrolTimer = null;

// --- CEK APAKAH APLIKASI DIJALANKAN DARI AUTO-START (SILUMAN) ---
const isHiddenStart = process.argv.includes('--hidden');

// Ubah error teknis fs.writeFileSync jadi pesan yang jelas & actionable untuk user awam
function friendlySaveError(error) {
  if (error && error.code === 'EBUSY') {
    return 'This file is currently open in another program (e.g. Excel). Please close it first, then try saving again — or choose a different file name.';
  }
  if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
    return 'Permission denied while saving the file. Try choosing a different folder.';
  }
  return error && error.message ? error.message : String(error);
}

function createWindow () {
  // 1. SPLASH SCREEN
  let splash;
  if (!isHiddenStart) {
      splash = new BrowserWindow({
        width: 450, height: 300,
        transparent: true, frame: false, alwaysOnTop: true, center: true,
        icon: path.join(__dirname, 'public/img/logo_pica.png'), 
        show: true // Splash Screen langsung tampil
      });
      splash.loadFile('splash.html');
      // lockWindowsOS() sudah dihapus, Windows tetap aman.
  }

  // 2. JENDELA UTAMA
  mainWindow = new BrowserWindow({
    width: 800, height: 600,
    kiosk: true, // Layar penuh
    alwaysOnTop: true, // Memaksa PICA selalu berada di depan aplikasi apa pun
    autoHideMenuBar: true, 
    type: 'screen-saver', // Tingkat prioritas layar tertinggi di OS
    icon: path.join(__dirname, 'public/img/logo_pica.png'), 
    show: false, 
    webPreferences: {
      nodeIntegration: true, contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');

  // Blocks Alt / Ctrl+R / F5 / F12 / Ctrl+W and friends, and swaps the default menu
  // for one without Reload. The menu bar opens by holding Shift+P+I+C+A+S.
  installKeyGuards(mainWindow);

  // Electron ships no default context menu, so right-click does nothing until this exists.
  installContextMenu(mainWindow);

  function bringWindowToFront(reason) {
        console.log(`${reason} Mengirim sinyal ke Frontend...`);

        if (mainWindow) {
            // 1. Kirim pesan rahasia 'laptop-woke-up' ke Frontend (app.js) untuk refresh data
            mainWindow.webContents.send('laptop-woke-up');

            // 2. PAKSA JENDELA MUNCUL KE DEPAN LAYAR
            if (mainWindow.isMinimized()) {
                mainWindow.restore(); // Kembalikan dari taskbar jika di-minimize
            }

            mainWindow.show(); // Pastikan tidak tersembunyi

            // 3. Trik ampuh di Windows agar aplikasi menimpa aplikasi lain yang sedang buka
            mainWindow.setAlwaysOnTop(true);
            mainWindow.focus();

            // Matikan mode "selalu di atas" setelah 2 detik agar pengguna tetap bisa membuka aplikasi lain setelahnya
            setTimeout(() => {
                mainWindow.setAlwaysOnTop(false);
            }, 2000);
        }
  }

  // Laptop bangun dari sleep/hibernate penuh
  powerMonitor.on('resume', () => bringWindowToFront("Laptop bangun dari sleep!"));

  // Windows hanya di-unlock (mis. layar dikunci lewat Win+L tanpa laptop benar-benar sleep)
  powerMonitor.on('unlock-screen', () => bringWindowToFront("Layar Windows di-unlock!"));

  mainWindow.once('ready-to-show', () => {
    if (!isHiddenStart) {
        setTimeout(() => {
          if (splash && !splash.isDestroyed()) splash.destroy(); 
          mainWindow.show();       
          mainWindow.focus();
        }, 1500); // Tampil setelah 1.5 detik
    }
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) e.preventDefault(); 
  });

  mainWindow.on('blur', () => {
    // Tetap memaksa fokus jika jendela kehilangan fokus (kecuali saat buka dialog PDF)
    // if (!isDialogOpen && !isQuitting && mainWindow.isVisible()) mainWindow.focus();
  });

  mainWindow.on('minimize', (e) => {
    // Mencegah aplikasi diminimize
    e.preventDefault();
    mainWindow.restore();
  });

  // Jembatan Simpan PDF
  ipcMain.handle('simpan-pdf', async (event, base64Data, defaultFilename) => {
    isDialogOpen = true; 
    try {
      const { filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Save PDF Report',
        defaultPath: defaultFilename,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
      });

      if (filePath) {
        const base64 = base64Data.split(';base64,').pop();
        fs.writeFileSync(filePath, base64, { encoding: 'base64' });
        return { success: true };
      }
      return { success: false, canceled: true };
    } catch (error) {
      return { success: false, error: friendlySaveError(error) };
    } finally {
      isDialogOpen = false;
      if (mainWindow.isVisible()) mainWindow.focus();
    }
  });

  // Jembatan Simpan File Generik (dipakai untuk Excel Template, dsb - bukan PDF)
  ipcMain.handle('simpan-file', async (event, base64Data, defaultFilename, options = {}) => {
    isDialogOpen = true;
    try {
      const { filePath } = await dialog.showSaveDialog(mainWindow, {
        title: options.title || 'Save File',
        defaultPath: defaultFilename,
        filters: options.filters || [{ name: 'All Files', extensions: ['*'] }]
      });

      if (filePath) {
        const base64 = base64Data.split(';base64,').pop();
        fs.writeFileSync(filePath, base64, { encoding: 'base64' });
        return { success: true };
      }
      return { success: false, canceled: true };
    } catch (error) {
      return { success: false, error: friendlySaveError(error) };
    } finally {
      isDialogOpen = false;
      if (mainWindow.isVisible()) mainWindow.focus();
    }
  });

  // Mulai pemantauan jaringan berkelanjutan (bukan cuma sekali saat boot) -- supaya kalau
  // user pindah WiFi ke SPRM-GUEST DI TENGAH sesi (app sudah terbuka), lock tetap terpasang;
  // dan sebaliknya, kalau kembali ke jaringan yang benar, lock otomatis lepas tanpa restart.
  startRuntimeNetworkMonitor();
}

// Cek SSID + reachability berkala SELAMA app berjalan (bukan cuma sekali saat boot).
// Hanya menyalakan/mematikan isGuestLocked kalau memang perlu berubah -- supaya renderer
// cuma diberitahu (event 'guest-lock-status-changed') pada saat status BENAR-BENAR berubah,
// bukan setiap kali polling.
function startRuntimeNetworkMonitor() {
  if (runtimeNetworkMonitor) return; // sudah jalan, jangan didobelkan
  runtimeNetworkMonitor = setInterval(async () => {
    // Cek backend dulu, SENDIRIAN. Saat backend terjangkau, satu-satunya cabang yang bisa jalan
    // di bawah adalah `reachable && isGuestLocked`, yang tidak memakai ssid maupun scan WiFi --
    // jadi memanggil keduanya di kondisi normal murni pemborosan: dua proses `netsh` tiap 10
    // detik seumur hidup app, salah satunya memicu scan radio WiFi. Keduanya sekarang hanya
    // dijalankan kalau memang ada masalah koneksi.
    const reachable = await checkServerConnection();
    let changed = false;

    if (reachable) {
      if (isGuestLocked) {
        // Backend terjangkau lagi -- lepas kunci otomatis, tidak perlu restart app.
        isGuestLocked = false;
        changed = true;
        log.info('Backend terjangkau lagi -- mode Guest terkunci otomatis dilepas.');
      }
    } else if (!isGuestLocked) {
      const [ssid, officeWifiNearby] = await Promise.all([getCurrentSSID(), isOfficeWifiNearby()]);

      if (ssid === 'SPRM-GUEST' || officeWifiNearby) {
        // WiFi berpindah ke SPRM-GUEST, ATAU device tetap di sekitar kantor tapi tersambung
        // ke jaringan lain (mis. hotspot HP) -- kunci Exit App & Logout.
        isGuestLocked = true;
        changed = true;
        log.info(ssid === 'SPRM-GUEST'
          ? 'WiFi berpindah ke SPRM-GUEST saat app berjalan -- Exit App/Logout dikunci.'
          : 'WiFi kantor terdeteksi di sekitar tapi tidak tersambung -- Exit App/Logout dikunci.');
      }
      // Kondisi lain (unreachable, SSID lain, DAN tidak ada WiFi kantor yang terlihat) sengaja
      // TIDAK mengubah status lock -- di luar cakupan fitur ini.
    }

    if (changed && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('guest-lock-status-changed', isGuestLocked);
    }
  }, 10000);
}

// =========================================================
// TASK SCHEDULER: DAFTARKAN "PICA Scheduler" -- BUKA APP OTOMATIS TIAP JAM 10:00 (WITA)
// =========================================================
// UserId/Author sengaja tidak dicantumkan -- Task Scheduler otomatis pakai identitas user
// yang menjalankan pendaftaran ini (user kiosk yang sedang login), tidak di-hardcode ke
// akun device development manapun. Compatibility (dropdown "Configure for") juga sengaja
// tidak dipaksa ke nilai tertentu -- biar Windows pakai default versinya sendiri.
const TASK_XML_TEMPLATE = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>{START_BOUNDARY}</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>true</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{EXE_PATH}</Command>
    </Exec>
  </Actions>
</Task>`;

// Daftarkan/perbarui task "PICA Scheduler" di Windows Task Scheduler -- trigger harian jam
// 10:00 waktu lokal (asumsi jam sistem device kiosk sudah WITA), action = buka app ini.
// Best-effort & idempoten (pakai /f): dipanggil tiap boot, tidak pernah menghalangi startup
// app kalaupun schtasks gagal (mis. Task Scheduler service mati atau tidak ada izin).
function ensureScheduledTask() {
  try {
    const exePath = app.getPath('exe');
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    // Komponen waktu LOKAL (bukan toISOString yang UTC) -- StartBoundary tanpa offset/zulu
    // berarti Task Scheduler menafsirkannya sebagai waktu lokal sistem.
    const startBoundary = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T10:00:00`;

    const escapeXml = (s) => s
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

    const xml = TASK_XML_TEMPLATE
      .replace('{START_BOUNDARY}', startBoundary)
      .replace('{EXE_PATH}', escapeXml(exePath));

    const tempXmlPath = path.join(os.tmpdir(), 'pica-scheduler-task.xml');
    // schtasks /xml WAJIB file UTF-16LE + BOM -- fs.writeFileSync biasa (UTF-8) akan gagal
    // diimpor. BOM (U+FEFF) dibangun lewat fromCharCode (bukan karakter literal di source)
    // supaya tidak berisiko hilang/rusak kalau file ini dibuka editor lain atau lewat diff git.
    const BOM = String.fromCharCode(0xFEFF);
    fs.writeFileSync(tempXmlPath, Buffer.from(BOM + xml, 'utf16le'));

    execFile(
      'schtasks',
      ['/create', '/tn', 'PICA Scheduler', '/xml', tempXmlPath, '/f'],
      { timeout: 15000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          log.error('[ScheduledTask] Gagal mendaftarkan PICA Scheduler:', error.message, stderr);
        } else {
          log.info('[ScheduledTask] PICA Scheduler berhasil didaftarkan/diperbarui.');
        }
        fs.unlink(tempXmlPath, () => {}); // best-effort, kegagalan hapus temp file tidak fatal
      }
    );
  } catch (err) {
    log.error('[ScheduledTask] Gagal menyiapkan pendaftaran task:', err);
  }
}

// =========================================================
// AUTO UPDATE: CEK & INSTALL VERSI TERBARU DARI GITHUB
// =========================================================
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function setupAutoUpdater() {
  // 1. Sinyal saat update ditemukan & mulai diunduh
  autoUpdater.on('update-available', (info) => {
    log.info(`Update tersedia: v${info.version}. Mengunduh di latar belakang...`);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-mulai-download');
    }
  });

  // 2. Sinyal progress unduhan (Real-time)
  autoUpdater.on('download-progress', (progressObj) => {
    let persentase = Math.floor(progressObj.percent);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setProgressBar(persentase / 100); // Progress hijau di Taskbar Windows
        mainWindow.webContents.send('update-progress-berjalan', persentase);
    }
  });

  // 3. Sinyal unduhan 100% selesai
  autoUpdater.on('update-downloaded', (info) => {
    log.info(`Update v${info.version} siap diinstal.`);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setProgressBar(-1); // Hapus progress bar dari Taskbar
        mainWindow.webContents.send('update-siap-dipasang', info.version);
    }
  });

  autoUpdater.on('error', (err) => {
    log.error('Error Updater:', err == null ? 'unknown' : (err.stack || err.message));
  });

  // Pengecekan saat startup & berkala tiap 4 jam
  autoUpdater.checkForUpdates().catch((err) => log.error(err));
  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => log.error(err));
  }, 4 * 60 * 60 * 1000);
}

// 4. PENERIMA PERINTAH DARI TOMBOL UI (Letakkan di luar fungsi setupAutoUpdater)
ipcMain.on('eksekusi-update-sekarang', () => {
  log.info('Perintah restart diterima dari Frontend. Mengeksekusi instalasi...');
  isQuitting = true; 
  autoUpdater.quitAndInstall(); 
});

// =========================================================
// PENGENDALI KELUAR: MATIKAN APLIKASI SEPENUHNYA
// =========================================================
ipcMain.on('perintah-tutup-paksa', () => {
  // Pertahanan berlapis: kalaupun sisi renderer somehow terlewati, main process tetap
  // menolak mematikan app selama masih dalam mode Guest terkunci.
  if (isGuestLocked) {
    log.warn('Percobaan keluar aplikasi ditolak: aplikasi berjalan dalam mode Guest terkunci.');
    return;
  }
  app.quit(); // Langsung matikan aplikasi tanpa perlu mengutak-atik OS
});

// Dipanggil dari renderer (js/auth.js) untuk cek apakah app sedang dalam mode Guest terkunci
// sebelum mengizinkan Exit App / Logout.
ipcMain.handle('cek-status-lock', () => isGuestLocked);

// =========================================================
// FITUR PENGINTAI KONEKSI (NETWORK CHECKER)
// =========================================================
function checkServerConnection() {
    return new Promise((resolve) => {
        // GANTI URL DI BAWAH dengan IP lokal backend Anda, misal: 'http://192.168.1.100:3000'
        const apiUrl = 'http://192.168.100.205:3000'; 
        // const apiUrl = 'http://localhost:3000'; 
        
        const req = http.get(apiUrl, (res) => {
            // Jika ada respon dari server, berarti laptop terhubung ke jaringan kantor
            resolve(true); 
        }).on('error', (err) => {
            // Jika error (misal koneksi ditolak atau host tidak ditemukan), berarti di rumah
            resolve(false); 
        });

        // Set Timeout maksimal 3 detik agar proses booting tidak terhambat jika RTO
        req.setTimeout(3000, () => {
            req.destroy(); 
            resolve(false); 
        });
    });
}
const OFFICE_SSIDS = ['SPRM-MGT', 'SPRM-GUEST', 'SPRM-CCTV', 'SPRM-CORP'];

// SSID kantor yang BENAR-BENAR menjangkau backend. Kalau backend tak terjangkau tapi SSID ini
// terlihat di sekitar, app mencoba PINDAH ke sini dulu sebelum menyerah dan menunggu di background.
const TARGET_SSID = 'SPRM-CORP';

// Probe internet publik. Memakai endpoint NCSI milik Windows sendiri -- inilah yang dipakai
// Windows untuk memutuskan ikon "No internet", jadi kalau jaringan kantor mengizinkan sesuatu
// keluar, endpoint ini yang paling mungkin diizinkan. Isi bodinya ikut diperiksa (bukan cuma
// status 200) supaya captive portal, yang selalu membalas 200 dengan halaman login, tidak
// salah dibaca sebagai "ada internet".
const INTERNET_PROBE_URL = 'http://www.msftconnecttest.com/connecttest.txt';
const INTERNET_PROBE_BODY = 'Microsoft Connect Test';
const INTERNET_PROBE_TIMEOUT_MS = 2500;

// SPRM-CORP yang tidak memberi internet langsung dianggap gagal, tanpa repot mengecek backend.
// Aman dipakai karena SUDAH DIKONFIRMASI: VLAN SPRM-CORP mengizinkan akses keluar, jadi gerbang
// ini tidak akan membuang jaringan yang sebenarnya sehat.
// Balik ke false HANYA kalau suatu saat VLAN kantor memblokir internet keluar tapi tetap
// melayani backend internal -- cek internet lalu turun peran jadi sekadar "tunggu DHCP selesai".
const REQUIRE_INTERNET_ON_TARGET = true;

// Jeda antar percobaan probe. Sengaja pendek: asosiasi WiFi + DHCP di jaringan sehat selesai
// dalam 1-2 detik, jadi jeda panjang cuma menahan jendela app muncul tanpa alasan.
const PROBE_GAP_MS = 1500;

// Apakah jaringan yang sedang dipakai punya akses INTERNET? Beda dari checkServerConnection()
// yang menguji backend LOKAL. Dua pertanyaan berbeda: sebuah SSID bisa punya salah satunya,
// keduanya, atau tidak sama sekali.
// Tidak pernah throw -- kegagalan apapun aman jatuh ke false.
function hasInternetConnection() {
    return new Promise((resolve) => {
        const req = http.get(INTERNET_PROBE_URL, (res) => {
            if (res.statusCode !== 200) { res.resume(); return resolve(false); }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { if (body.length < 256) body += c; });
            res.on('end', () => resolve(body.includes(INTERNET_PROBE_BODY)));
        }).on('error', () => resolve(false));

        req.setTimeout(INTERNET_PROBE_TIMEOUT_MS, () => { req.destroy(); resolve(false); });
    });
}

// Opsi standar semua pemanggilan `netsh` di bawah. execFile (BUKAN exec/shell) + timeout supaya
// perintah yang menggantung tidak menahan app. `windowsHide` WAJIB: netsh adalah aplikasi console,
// tanpa opsi ini Windows memunculkan jendela hitam sekilas di atas app kiosk tiap kali dipanggil.
const NETSH_OPTS = { timeout: 5000, windowsHide: true };

// Baca SSID WiFi yang sedang aktif (Windows) lewat `netsh wlan show interfaces`.
// Dipakai untuk mendeteksi SSID "SPRM-GUEST" (jaringan tamu yang memang tidak pernah bisa
// menjangkau backend internal) dan untuk memastikan kita tidak menyambung ulang ke SSID yang
// memang sudah aktif.
// Tidak pernah throw/reject -- kegagalan apapun (perintah gagal, format tak dikenali, dsb.)
// aman jatuh ke `null`, yang berarti perilaku paling konservatif tetap berlaku.
function getCurrentSSID() {
    return new Promise((resolve) => {
        try {
            execFile('netsh', ['wlan', 'show', 'interfaces'], NETSH_OPTS, (err, stdout) => {
                if (err || !stdout) return resolve(null);
                const lines = stdout.split(/\r?\n/);
                for (const line of lines) {
                    // Regex ini SENGAJA tidak match baris "BSSID :" -- ^\s*SSID mengharuskan
                    // token persis setelah whitespace awal adalah "SSID", bukan "BSSID".
                    const m = line.match(/^\s*SSID\s+:\s*(.+)$/);
                    if (m) return resolve(m[1].trim());
                }
                resolve(null);
            });
        } catch (e) {
            resolve(null);
        }
    });
}

// `netsh wlan show networks` memicu SCAN RADIO WiFi -- operasi paling mahal di seluruh app ini:
// boros baterai dan bisa membuat koneksi tersendat sesaat. Karena itu hasilnya di-cache sebentar
// (di bawah interval polling) supaya satu siklus polling cukup SATU scan, berapapun banyaknya
// pembaca. `scanInFlight` menyatukan pemanggil yang datang bersamaan ke satu scan yang sama.
// Tidak pernah throw -- kegagalan apapun aman jatuh ke string kosong (= tidak ada WiFi terlihat).
const SCAN_CACHE_MS = 8000;
let scanCache = { at: 0, out: '' };
let scanInFlight = null;

function scanVisibleNetworks() {
    if (Date.now() - scanCache.at < SCAN_CACHE_MS) return Promise.resolve(scanCache.out);
    if (scanInFlight) return scanInFlight;

    scanInFlight = new Promise((resolve) => {
        const done = (out) => {
            scanCache = { at: Date.now(), out };
            scanInFlight = null;
            resolve(out);
        };
        try {
            execFile('netsh', ['wlan', 'show', 'networks'], NETSH_OPTS, (err, stdout) => {
                done((err || !stdout) ? '' : stdout);
            });
        } catch (e) {
            done('');
        }
    });
    return scanInFlight;
}

// Apakah salah satu SSID kantor TERLIHAT di sekitar, TERLEPAS dari SSID mana yang sedang
// tersambung? Beda dengan getCurrentSSID() yang cuma lihat koneksi aktif -- ini menjawab
// "apakah device secara fisik ada di kantor", walau sedang connect ke jaringan lain
// (mis. hotspot HP). Dipakai runtime monitor untuk memasang mode Guest terkunci.
function isOfficeWifiNearby() {
    return scanVisibleNetworks().then(out => OFFICE_SSIDS.some(name => out.includes(name)));
}

// SSID yang sedang dipakai ini layak DITINGGALKAN? Persis dua hal: SPRM-GUEST (jaringan tamu,
// memang tidak pernah menjangkau backend internal) dan SSID asing apa pun -- yang di kantor
// praktis berarti hotspot HP. SSID kantor lain (SPRM-MGT, SPRM-CCTV, dan SPRM-CORP sendiri)
// sengaja TIDAK disentuh: itu jaringan sah, dan backend mati dari sana berarti masalahnya di
// SERVER, bukan di pilihan WiFi -- memindahkan koneksi tidak menolong, hanya memutus yang jalan.
// `ssid` null (WiFi mati / kabel LAN) dihitung layak: tidak ada koneksi WiFi yang dirusak.
function isSwitchableSsid(ssid) {
    return ssid === 'SPRM-GUEST' || !OFFICE_SSIDS.includes(ssid);
}

// Apakah profil WiFi `ssid` sudah tersimpan di laptop ini? Inilah alasan app TIDAK perlu menyimpan
// password WiFi kantor di dalam kodenya: kita hanya menyambung ulang ke profil yang memang sudah
// pernah dibuat user/IT di device ini. Perintah ini murah -- cuma baca konfigurasi tersimpan,
// tidak memicu scan radio seperti `show networks`.
function hasSavedProfile(ssid) {
    return new Promise((resolve) => {
        try {
            execFile('netsh', ['wlan', 'show', 'profiles'], NETSH_OPTS, (err, stdout) => {
                resolve(!err && !!stdout && stdout.includes(ssid));
            });
        } catch (e) {
            resolve(false);
        }
    });
}

// Perintahkan Windows menyambung ke profil WiFi yang sudah tersimpan. Tidak butuh hak admin.
// Timeout lebih panjang dari NETSH_OPTS karena proses asosiasi bisa memakan beberapa detik.
function connectToSsid(ssid) {
    return new Promise((resolve) => {
        try {
            execFile('netsh', ['wlan', 'connect', 'name=' + ssid, 'ssid=' + ssid],
                { timeout: 10000, windowsHide: true }, (err) => resolve(!err));
        } catch (e) {
            resolve(false);
        }
    });
}

// Lepaskan diri dari SSID yang terbukti buntu, supaya Windows bebas menyambung sendiri ke profil
// tersimpan lainnya. Tersambung ke jaringan mati terlihat seperti "connected" padahal tidak bisa
// dipakai; terputus setidaknya jujur dan memunculkan pemilih jaringan Windows untuk user.
function disconnectWifi() {
    return new Promise((resolve) => {
        try {
            execFile('netsh', ['wlan', 'disconnect'], NETSH_OPTS, (err) => resolve(!err));
        } catch (e) {
            resolve(false);
        }
    });
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Cegah percobaan pindah WiFi menumpuk: satu siklus bisa memakan ~65 detik, sementara
// pemanggilnya (patroli background) berjalan berkala.
let wifiJoinInProgress = false;

// Setelah satu percobaan pemindahan gagal, jangan menyentuh WiFi user lagi untuk sementara.
// Tanpa ini pengembalian SSID di bawah justru merusak koneksi user berulang-ulang: dulu
// percobaan yang gagal meninggalkan laptop di SPRM-CORP dan siklus berikutnya berhenti sendiri
// karena SSID aktif sudah = target -- itu rem alaminya. Begitu SSID asal dikembalikan, rem itu
// hilang. Selama masa tenang patroli tetap jalan, tapi hanya mengecek backend (murah).
const JOIN_COOLDOWN_MS = 10 * 60 * 1000; // 10 menit
let joinCooldownUntil = 0;

// Batas menyerah. Tiga percobaan penuh yang gagal (@ ~65 dtk + tenang 10 menit) berarti app sudah
// menghabiskan ~23 menit tanpa hasil: jaringan di tempat ini memang tidak bisa dipakai hari ini.
// Terus mengintai hanya membuang baterai dan tiap 10 menit berisiko menyentuh WiFi user lagi,
// jadi app BERHENTI SENDIRI (lihat patrolTick). Hitungan ini sengaja hidup di dalam proses:
// begitu app mati angkanya ikut hilang, sehingga laptop yang dinyalakan ulang -- atau app yang
// dibuka manual -- selalu mulai dari nol.
const MAX_FAILED_SWEEPS = 3;
let failedSweeps = 0;

// INTI FITUR: coba pindahkan koneksi ke WiFi kantor, lalu PASTIKAN backend benar-benar terjangkau.
// Hanya resolve(true) kalau backend menjawab SETELAH perpindahan -- bukan sekadar "perintah netsh
// tidak error". Selain itu selalu false, dan pemanggil akan menunggu di background.
async function tryJoinOfficeWifiAndVerify() {
    if (wifiJoinInProgress) return false;
    wifiJoinInProgress = true;
    try {
        // [G0b] Masih dalam masa tenang setelah percobaan gagal sebelumnya.
        if (Date.now() < joinCooldownUntil) return false;

        // ===== LANGKAH 2: "cek SPRM-GUEST / hotspot HP" =====
        // Satu scan untuk dua pertanyaan; hasilnya di-cache 8 dtk oleh scanVisibleNetworks().
        // originalSsid dibaca SEBELUM apa pun diubah -- inilah yang nanti dikembalikan kalau
        // percobaan gagal.
        const [originalSsid, officeWifiNearby] = await Promise.all([
            getCurrentSSID(), isOfficeWifiNearby()
        ]);

        // [G1] PENGAMAN TERPENTING, dan sengaja paling murah + paling mungkin gagal duluan:
        // `netsh wlan connect` ke jaringan di luar jangkauan bisa MEMUTUS WiFi yang sedang
        // dipakai. Tidak ada SSID kantor terlihat = tidak di kantor, dan "SSID asing" di situ
        // cuma berarti WiFi rumah. Berhenti tanpa menyentuh apa pun.
        //
        // Syaratnya sengaja "ada SSID kantor MANAPUN yang terlihat", bukan "SPRM-CORP terlihat":
        // `netsh wlan show networks` sering hanya melaporkan sebagian jaringan (hasil scan yang
        // di-cache Windows, dan SSID tersembunyi tidak pernah muncul), jadi menuntut SPRM-CORP
        // ada di daftar akan mematikan fitur ini diam-diam di banyak device. Terlihatnya SSID
        // kantor sudah cukup membuktikan device ada di kantor -- itu properti yang kita butuhkan.
        if (!officeWifiNearby) return false;

        // [G2] Sudah di jaringan kantor yang sah? Berarti masalahnya di SERVER, bukan di WiFi.
        if (!isSwitchableSsid(originalSsid)) return false;

        // [G3] Tidak ada profil tersimpan -- berhenti SEBELUM apa pun diubah, koneksi user utuh.
        if (!(await hasSavedProfile(TARGET_SSID))) return false;

        log.info('Backend mati & device ada di kantor (SSID sekarang: '
               + (originalSsid || 'tidak ada') + ') -- mencoba pindah ke ' + TARGET_SSID + '...');
        if (!(await connectToSsid(TARGET_SSID))) {
            // netsh menolak = koneksi user tidak berubah sama sekali, jadi tidak ada yang perlu
            // dipulihkan dan percobaan ini tidak dihitung sebagai kegagalan.
            log.info('Perintah pindah ke ' + TARGET_SSID + ' ditolak Windows.');
            return false;
        }

        // `netsh wlan connect` melapor SUKSES duluan, sebelum asosiasi + DHCP selesai. Jeda
        // singkat sekali di sini, sisanya ditunggu oleh loop verifikasi di bawah.
        await delay(PROBE_GAP_MS);

        // ===== LANGKAH 2b: CEK INTERNET di SPRM-CORP =====
        // Loop ini merangkap dua tugas: menunggu DHCP benar-benar selesai, dan memutuskan apakah
        // jaringan ini layak dipakai sama sekali.
        let internetOk = false;
        for (let i = 0; i < 3; i++) {
            if (await hasInternetConnection()) { internetOk = true; break; }
            await delay(PROBE_GAP_MS);
        }
        if (!internetOk) log.info(TARGET_SSID + ' tersambung tapi tidak ada internet.');

        // ===== LANGKAH 2c: CEK BACKEND -- satu-satunya jalan menuju sukses =====
        // Keberhasilan WAJIB dibuktikan lewat backend, bukan lewat exit code netsh.
        if (internetOk || !REQUIRE_INTERNET_ON_TARGET) {
            for (let i = 0; i < 2; i++) {
                if (await checkServerConnection()) {
                    log.info('Berhasil pindah ke ' + TARGET_SSID + ' dan backend terjangkau.');
                    return true;
                }
                await delay(PROBE_GAP_MS);
            }
            log.info(TARGET_SSID + ' hidup tapi backend tetap tak terjangkau.');
        }

        // ===== JAMINAN INTERNET =====
        // Perpindahan gagal. Mulai titik ini app BERHENTI mengejar backend; satu-satunya tujuan
        // adalah memastikan user TETAP BISA INTERNETAN. Tiga lapis, masing-masing DIBUKTIKAN.
        //
        // Kegagalan dicatat TEPAT DI SINI, bukan di setiap `return false`. Yang dihitung hanyalah
        // percobaan yang benar-benar sampai memindahkan WiFi lalu gagal; semua keluar lebih awal
        // (di rumah, sudah di jaringan sah, profil tidak ada, netsh menolak) tidak pernah
        // menyentuh koneksi user, jadi tidak boleh ikut menghabiskan jatah MAX_FAILED_SWEEPS.
        joinCooldownUntil = Date.now() + JOIN_COOLDOWN_MS;
        failedSweeps++;
        log.info('Percobaan pemulihan gagal (' + failedSweeps + '/' + MAX_FAILED_SWEEPS + ').');

        // Lapis 1 -- kalau SPRM-CORP ternyata masih punya internet (cuma backend-nya yang mati),
        // tidak ada yang perlu dipindahkan. Nilainya sudah diketahui dari loop di atas.
        if (internetOk) return false;

        // Lapis 2 -- kembalikan jaringan yang tadi dipakai user, lalu BUKTIKAN internetnya hidup.
        // Pengembalian yang gagal diam-diam (hotspot sudah dimatikan, sudah di luar jangkauan,
        // profil terhapus) justru membuat keadaan user LEBIH BURUK daripada sebelum app bertindak.
        if (originalSsid && await connectToSsid(originalSsid)) {
            await delay(PROBE_GAP_MS);
            for (let i = 0; i < 3; i++) {
                if (await hasInternetConnection()) {
                    log.info('Gagal -- koneksi dikembalikan ke ' + originalSsid + '.');
                    return false;
                }
                await delay(PROBE_GAP_MS);
            }
        }

        // Lapis 3 -- pilihan terakhir. Kita tersangkut di SSID yang terbukti tanpa backend DAN
        // tanpa internet, sementara jaringan asal tidak bisa dipulihkan. Lepaskan saja, biar
        // Windows memilih profil lain dan user melihat pemilih jaringan alih-alih ikon
        // "tersambung" yang menipu.
        await disconnectWifi();
        log.warn('Tidak ada jaringan yang bisa dipakai: ' + TARGET_SSID + ' buntu dan jaringan '
               + 'asal tidak bisa dipulihkan. WiFi dilepas supaya Windows bisa memilih sendiri.');
        return false;
    } finally {
        // finally: kunci tetap dilepas walau ada error tak terduga di tengah jalan.
        wifiJoinInProgress = false;
    }
}

// Patroli saat app BELUM terbuka: app diam di background sampai backend benar-benar terjangkau.
// Memakai setTimeout BERANTAI, bukan setInterval -- satu siklus bisa memakan ~65 detik (percobaan
// pindah WiFi + verifikasi), dan setInterval akan menembakkan siklus baru di tengah siklus yang
// belum selesai. Jeda melar 10s -> 60s selama masih gagal supaya laptop yang ditinggal menyala di
// rumah tidak mengecek terus-menerus; direset ke 10s saat laptop bangun/di-unlock, momen paling
// mungkin user baru tiba di kantor.
const PATROL_MIN_MS = 10000;
const PATROL_MAX_MS = 60000;
let patrolDelayMs = PATROL_MIN_MS;
let patrolActive = false;
// Satu siklus patroli, disimpan di sini supaya resetPatrolBackoff() bisa menjadwalkan ulang
// siklus yang SAMA. Penting: jangan pernah membuat rantai timer kedua -- kalau reset memanggil
// startBackgroundPatrol() lagi selagi satu siklus masih berjalan (menunggu netsh/HTTP), rantai
// lama dan rantai baru akan jalan berbarengan selamanya.
let patrolTick = null;

function startBackgroundPatrol() {
    if (patrolActive) return; // sudah jalan, jangan didobelkan
    patrolActive = true;
    patrolDelayMs = PATROL_MIN_MS;
    log.info('Di luar jaringan kantor. Aplikasi menunggu di background...');

    patrolTick = async () => {
        patrolTimer = null; // menandakan "sedang berjalan", bukan "sedang menunggu jeda"

        // Cek yang murah dulu; kalau backend sudah terjangkau, koneksi WiFi tidak perlu disentuh.
        const ready = await checkServerConnection() || await tryJoinOfficeWifiAndVerify();
        if (!patrolActive) return; // dihentikan selagi kita menunggu (mis. app ditutup)

        if (ready) {
            log.info('Backend terjangkau -- memunculkan aplikasi.');
            stopBackgroundPatrol();
            createWindow();
            return;
        }

        // Sudah tiga percobaan penuh yang gagal (~23 menit). Jaringan di tempat ini memang tidak
        // bisa dipakai hari ini -- berhenti daripada mengintai tanpa hasil sampai baterai habis.
        // Keputusan ini sengaja di sini, bukan di dalam tryJoinOfficeWifiAndVerify(): fungsi itu
        // tugasnya menjawab boolean dan punya blok finally yang harus tetap jalan.
        // App hidup lagi saat laptop dinyalakan ulang, saat dibuka manual, atau saat task
        // "PICA Scheduler" menyalakannya jam 10:00 -- semuanya proses baru, jadi failedSweeps
        // mulai dari nol dan seluruh rantai pengecekan diulang dari awal. Penutupan ini tidak
        // terlihat user: jendela memang belum pernah dibuat, app cuma berhenti menghuni background.
        if (failedSweeps >= MAX_FAILED_SWEEPS) {
            log.warn('Menyerah setelah ' + failedSweeps + ' percobaan pemulihan yang gagal. '
                   + 'Aplikasi ditutup; akan mencoba lagi saat dinyalakan berikutnya.');
            stopBackgroundPatrol();
            app.quit();
            return;
        }

        patrolDelayMs = Math.min(Math.round(patrolDelayMs * 1.5), PATROL_MAX_MS);
        patrolTimer = setTimeout(patrolTick, patrolDelayMs);
    };

    patrolTimer = setTimeout(patrolTick, patrolDelayMs);
}

function stopBackgroundPatrol() {
    patrolActive = false;
    if (patrolTimer) clearTimeout(patrolTimer);
    patrolTimer = null;
}

// Laptop baru bangun/di-unlock: kemungkinan besar berpindah tempat, jadi jangan habiskan sisa jeda
// yang terlanjur melar sampai 60 detik -- kembalikan ke ritme cepat. Aman dipanggil kapan saja:
// kalau patroli tidak berjalan (app sudah terbuka), fungsi ini tidak melakukan apa-apa.
function resetPatrolBackoff() {
    if (!patrolActive) return;
    patrolDelayMs = PATROL_MIN_MS;

    // patrolTimer null berarti satu siklus sedang berjalan; siklus itu sendiri yang akan
    // menjadwalkan ulang, dan sudah memakai patrolDelayMs yang baru. Jadi tidak ada yang
    // perlu (dan tidak boleh) dijadwalkan di sini.
    if (!patrolTimer) return;

    clearTimeout(patrolTimer);
    patrolTimer = setTimeout(patrolTick, patrolDelayMs);
}

// =========================================================
// PENGAMAN: MENCEGAH APLIKASI BERJALAN GANDA (SINGLE INSTANCE)
// =========================================================
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show(); 
      mainWindow.focus();
    }
  });
  app.disableHardwareAcceleration();

  app.whenReady().then(async () => {
    
    // 1. Pastikan aplikasi tetap diatur untuk berjalan saat booting
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: false,
      path: app.getPath('exe'),
      args: []
    });

    // 1b. Daftarkan/perbarui task Windows Task Scheduler "PICA Scheduler" -- buka app
    // otomatis tiap jam 10:00 (waktu lokal device, asumsi sudah WITA).
    if (app.isPackaged) ensureScheduledTask();

    // 2. MULAI PENGECEKAN UPDATE OTOMATIS DARI GITHUB RELEASES
    if (app.isPackaged) setupAutoUpdater();

    // 3. PATROLI JARINGAN: reset ritme pengecekan saat laptop bangun/di-unlock. Didaftarkan di
    // sini (bukan di createWindow) karena justru dibutuhkan SELAGI app belum terbuka.
    powerMonitor.on('resume', resetPatrolBackoff);
    powerMonitor.on('unlock-screen', resetPatrolBackoff);

    // 4. CEK KONEKSI PERTAMA KALI SAAT LAPTOP MENYALA.
    // Aturan tunggal: app TIDAK PERNAH dibuka sebelum backend benar-benar terjangkau. Kalau
    // belum, app mencoba memindahkan koneksi ke WiFi kantor; kalau itu pun gagal, app diam di
    // background dan terus mencoba, bukan membuka jendela kosong tanpa data.
    if (await checkServerConnection()) {
        // Langsung terhubung (misal PC kantor yang selalu colok kabel LAN).
        log.info('Terhubung ke jaringan kantor. Membuka layar utama...');
        createWindow();
    } else if (await tryJoinOfficeWifiAndVerify()) {
        // Satu percobaan langsung di sini supaya tidak perlu menunggu tick patroli pertama.
        createWindow();
    } else {
        startBackgroundPatrol();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    isQuitting = true;
    // Lepas semua timer supaya tidak ada pekerjaan yang masih terjadwal saat app ditutup.
    stopBackgroundPatrol();
    if (runtimeNetworkMonitor) {
      clearInterval(runtimeNetworkMonitor);
      runtimeNetworkMonitor = null;
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}