// contextmenu.js
// Right-click menu for the kiosk window. Electron ships NO default context menu at all, so
// right-click does nothing until something like this exists -- and whatever this builds is
// the complete, exhaustive set of what a right-click can ever reach in this app.
//
// Kept in its own module, and split into a pure template builder plus a thin installer, so
// the verification harness can assert every shape of the menu without a human clicking and
// without popping a real native menu (on Windows menu.popup() spins a nested message loop
// that nothing in a harness would ever dismiss).
const { Menu } = require('electron');

// Deliberately absent: Inspect / Toggle DevTools. keyguard.js blocks Ctrl+Shift+I and F12
// because DevTools here means full Node access to the machine (nodeIntegration is on), and
// putting it back in this menu would undo that entirely.
function buildContextMenuTemplate(params, wc) {
    const flags = (params && params.editFlags) || {};
    const hasSelection = String((params && params.selectionText) || '').trim().length > 0;

    // isEditable is checked FIRST: an empty focused text box has no selection but must still
    // offer Paste and Select All.
    if (params && params.isEditable) {
        return [
            { label: 'Cut', accelerator: 'CmdOrCtrl+X', enabled: !!flags.canCut, click: () => wc.cut() },
            { label: 'Copy', accelerator: 'CmdOrCtrl+C', enabled: !!flags.canCopy, click: () => wc.copy() },
            { label: 'Paste', accelerator: 'CmdOrCtrl+V', enabled: !!flags.canPaste, click: () => wc.paste() },
            { type: 'separator' },
            { label: 'Select All', accelerator: 'CmdOrCtrl+A', enabled: !!flags.canSelectAll, click: () => wc.selectAll() },
        ];
    }

    if (hasSelection) {
        return [
            { label: 'Copy', accelerator: 'CmdOrCtrl+C', enabled: !!flags.canCopy, click: () => wc.copy() },
            { type: 'separator' },
            { label: 'Select All', accelerator: 'CmdOrCtrl+A', enabled: !!flags.canSelectAll, click: () => wc.selectAll() },
        ];
    }

    // Nothing editable and nothing selected -- an empty menu would just be noise.
    return [];
}

// Items are always shown and merely disabled, never hidden: a Cut that appears and vanishes
// depending on where you clicked is harder to learn than one that is simply greyed out.
//
// Explicit click handlers bound to the captured webContents rather than `role:` -- Electron
// resolves a role against getFocusedWebContents() at click time, not against the window the
// menu was popped over. In a single-window kiosk those are the same thing, but explicit
// handlers are deterministic and, more usefully, testable.
function installContextMenu(win, options) {
    const popup = (options && options.popup) || ((menu) => menu.popup({ window: win }));

    win.webContents.on('context-menu', (event, params) => {
        if (!win || win.isDestroyed()) return;
        const template = buildContextMenuTemplate(params, win.webContents);
        if (template.length === 0) return;
        popup(Menu.buildFromTemplate(template), params);
    });
}

module.exports = { installContextMenu, buildContextMenuTemplate };