const { app, BrowserWindow, ipcMain, dialog, powerMonitor } = require('electron'); // 'globalShortcut' dihapus
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
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
// terjangkau lagi.
let isGuestLocked = false;
let runtimeNetworkMonitor = null;

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
        icon: path.join(__dirname, 'img/logo.png'), 
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
    icon: path.join(__dirname, 'img/logo.png'), 
    show: false, 
    webPreferences: {
      nodeIntegration: true, contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');

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
    const [reachable, ssid] = await Promise.all([checkServerConnection(), getCurrentSSID()]);
    let changed = false;

    if (reachable && isGuestLocked) {
      // Backend terjangkau lagi -- lepas kunci otomatis, tidak perlu restart app.
      isGuestLocked = false;
      changed = true;
      log.info('Backend terjangkau lagi -- mode Guest terkunci otomatis dilepas.');
    } else if (!reachable && ssid === 'SPRM-GUEST' && !isGuestLocked) {
      // WiFi berpindah ke SPRM-GUEST saat app sudah berjalan -- kunci Exit App & Logout.
      isGuestLocked = true;
      changed = true;
      log.info('WiFi berpindah ke SPRM-GUEST saat app berjalan -- Exit App/Logout dikunci.');
    }
    // Kondisi lain (unreachable & SSID selain SPRM-GUEST, mis. WiFi terputus sementara)
    // sengaja TIDAK mengubah status lock -- di luar cakupan fitur ini.

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
      { timeout: 15000 },
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
            req.abort(); 
            resolve(false); 
        });
    });
}

// Baca SSID WiFi yang sedang aktif (Windows) lewat `netsh wlan show interfaces`.
// Dipakai khusus untuk mendeteksi SSID "SPRM-GUEST" (jaringan tamu yang memang tidak
// pernah bisa menjangkau backend internal) supaya app tetap dibuka dalam mode terkunci,
// bukan menghilang selamanya seperti perilaku default saat backend tak terjangkau.
// Tidak pernah throw/reject -- kegagalan apapun (perintah gagal, format tak dikenali, dsb.)
// aman jatuh ke `null`, yang berarti perilaku LAMA (polling tanpa henti) tetap berlaku.
function getCurrentSSID() {
    return new Promise((resolve) => {
        try {
            execFile('netsh', ['wlan', 'show', 'interfaces'], { timeout: 5000 }, (err, stdout) => {
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

    // 3. CEK KONEKSI PERTAMA KALI SAAT LAPTOP MENYALA (SSID dicek paralel, sekali saja saat boot)
    const [isConnectedToOffice, ssid] = await Promise.all([
        checkServerConnection(),
        getCurrentSSID(),
    ]);

    if (isConnectedToOffice) {
        // Jika langsung terhubung (misal pakai PC kantor yang selalu colok kabel LAN)
        console.log("Terhubung ke jaringan kantor. Membuka layar utama...");
        createWindow();
    } else if (ssid === 'SPRM-GUEST') {
        // SSID Guest memang tidak pernah bisa menjangkau backend internal -- tetap buka
        // app-nya (walau datanya kosong karena tak ada backend), tapi kunci Exit App &
        // Logout sepenuhnya sampai app di-restart di jaringan yang benar.
        console.log("Terhubung ke SPRM-GUEST (backend tak terjangkau dari SSID ini). Membuka dalam mode Guest terkunci...");
        isGuestLocked = true;
        createWindow();
    } else {
        // JIKA TIDAK TERHUBUNG (Misal di rumah atau di jalan)
        console.log("Di luar jaringan. Aplikasi bersembunyi dan menunggu sinyal...");

        // Buat radar pengecekan setiap 10 detik (10.000 milidetik)
        const patroliJaringan = setInterval(async () => {
            const connectedNow = await checkServerConnection();

            if (connectedNow) {
                console.log("WiFi Kantor terdeteksi! Memunculkan aplikasi...");

                // Matikan radar agar tidak terus-menerus mengecek setelah terbuka
                clearInterval(patroliJaringan);

                // Buka antarmuka aplikasi!
                createWindow();
            }
        }, 10000); // Anda bisa mengubah angka ini (misal 30000 untuk 30 detik)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}