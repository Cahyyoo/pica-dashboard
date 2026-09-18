// keyguard.js
// Keyboard lockdown for the kiosk window, kept in its own module so the verification
// harness can exercise it without booting a fullscreen always-on-top window.
const { Menu, ipcMain } = require('electron');

// Keys that must never reach the window.
//
// Alt                                  reveals the auto-hidden menu bar. Replaced by typing
//                                      Shift+P+I+C+A+S -- see the end of js/app.js.
// Ctrl+R, Ctrl+Shift+R, F5             reload. Wipes all in-memory state, including remark
//                                      points a PIC has typed but not yet saved.
// F12, Ctrl+Shift+J, Ctrl+Shift+C     the DevTools shortcuts an operator is most likely to
//                                      hit by accident. With nodeIntegration enabled and
//                                      contextIsolation disabled, DevTools here is full Node
//                                      access to the machine.
//
// Ctrl+Shift+I is deliberately NOT in that list: it is the one way in, kept for debugging a
// unit already installed in the field. The accelerator comes from the Toggle Developer Tools
// item in buildSafeMenu() below -- dropping a key from this function does not, on its own,
// give it back.
// Ctrl+W                               closes the window. main.js already vetoes the close
//                                      event, but stopping it earlier is cleaner.
//
// Deliberately NOT blocked: Ctrl+C / V / X / A / Z / Y. PICs use those in the remark box
// every day, and breaking them would break the feature this lockdown is meant to protect.
function isBlockedInput(input) {
    const key = String(input.key || '');

    // Bare Alt only. Alt+F4 arrives as key 'F4' with the alt modifier and is left alone, as
    // is AltGr (which reports 'AltGraph', or Ctrl+Alt on some layouts).
    if (key === 'Alt' && !input.control && !input.shift && !input.meta) return true;

    if (key === 'F5' || key === 'F12') return true;

    if (!input.control) return false;
    const lower = key.toLowerCase();
    if (lower === 'r' || lower === 'w') return true;
    if (input.shift && (lower === 'j' || lower === 'c')) return true;
    return false;
}

// Electron's default menu, minus Reload / Force Reload. Blocking the shortcuts alone is not
// enough: those items stay clickable in the menu that the chord opens, which would defeat the
// point entirely. Toggle Developer Tools is kept -- it is what binds Ctrl+Shift+I, and now
// that DevTools is allowed on purpose the menu entry is a second door to the same room, not
// a leak.
function buildSafeMenu() {
    return Menu.buildFromTemplate([
        { role: 'fileMenu' },
        { role: 'editMenu' },
        {
            label: 'View',
            submenu: [
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' },
                { role: 'toggleDevTools' },
            ],
        },
        { role: 'windowMenu' },
    ]);
}

let toggleChannelReady = false;

function installKeyGuards(win) {
    Menu.setApplicationMenu(buildSafeMenu());

    // preventDefault() here makes Electron stop before it dispatches the key to the native
    // window, so it kills both the menu accelerator and the Alt auto-hide toggle -- neither
    // of which the renderer could reach on its own.
    win.webContents.on('before-input-event', (event, input) => {
        if (isBlockedInput(input)) event.preventDefault();
    });

    if (toggleChannelReady) return;
    toggleChannelReady = true;
    ipcMain.on('pica-toggle-menu-bar', () => {
        if (!win || win.isDestroyed()) return;
        win.setMenuBarVisibility(!win.isMenuBarVisible());
    });
}

module.exports = { installKeyGuards, isBlockedInput, buildSafeMenu };