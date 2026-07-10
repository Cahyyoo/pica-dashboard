const { app, BrowserWindow, ipcMain, dialog, powerMonitor } = require('electron'); // 'globalShortcut' dan 'exec' dihapus
const path = require('path');
const fs = require('fs'); 
const http = require('http');

let isDialogOpen = false; 
let isQuitting = false; 
let mainWindow; 

// --- CEK APAKAH APLIKASI DIJALANKAN DARI AUTO-START (SILUMAN) ---
const isHiddenStart = process.argv.includes('--hidden');

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
      return { success: false, error: error.message };
    } finally {
      isDialogOpen = false; 
      if (mainWindow.isVisible()) mainWindow.focus();          
    }
  });
}

// =========================================================
// PENGENDALI KELUAR: MATIKAN APLIKASI SEPENUHNYA
// =========================================================
ipcMain.on('perintah-tutup-paksa', () => {
  app.quit(); // Langsung matikan aplikasi tanpa perlu mengutak-atik OS
});

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

    // 2. CEK KONEKSI PERTAMA KALI SAAT LAPTOP MENYALA
    const isConnectedToOffice = await checkServerConnection();

    if (isConnectedToOffice) {
        // Jika langsung terhubung (misal pakai PC kantor yang selalu colok kabel LAN)
        console.log("Terhubung ke jaringan kantor. Membuka layar utama...");
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