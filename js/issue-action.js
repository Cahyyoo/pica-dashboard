// js/issue-action.js
import { API_URL, getAuthHeaders } from './config.js';
import { showCustomAlert, showView, showCustomConfirm, stripAutoForwardNotes, escapeHtml, isEditableLastUpdate, kirimSekali, riwayatTerbaru, lupakanCacheIssue } from './utils.js';
import { state } from './issue-state.js';
import { loadDashboardMD, loadDashboardPIC } from './issue-dashboard.js';
import { openDetailView, backFromDetail } from './issue-detail.js';

// Dibungkus kirimSekali(): tombolnya dikunci selama permintaan berjalan, supaya
// ketukan kedua tidak membuat baris/perubahan kembar.
export const submitIssue = () => kirimSekali('btn-submit-issue', 'Submitting...', submitIssueInti);
async function submitIssueInti() {
    const title = document.getElementById('issue-title').value;
    const dept = document.getElementById('issue-dept').value;
    const desc = document.getElementById('issue-desc').value;
    const dueDate = document.getElementById('issue-due-date').value;
    const correctiveAction = document.getElementById('issue-corrective-action').value;
    const category = document.getElementById('issue-category').value;
    const issuerId = localStorage.getItem('user_id');

    if (!title || !dept || !desc || !dueDate || !correctiveAction || !category) return showCustomAlert("Warning", "All fields are required!");

    try {
        const response = await fetch(`${API_URL}/issue/create`, {
            method: 'POST', headers: getAuthHeaders(),
            body: JSON.stringify({ title, department: dept, description: desc, correctiveAction, category, issuedBy: String(issuerId), dueDate: dueDate, priority: "Pending" })
        });

        if (response.ok) {
            showCustomAlert("Success", "Report submitted successfully!");
            document.getElementById('issue-title').value = '';
            document.getElementById('issue-dept').value = '';
            document.getElementById('issue-desc').value = '';
            document.getElementById('issue-due-date').value = '';
            document.getElementById('issue-corrective-action').value = '';
            document.getElementById('issue-category').value = '';
            window.backToMenu();
        } else showCustomAlert("Failed", "Server error occurred.");
    } catch (error) { showCustomAlert("Server Error", "Failed to connect to backend."); }
}

export function openUpdateFromDetail() {
    const issue = state.detailIssue;
    if (!issue) return;

    const role = localStorage.getItem('user_role');

    // BLOKIR: Dept Head tidak bisa mengubah issue yang sudah Closed.
    // MD tetap diizinkan agar bisa membetulkan data (mis. hasil Import Excel yang keliru).
    if (issue.status === 'Closed' && role !== 'MD') {
        showCustomAlert("Access Denied", "This issue has been closed and can no longer be updated.");
        return;
    }

    openUpdateModal(issue);
}

// ==========================================
// PER-POINT REMARK (each point carries its own In Progress/Closed status,
// separate from the issue-wide "Current Status" dropdown)
// ==========================================
const MAX_REMARK_POINTS = 10;
// Hoisted out of submitUpdate() so the row builder can surface the rule live while the
// user types, instead of it only appearing in a toast after Save has already failed.
const MIN_REMARK_POINT_LENGTH = 10;
// ~4 lines at line-height 20 + padding 16 + border 2. Past this the textarea scrolls.
const REMARK_TEXT_MAX_H = 98;
// Soft warning only. No maxlength: a long point carried over from the previous update
// must never be silently truncated when the modal loads it back.
const REMARK_LONG_WARN = 300;

// A point is serialised as one line of "N. [Status] text" and read back by the regex in
// parsePreviousRemarkPoints(). A line break inside a point would leave its second half
// unparseable and it would vanish on the next update, so separators are folded to a space.
// Nothing else is touched: this must stay the identity function for every value the
// previous single-line <input> could hold, otherwise saved output would change.
function sanitizeRemarkText(value) {
    return String(value == null ? '' : value).replace(/[\r\n\u2028\u2029]+/g, ' ');
}

// Parsed once at module load and cloned per row, instead of re-parsing ~700 bytes of HTML
// for every row on every modal open.
const REMARK_ROW_TEMPLATE = document.createElement('template');
REMARK_ROW_TEMPLATE.innerHTML = [
    '<div class="remark-point-row">',
    '<div class="remark-point-head">',
    '<span class="remark-point-num"></span>',
    '<div class="remark-seg" role="radiogroup" aria-label="Point status">',
    '<button type="button" class="remark-seg-btn is-active" data-status="Progress" role="radio" aria-checked="true" tabindex="0">In Progress</button>',
    '<button type="button" class="remark-seg-btn" data-status="Closed" role="radio" aria-checked="false" tabindex="-1">Closed</button>',
    '</div>',
    // The value still lives in an element exposing .value, so submitUpdate() reads it
    // exactly as it read the <select> this replaced. The write path stays untouched.
    '<input type="hidden" class="remark-point-status" value="Progress">',
    '<span class="badge badge-exempt remark-chip-carry" hidden>carried over</span>',
    '<span class="remark-point-count"></span>',
    '<button type="button" class="remark-point-del" title="Remove point" aria-label="Remove point">&times;</button>',
    '</div>',
    '<textarea class="remark-point-text" rows="1" placeholder="Describe this point..."></textarea>',
    '<small class="remark-point-error" hidden></small>',
    '</div>'
].join('');

function getRemarkContainer() {
    return document.getElementById('update-remark-points-container');
}

function renumberRemarkPoints() {
    const container = getRemarkContainer();
    if (!container) return;
    Array.from(container.children).forEach((row, index) => {
        const numEl = row.querySelector('.remark-point-num');
        if (numEl) numEl.innerText = `${index + 1}.`;
    });
    updateRemarkCounters();
}

// Panel-level counters. Deliberately NOT called while typing: only adding or removing a
// row can change these, so a keystroke never triggers a query across the whole list.
function updateRemarkCounters() {
    const container = getRemarkContainer();
    if (!container) return;
    const total = container.children.length;

    const counter = document.getElementById('remark-point-counter');
    if (counter) {
        counter.textContent = `${total}/${MAX_REMARK_POINTS}`;
        counter.classList.toggle('is-full', total >= MAX_REMARK_POINTS);
    }
    // Disabling the button beats letting the 11th click fail with a toast.
    const btnAdd = document.getElementById('btn-add-remark-point');
    if (btnAdd) btnAdd.disabled = total >= MAX_REMARK_POINTS;

    const carried = container.querySelectorAll('.remark-point-row.is-carry-closed').length;
    const btnClear = document.getElementById('btn-clear-carried-closed');
    if (btnClear) {
        btnClear.hidden = carried === 0;
        btnClear.textContent = `Clear ${carried} completed`;
    }
}

// Live per-row counter: the 10-character rule used to be invisible until Save failed.
function updateRemarkPointCount(row) {
    const el = row.querySelector('.remark-point-count');
    if (!el) return;
    const len = sanitizeRemarkText(row.querySelector('.remark-point-text').value).trim().length;
    el.classList.remove('is-short', 'is-ok');
    if (len === 0) {
        el.textContent = `min. ${MIN_REMARK_POINT_LENGTH}`;
    } else if (len < MIN_REMARK_POINT_LENGTH) {
        el.textContent = `${len}/${MIN_REMARK_POINT_LENGTH}`;
        el.classList.add('is-short');
    } else if (len > REMARK_LONG_WARN) {
        el.textContent = `${len} - very long`;
        el.classList.add('is-short');
    } else {
        el.textContent = `${len} ✓`;
        el.classList.add('is-ok');
    }
}

// Height follows content. Skipping when the value has not changed avoids a forced
// synchronous layout on keystrokes that cannot affect wrapping (arrows, modifiers).
function autoGrowRemarkText(el) {
    if (el.dataset.lastValue === el.value) return;
    el.dataset.lastValue = el.value;
    el.style.height = 'auto';
    const needed = el.scrollHeight + 2; // scrollHeight excludes the 1px top/bottom borders
    el.style.height = Math.min(needed, REMARK_TEXT_MAX_H) + 'px';
    el.style.overflowY = needed > REMARK_TEXT_MAX_H ? 'auto' : 'hidden';
}

// Measuring one textarea at a time interleaves writes and reads, so a 10-point list costs
// 10 forced layouts. Doing it in three phases - reset every height, read every height, then
// apply every height - costs one. Measured on a 10-point modal: 10.0ms -> 2.2ms.
function autoGrowRemarkTextAll(container) {
    const list = Array.from(container.querySelectorAll('.remark-point-text'));
    if (list.length === 0) return;
    list.forEach(el => { el.style.height = 'auto'; });                 // write
    const needed = list.map(el => el.scrollHeight + 2);                // read (one layout)
    list.forEach((el, i) => {                                          // write
        el.style.height = Math.min(needed[i], REMARK_TEXT_MAX_H) + 'px';
        el.style.overflowY = needed[i] > REMARK_TEXT_MAX_H ? 'auto' : 'hidden';
        el.dataset.lastValue = el.value;
    });
}

// While seeding a whole list, per-row growing and renumbering are skipped and run once at
// the end. Without this, adding N rows is O(N) forced layouts plus O(N^2) renumber passes.
let remarkBatchMode = false;

function setRemarkStatus(row, status) {
    const value = status === 'Closed' ? 'Closed' : 'Progress';
    row.querySelector('.remark-point-status').value = value;
    row.querySelectorAll('.remark-seg-btn').forEach(btn => {
        const on = btn.dataset.status === value;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-checked', String(on));
        btn.tabIndex = on ? 0 : -1; // roving tabindex: the pair is a single Tab stop
    });
}

// Once the user edits or re-tags a carried point it is today's work, not leftovers, so it
// stops being a target for "Clear N completed".
function markRowTouched(row) {
    if (!row.classList.contains('is-carry-closed')) return;
    row.classList.remove('is-carry-closed');
    const chip = row.querySelector('.remark-chip-carry');
    if (chip) chip.hidden = true;
    updateRemarkCounters();
}

function markRemarkRowError(row, message) {
    row.classList.add('has-error');
    const el = row.querySelector('.remark-point-error');
    el.textContent = message;
    el.hidden = false;
}

function clearRemarkRowError(row) {
    if (!row.classList.contains('has-error')) return;
    row.classList.remove('has-error');
    const el = row.querySelector('.remark-point-error');
    el.textContent = '';
    el.hidden = true;
}

function focusRemarkRow(row) {
    row.scrollIntoView({ block: 'nearest' });
    row.querySelector('.remark-point-text').focus();
}

function buildRemarkRow(text, status, carried) {
    const row = REMARK_ROW_TEMPLATE.content.firstElementChild.cloneNode(true);
    row.id = 'remark-point-' + Date.now() + Math.random().toString(36).slice(2, 7);

    const clean = sanitizeRemarkText(text);
    const value = status === 'Closed' ? 'Closed' : 'Progress';

    // Assigned as a property, never interpolated into markup, so quotes and angle brackets
    // in the previous update's text cannot break out of the template.
    row.querySelector('.remark-point-text').value = clean;
    setRemarkStatus(row, value);

    // Baseline for the dirty check on Cancel/Escape and for "Clear N completed".
    row.dataset.seedText = clean.trim();
    row.dataset.seedStatus = value;

    if (carried && value === 'Closed') {
        row.classList.add('is-carry-closed');
        row.querySelector('.remark-chip-carry').hidden = false;
    }
    return row;
}

window.addRemarkPoint = function (text = '', status = 'Progress', carried = false) {
    const container = getRemarkContainer();
    if (!container) return null;
    ensureRemarkDelegation(container);

    if (container.children.length >= MAX_REMARK_POINTS) {
        showCustomAlert("Warning", `Maximum ${MAX_REMARK_POINTS} remark points allowed.`);
        return null;
    }

    const row = buildRemarkRow(text, status, carried);
    container.appendChild(row);
    const textarea = row.querySelector('.remark-point-text');
    updateRemarkPointCount(row); // cheap: no layout is read here
    if (!remarkBatchMode) {
        autoGrowRemarkText(textarea); // must already be in the document to be measurable
        renumberRemarkPoints();
    }

    // Only focus a genuinely new, empty row. Seeded rows always carry text, so opening the
    // modal never jumps to the bottom of the list.
    if (text === '') {
        requestAnimationFrame(() => {
            textarea.focus();
            row.scrollIntoView({ block: 'nearest' });
        });
    }
    return row;
};

function requestRemoveRemarkPoint(row) {
    const text = sanitizeRemarkText(row.querySelector('.remark-point-text').value).trim();
    // A point long enough to be valid is real work, and on a touchscreen the small x is
    // easy to hit by accident. Short or empty rows go straight away.
    if (text.length >= MIN_REMARK_POINT_LENGTH) {
        return showCustomConfirm("Remove Point", `Remove this point?\n\n"${text}"`, () => doRemoveRemarkPoint(row));
    }
    doRemoveRemarkPoint(row);
}

function doRemoveRemarkPoint(row) {
    const container = getRemarkContainer();
    if (!container) return;

    // The last row is cleared, not deleted: every other path assumes the list always holds
    // at least one row, and an empty list is a dead end for the user.
    if (container.children.length <= 1) {
        const textarea = row.querySelector('.remark-point-text');
        textarea.value = '';
        setRemarkStatus(row, 'Progress');
        row.classList.remove('is-carry-closed');
        row.querySelector('.remark-chip-carry').hidden = true;
        row.dataset.seedText = '';
        row.dataset.seedStatus = 'Progress';
        clearRemarkRowError(row);
        autoGrowRemarkText(textarea);
        updateRemarkPointCount(row);
        textarea.focus();
    } else {
        row.remove();
    }
    renumberRemarkPoints();
}

// Kept on window for backward compatibility with any markup still calling it by id.
window.removeRemarkPoint = function (id) {
    const row = document.getElementById(id);
    if (row) requestRemoveRemarkPoint(row);
};

window.clearCarriedClosedPoints = function () {
    const container = getRemarkContainer();
    if (!container) return;
    const targets = Array.from(container.querySelectorAll('.remark-point-row.is-carry-closed'))
        .filter(row => sanitizeRemarkText(row.querySelector('.remark-point-text').value).trim() === (row.dataset.seedText || ''));
    if (targets.length === 0) return;

    showCustomConfirm(
        "Clear Completed Points",
        `${targets.length} point(s) carried over from the last update will be removed from this list. Points you typed or edited today are not affected.`,
        () => {
            targets.forEach(row => row.remove());
            if (container.children.length === 0) window.addRemarkPoint();
            renumberRemarkPoints();
        }
    );
};

function focusNextOrCreateRemarkPoint(textarea) {
    const row = textarea.closest('.remark-point-row');
    const next = row.nextElementSibling;
    if (next) return next.querySelector('.remark-point-text').focus();
    window.addRemarkPoint(); // focuses itself, or warns when already at the maximum
}

// Pasting the remark block straight out of the detail timeline is the most likely way a
// line break would ever reach a point, so instead of refusing it we split it into rows and
// reuse the "N." prefix and [Status] tag that block already carries.
function distributeMultilinePaste(textarea, raw) {
    const parts = raw.split(/\r\n|[\r\n\u2028\u2029]/)
        .map(line => {
            let text = line.trim().replace(/^\d+[.)]\s*/, '');
            let status = null;
            const tag = text.match(/^\[(In Progress|Closed)\]\s*/i);
            if (tag) {
                status = tag[1].toLowerCase() === 'closed' ? 'Closed' : 'Progress';
                text = text.slice(tag[0].length);
            }
            return { text: text.trim(), status };
        })
        .filter(part => part.text);
    if (parts.length === 0) return;

    const container = getRemarkContainer();
    const row = textarea.closest('.remark-point-row');

    // setRangeText keeps native undo intact, unlike assigning .value directly.
    textarea.setRangeText(parts[0].text, textarea.selectionStart, textarea.selectionEnd, 'end');
    if (parts[0].status) setRemarkStatus(row, parts[0].status);
    markRowTouched(row);
    clearRemarkRowError(row);
    autoGrowRemarkText(textarea);
    updateRemarkPointCount(row);

    let anchor = row;
    let dropped = 0;
    for (let i = 1; i < parts.length; i++) {
        if (container.children.length >= MAX_REMARK_POINTS) { dropped = parts.length - i; break; }
        const created = buildRemarkRow(parts[i].text, parts[i].status || 'Progress', false);
        container.insertBefore(created, anchor.nextSibling);
        updateRemarkPointCount(created);
        anchor = created;
    }
    autoGrowRemarkTextAll(container); // one pass for every row the paste created
    renumberRemarkPoints();
    if (dropped > 0) {
        showCustomAlert("Warning", `Only ${MAX_REMARK_POINTS} points fit. ${dropped} pasted line(s) were not added.`);
    }
}

function handleSegmentKeydown(event, segment) {
    const buttons = Array.from(segment.parentElement.querySelectorAll('.remark-seg-btn'));
    const index = buttons.indexOf(segment);
    let target = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') target = buttons[(index + 1) % buttons.length];
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') target = buttons[(index - 1 + buttons.length) % buttons.length];
    else if (event.key === 'Home') target = buttons[0];
    else if (event.key === 'End') target = buttons[buttons.length - 1];
    else if (event.key === ' ' || event.key === 'Enter') target = segment;
    if (!target) return;

    event.preventDefault();
    event.stopPropagation(); // Enter here must not also create a new point
    const row = segment.closest('.remark-point-row');
    setRemarkStatus(row, target.dataset.status);
    markRowTouched(row);
    target.focus();
}

// One set of listeners on the container, attached once, instead of six per row rebuilt on
// every modal open. closeUpdateModal() empties the container with innerHTML = '', which
// would silently drop per-row listeners anyway; the container element itself survives.
let remarkDelegationReady = false;
function ensureRemarkDelegation(container) {
    if (remarkDelegationReady) return;
    remarkDelegationReady = true;

    container.addEventListener('click', (event) => {
        const segment = event.target.closest('.remark-seg-btn');
        if (segment) {
            const row = segment.closest('.remark-point-row');
            setRemarkStatus(row, segment.dataset.status);
            markRowTouched(row);
            return;
        }
        const del = event.target.closest('.remark-point-del');
        if (del) requestRemoveRemarkPoint(del.closest('.remark-point-row'));
    });

    container.addEventListener('input', (event) => {
        const textarea = event.target.closest('.remark-point-text');
        if (!textarea) return;
        const row = textarea.closest('.remark-point-row');
        autoGrowRemarkText(textarea);
        updateRemarkPointCount(row);
        clearRemarkRowError(row);
        markRowTouched(row);
    });

    container.addEventListener('keydown', (event) => {
        const segment = event.target.closest('.remark-seg-btn');
        if (segment) return handleSegmentKeydown(event, segment);

        const textarea = event.target.closest('.remark-point-text');
        if (!textarea) return;
        // While an IME is composing, Enter commits the candidate. Swallowing it here would
        // cancel the composition instead. keyCode 229 is the pre-isComposing fallback.
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key !== 'Enter') return;
        // Shift+Enter is blocked too: a soft line break is exactly what breaks the format.
        event.preventDefault();
        focusNextOrCreateRemarkPoint(textarea);
    });

    container.addEventListener('paste', (event) => {
        const textarea = event.target.closest('.remark-point-text');
        if (!textarea) return;
        const raw = (event.clipboardData || window.clipboardData).getData('text/plain');
        if (!/[\r\n\u2028\u2029]/.test(raw)) return; // single line: let the browser handle it
        event.preventDefault();
        distributeMultilinePaste(textarea, raw);
    });

    container.addEventListener('compositionend', (event) => {
        const textarea = event.target.closest('.remark-point-text');
        if (!textarea) return;
        autoGrowRemarkText(textarea);
        updateRemarkPointCount(textarea.closest('.remark-point-row'));
    });
}

// Read the points back from the LAST update (e.g. yesterday's) so the PIC does not retype
// the same points every day - they just flip In Progress -> Closed as work completes, or
// add new ones. Only matches the "1. [Status] text" shape produced by this feature; free
// text written before it existed is ignored and the modal starts with one empty point.
// Split out so seeding from the previous update and seeding for an edit share one regex --
// two copies would be two chances for the stored format and the parser to drift apart.
function parseRemarkPointsFromText(remark) {
    const cleanedRemark = stripAutoForwardNotes(remark);
    if (!cleanedRemark) return [];

    const pointPattern = /^\d+\.\s*\[(In Progress|Closed)\]\s*(.+)$/i;
    const points = [];
    cleanedRemark.split('\n').forEach(line => {
        const match = line.trim().match(pointPattern);
        if (match) {
            const status = match[1].toLowerCase() === 'closed' ? 'Closed' : 'Progress';
            points.push({ text: match[2].trim(), status, carried: true });
        }
    });
    return points;
}

function parsePreviousRemarkPoints(issue) {
    if (!issue.histories || issue.histories.length === 0) return [];
    const latestHistory = riwayatTerbaru(issue.histories);
    return parseRemarkPointsFromText(latestHistory.remark);
}

function resetRemarkPoints(seedPoints = []) {
    const container = getRemarkContainer();
    if (container) container.innerHTML = '';
    remarkBatchMode = true;
    try {
        if (seedPoints.length > 0) {
            seedPoints.forEach(p => window.addRemarkPoint(p.text, p.status, p.carried));
        } else {
            window.addRemarkPoint(); // always start with at least one empty point
        }
    } finally {
        remarkBatchMode = false;
    }
    // Heights are deliberately NOT measured here. resetRemarkPoints() only ever runs from
    // openUpdateModal(), which measures the whole list in one batch on the next frame - by
    // then the modal has its final width, and it is still mid fade-in so nothing is seen
    // resizing. This keeps the click that opens the modal free of any forced layout.
    renumberRemarkPoints();
}

// The update modal is reused for editing rather than duplicated: a second modal would mean a
// second copy of the remark rows, the auto-grow logic, the validation and the dirty guard.
// 'new' appends a fresh history entry; 'edit' corrects the most recent one in place.
let updateModalMode = 'new';
let editingHistoryId = null;

function applyUpdateModalMode(mode) {
    updateModalMode = mode;
    const edit = mode === 'edit';

    const judul = document.querySelector('#modal-update .modal-head h3');
    if (judul) judul.innerText = edit ? 'Edit Last Update' : 'Update PICA Progress';
    const sub = document.querySelector('#modal-update .modal-head .subtitle');
    if (sub) sub.innerText = edit ? 'Correct the progress note you saved today.' : 'Update status and progress notes.';
    const btnSave = document.querySelector('#modal-update .modal-foot button');
    if (btnSave) btnSave.innerText = edit ? 'Save Edit' : 'Save Changes';

    // Forwarding is an event, not a correction. The field is hidden AND cleared, so a value
    // left over from a previous open cannot ride along with an edit.
    const picSelect = document.getElementById('update-pic');
    const picGroup = picSelect ? picSelect.closest('.form-group') : null;
    if (picGroup) picGroup.hidden = edit;
    if (picSelect && edit) picSelect.value = '';

    // Closing requires evidence and is a real state change; it goes through Update Progress.
    const closedOption = document.querySelector('#update-status option[value="Closed"]');
    if (closedOption) closedOption.disabled = edit;

    const kept = document.getElementById('update-existing-evidence');
    if (kept) { kept.innerHTML = ''; kept.hidden = true; }
}

// Chips for the attachments this entry already has, each one removable. Removing a chip only
// drops it from the active list -- the path stays in evidenceUrlAll and the file stays on disk.
function renderExistingEvidence(evidenceUrl) {
    const wrap = document.getElementById('update-existing-evidence');
    if (!wrap) return;
    const paths = String(evidenceUrl || '').split(',').filter(Boolean);
    if (paths.length === 0) { wrap.innerHTML = ''; wrap.hidden = true; return; }

    wrap.hidden = false;
    wrap.innerHTML = '<label>Current attachments</label>' + paths.map((p, i) =>
        '<span class="evidence-chip" data-path="' + escapeHtml(p) + '" data-keep="1">'
        + 'File ' + (i + 1)
        + '<button type="button" class="evidence-chip-del" title="Remove this attachment">&times;</button>'
        + '</span>').join('');

    if (wrap.dataset.wired !== '1') {
        wrap.dataset.wired = '1';
        // One delegated listener for the life of the page, like the remark rows.
        wrap.addEventListener('click', (event) => {
            const btn = event.target.closest('.evidence-chip-del');
            if (!btn) return;
            const chip = btn.closest('.evidence-chip');
            const keep = chip.dataset.keep === '1';
            chip.dataset.keep = keep ? '0' : '1';
            chip.classList.toggle('is-removed', keep);
        });
    }
}

function openUpdateModal(issue) {
    applyUpdateModalMode('new');
    editingHistoryId = null;
    document.getElementById('update-id').value = issue.id;
    document.getElementById('update-status').value = issue.status;
    resetRemarkPoints(parsePreviousRemarkPoints(issue));

    const fileInput = document.getElementById('update-evidence');
    if (fileInput) fileInput.value = '';

    const selectPic = document.getElementById('update-pic');
    const currentUserId = String(localStorage.getItem('user_id'));

    if (selectPic) {
        let options = '<option value="">-- Keep Current PIC --</option>';
        let previousPicId = null;
        if (issue.involvedPicIds) {
            const historyArray = issue.involvedPicIds.split(',');
            const currentIndex = historyArray.indexOf(String(issue.picId));
            if (currentIndex > 0) previousPicId = historyArray[currentIndex - 1];
        }

        state.globalUsers.forEach(u => {
            const roleName = (typeof u.role === 'object' && u.role !== null) ? u.role.name : u.role;
            if (roleName === 'Dept Head') {
                if (String(u.id) !== String(issue.picId) && String(u.id) !== currentUserId) {
                    const deptName = u.department || 'Unknown Dept';
                    let label = `${u.username} (${deptName})`;
                    if (String(u.id) === String(previousPicId)) label = `🔙 RETURN TASK TO: ${u.username} (${deptName})`;
                    options += `<option value="${u.id}">${escapeHtml(label)}</option>`;
                }
            }
        });
        selectPic.innerHTML = options;
    }
    toggleEvidenceHint();
    document.getElementById('modal-update').classList.add('show');

    // One batched pass after the modal is shown: seeded rows were measured while the
    // overlay was still hidden, and .show can change the available width. Doing it in a
    // single frame avoids the read-write-read pattern that would force one reflow per row.
    requestAnimationFrame(() => {
        const container = getRemarkContainer();
        if (!container) return;
        autoGrowRemarkTextAll(container); // one batched re-measure at the final width
        const first = container.querySelector('.remark-point-row .remark-point-text');
        if (first) first.focus();
    });
}

// Tampilkan/sembunyikan hint "wajib lampirkan file" sesuai status yang dipilih di modal Update.
export function toggleEvidenceHint() {
    const statusEl = document.getElementById('update-status');
    const hintEl = document.getElementById('update-evidence-hint');
    if (!statusEl || !hintEl) return;
    hintEl.style.display = (statusEl.value === 'Closed') ? 'block' : 'none';
}

// "Dirty" means anything differs from the state the modal opened with. Each row records
// its seeded text/status in dataset, so this needs no separate snapshot.
function isUpdateModalDirty() {
    const fileInput = document.getElementById('update-evidence');
    if (fileInput && fileInput.files.length > 0) return true;
    const container = getRemarkContainer();
    if (!container) return false;
    return Array.from(container.querySelectorAll('.remark-point-row')).some(row =>
        sanitizeRemarkText(row.querySelector('.remark-point-text').value).trim() !== (row.dataset.seedText || '')
        || row.querySelector('.remark-point-status').value !== (row.dataset.seedStatus || 'Progress'));
}

// Cancel and Escape both route through here. Closing used to discard up to ten typed
// points without asking, which on a kiosk is how ten minutes of work disappears.
// Open the modal preloaded with an existing entry, in edit mode.
export function openEditUpdateModal(historyId) {
    const issue = state.detailIssue;
    if (!issue) return;
    const hist = (issue.histories || []).find(h => h.id === Number(historyId));
    if (!hist) return;

    // The same six rules the server enforces. If this says no, the request would be refused.
    if (!isEditableLastUpdate(issue, hist)) {
        return showCustomAlert("Access Denied", "This update can no longer be edited.");
    }

    document.getElementById('update-id').value = issue.id;
    document.getElementById('update-status').value = hist.status;
    // carried:false on purpose -- these are the user's own points from today, so the
    // "carried over" chip and the Clear-completed button would both be misleading here.
    resetRemarkPoints(parseRemarkPointsFromText(hist.remark).map(p => ({ text: p.text, status: p.status, carried: false })));

    const fileInput = document.getElementById('update-evidence');
    if (fileInput) fileInput.value = '';

    applyUpdateModalMode('edit');
    editingHistoryId = Number(historyId);
    renderExistingEvidence(hist.evidenceUrl);
    toggleEvidenceHint();
    document.getElementById('modal-update').classList.add('show');

    requestAnimationFrame(() => {
        const container = getRemarkContainer();
        if (!container) return;
        autoGrowRemarkTextAll(container);
        const first = container.querySelector('.remark-point-row .remark-point-text');
        if (first) first.focus();
    });
}

export function requestCloseUpdateModal() {
    if (!isUpdateModalDirty()) return closeUpdateModal();
    showCustomConfirm("Discard Changes?", "The points you have typed will be lost and not saved.", closeUpdateModal);
}

export function closeUpdateModal() {
    document.getElementById('modal-update').classList.remove('show');

    // Reset form field
    const remarkContainer = document.getElementById('update-remark-points-container');
    if (remarkContainer) remarkContainer.innerHTML = '';

    // Reset Input File
    const fileInput = document.getElementById('update-evidence');
    if (fileInput) {
        fileInput.value = ''; // Hapus file dari input
    }

    // Reset Preview UI
    const previewContainer = document.getElementById('upload-preview-container');
    const defaultContent = document.getElementById('upload-content-default');
    const wrapper = document.getElementById('upload-wrapper');

    if (previewContainer) previewContainer.innerHTML = ''; // Hapus semua gambar preview
    if (previewContainer) previewContainer.style.display = 'none';
    if (defaultContent) defaultContent.style.display = 'flex';
    if (wrapper) {
        wrapper.style.borderColor = '#d1d5db';
        wrapper.style.backgroundColor = '#f9fafb';
    }
}

// Dibungkus kirimSekali(): tombolnya dikunci selama permintaan berjalan, supaya
// ketukan kedua tidak membuat baris/perubahan kembar.
export const submitUpdate = () => kirimSekali('btn-submit-update', 'Saving...', submitUpdateInti);
async function submitUpdateInti() {
    const id = document.getElementById('update-id').value;
    const status = document.getElementById('update-status').value;

    // Join the dynamic remark points into one numbered block, each carrying its own
    // In Progress/Closed tag, separate from the issue-wide status.
    // Required: at least one filled point, each filled point at least 10 characters.
    //
    // Collect first, validate, then assemble - so the resulting string is built from the
    // same rows, in the same DOM order, as before. The toasts are kept (they are the app's
    // only global feedback channel) but now they accompany a marker on the actual row.
    const rows = Array.from(document.querySelectorAll('#update-remark-points-container .remark-point-row'));
    rows.forEach(clearRemarkRowError);

    const filled = rows
        .map(row => ({
            row,
            text: sanitizeRemarkText(row.querySelector('.remark-point-text').value).trim(),
            pointStatus: row.querySelector('.remark-point-status').value
        }))
        .filter(point => point.text); // empty rows are skipped, not treated as errors

    const tooShort = filled.filter(point => point.text.length < MIN_REMARK_POINT_LENGTH);
    if (tooShort.length > 0) {
        tooShort.forEach(point => markRemarkRowError(point.row, `Minimum ${MIN_REMARK_POINT_LENGTH} characters.`));
        focusRemarkRow(tooShort[0].row);
        return showCustomAlert("Warning", `Each remark point must be at least ${MIN_REMARK_POINT_LENGTH} characters long.`);
    }
    if (filled.length === 0) {
        if (rows[0]) {
            markRemarkRowError(rows[0], `Fill in at least one point (min. ${MIN_REMARK_POINT_LENGTH} characters).`);
            focusRemarkRow(rows[0]);
        }
        return showCustomAlert("Warning", `Please fill in at least one remark point (minimum ${MIN_REMARK_POINT_LENGTH} characters) describing today's progress.`);
    }

    const statusLabel = { Progress: 'In Progress', Closed: 'Closed' };
    const remarkPoints = filled.map(point => `[${statusLabel[point.pointStatus] || point.pointStatus}] ${point.text}`);

    // Menutup issue (Closed) wajib disertai bukti (gambar/PDF) sebagai jejak verifikasi.
    const fileInput = document.getElementById('update-evidence');
    if (status === 'Closed' && (!fileInput || fileInput.files.length === 0)) {
        return showCustomAlert("Warning", "Please attach at least one evidence file (image or PDF) before closing this issue.");
    }

    let remark = remarkPoints.map((p, i) => `${i + 1}. ${p}`).join('\n');

    const selectPic = document.getElementById('update-pic');
    const newPicId = selectPic ? selectPic.value : null;

    if (newPicId) {
        const selectedPicText = selectPic.options[selectPic.selectedIndex].text;
        const autoNote = `[🔄 Task Forwarded to: ${selectedPicText}]`;
        remark = remark ? `${remark} | ${autoNote}` : autoNote;
    }

    // 1. Gunakan FormData (Bukan JSON.stringify) karena kita mengirim File
    const formData = new FormData();
    formData.append('status', status);
    if (remark) formData.append('remark', remark);
    // Everything above this line runs identically in both modes -- that is what keeps the
    // stored text format identical by construction rather than by review. Only the request
    // differs: an edit never carries picId, and it names the entry it corrects.
    const modeEdit = updateModalMode === 'edit' && editingHistoryId !== null;
    if (newPicId && !modeEdit) formData.append('picId', newPicId);
    if (modeEdit) {
        const disimpan = Array.from(document.querySelectorAll('#update-existing-evidence .evidence-chip'))
            .filter(chip => chip.dataset.keep === '1')
            .map(chip => chip.dataset.path);
        formData.append('keepEvidence', disimpan.join(','));
    }
    
    // 2. Tangkap elemen input file dan lakukan looping untuk memasukkan SEMUA file
    if (fileInput && fileInput.files.length > 0) {
        for (let i = 0; i < fileInput.files.length; i++) {
            formData.append('evidence', fileInput.files[i]); 
        }
    }

    // 3. Modifikasi Headers (Hapus Content-Type agar browser mengatur boundary multipart/form-data otomatis)
    const headers = getAuthHeaders();
    delete headers['Content-Type']; 

    try {
        const url = modeEdit
            ? `${API_URL}/issue/history/${editingHistoryId}`
            : `${API_URL}/issue/update/${id}`;
        const response = await fetch(url, {
            method: 'PATCH',
            headers: headers,
            body: formData // Kirim FormData
        });
        
        if (response.ok) {
            closeUpdateModal();
            
            // Kosongkan input file setelah sukses agar tidak terbawa ke update berikutnya
            if (fileInput) fileInput.value = '';
            
            showCustomAlert("Success", modeEdit
                ? "Last update corrected."
                : (newPicId ? "Task forwarded successfully!" : "Progress updated successfully."));
            
            if (localStorage.getItem('user_role') === 'MD') await loadDashboardMD();
            else await loadDashboardPIC();
            
            if (!modeEdit && newPicId && localStorage.getItem('user_role') === 'Dept Head') showView('view-pic-update');
            else await openDetailView(Number(id)); 
        } else {
            let pesan = "Error occurred during update.";
            try {
                const err = await response.json();
                if (err && err.message) pesan = Array.isArray(err.message) ? err.message.join(', ') : String(err.message);
            } catch (e) { /* biarkan pesan umum */ }
            showCustomAlert("Failed", pesan);
        }
    } catch (error) { 
        showCustomAlert("Error", "Server error."); 
    }
}

export function openPriorityModal(id, currentPrio) {
    document.getElementById('prio-issue-id').value = id;
    // 'Menunggu Review' bukan salah satu <option> di modals.html, jadi menetapkannya
    // diam-diam GAGAL dan select tetap memegang nilai dari modal yang dibuka sebelumnya
    // -- MD menyimpan prioritas yang salah tanpa sadar. 'Pending' adalah opsi pertama.
    document.getElementById('prio-select').value = currentPrio || 'Pending';
    document.getElementById('modal-priority').classList.add('show');
}

export function closePriorityModal() { document.getElementById('modal-priority').classList.remove('show'); }

// Dibungkus kirimSekali(): tombolnya dikunci selama permintaan berjalan, supaya
// ketukan kedua tidak membuat baris/perubahan kembar.
export const submitPriority = () => kirimSekali('btn-submit-priority', 'Saving...', submitPriorityInti);
async function submitPriorityInti() {
    const id = document.getElementById('prio-issue-id').value;
    const priority = document.getElementById('prio-select').value;
    try {
        const response = await fetch(`${API_URL}/issue/priority/${id}`, {
            method: 'PATCH', headers: getAuthHeaders(), body: JSON.stringify({ priority })
        });
        if (response.ok) {
            closePriorityModal();
            showCustomAlert("Success", "Priority scale updated successfully!");
            await loadDashboardMD();
            if (document.getElementById('view-issue-detail').classList.contains('active')) await openDetailView(Number(id));
        } else showCustomAlert("Failed", "An error occurred.");
    } catch (error) { showCustomAlert("Error", "Server error."); }
}

// ==========================================
// FUNGSI UBAH KATEGORI (HANYA UNTUK MD)
// ==========================================
export function openCategoryModal(id, currentCategory) {
    document.getElementById('cat-issue-id').value = id;
    document.getElementById('cat-select').value = currentCategory || 'Daily';
    document.getElementById('modal-category').classList.add('show');
}

export function closeCategoryModal() { document.getElementById('modal-category').classList.remove('show'); }

// Dibungkus kirimSekali(): tombolnya dikunci selama permintaan berjalan, supaya
// ketukan kedua tidak membuat baris/perubahan kembar.
export const submitCategory = () => kirimSekali('btn-submit-category', 'Saving...', submitCategoryInti);
async function submitCategoryInti() {
    const id = document.getElementById('cat-issue-id').value;
    const category = document.getElementById('cat-select').value;
    try {
        const response = await fetch(`${API_URL}/issue/category/${id}`, {
            method: 'PATCH', headers: getAuthHeaders(), body: JSON.stringify({ category })
        });
        if (response.ok) {
            closeCategoryModal();
            showCustomAlert("Success", "Category updated successfully!");
            await loadDashboardMD();
            if (document.getElementById('view-issue-detail').classList.contains('active')) await openDetailView(Number(id));
        } else showCustomAlert("Failed", "An error occurred.");
    } catch (error) { showCustomAlert("Error", "Server error."); }
}

// ==========================================
// FUNGSI UBAH DUE DATE (HANYA UNTUK MD)
// ==========================================
export function openDueDateModal(id, currentDueDate) {
    document.getElementById('due-date-issue-id').value = id;
    
    // Ubah format tanggal dari database (ISO) menjadi format YYYY-MM-DD untuk input kalender HTML
    let formattedDate = '';
    if (currentDueDate && currentDueDate !== 'null' && currentDueDate !== 'undefined') {
        const d = new Date(currentDueDate);
        if (!isNaN(d.getTime())) {
            formattedDate = d.toISOString().split('T')[0];
        }
    }
    
    document.getElementById('due-date-input').value = formattedDate;
    document.getElementById('modal-due-date').classList.add('show');
}

export function closeDueDateModal() { 
    document.getElementById('modal-due-date').classList.remove('show');
}

// Dibungkus kirimSekali(): tombolnya dikunci selama permintaan berjalan, supaya
// ketukan kedua tidak membuat baris/perubahan kembar.
export const submitDueDate = () => kirimSekali('btn-submit-duedate', 'Saving...', submitDueDateInti);
async function submitDueDateInti() {
    const id = document.getElementById('due-date-issue-id').value;
    const newDueDate = document.getElementById('due-date-input').value;

    if (!newDueDate) return showCustomAlert("Warning", "Please select a valid date!");

    try {
        // PERHATIAN: Endpoint ini bergantung pada sistem Backend (NestJS) Anda.
        // Jika Anda menggunakan endpoint '/issue/update/:id', silakan ganti URL-nya ke sana.
        const response = await fetch(`${API_URL}/issue/due-date/${id}`, {
            method: 'PATCH', 
            headers: getAuthHeaders(), 
            body: JSON.stringify({ dueDate: newDueDate })
        });
        
        if (response.ok) {
            closeDueDateModal();
            showCustomAlert("Success", "Target due date updated successfully!");
            
            // Muat ulang tabel dashboard MD
            if (document.getElementById('view-md').classList.contains('active')) {
                await loadDashboardMD();
            }
            // Jika MD mengubahnya dari dalam layar detail, muat ulang detailnya
            if (document.getElementById('view-issue-detail').classList.contains('active')) {
                await openDetailView(Number(id));
            }
        } else {
            showCustomAlert("Failed", "An error occurred while updating the due date.");
        }
    } catch (error) {
        showCustomAlert("Error", "Server error.");
    }
}

// =========================================================
// FITUR EDIT ASSIGNMENT (KHUSUS MD) - MEMPERBAIKI ISSUED BY & PIC YANG SALAH
// Dipakai antara lain untuk membetulkan hasil Import Excel
// yang gagal dicocokkan otomatis dengan user sistem.
// =========================================================
export function openEditAssignmentModal(id, currentPicId, currentIssuedBy) {
    document.getElementById('edit-assignment-issue-id').value = id;

    const issuerSelect = document.getElementById('edit-assignment-issuer-select');
    if (issuerSelect) {
        let options = '';
        state.globalUsers.forEach(u => {
            const roleName = (typeof u.role === 'object' && u.role !== null) ? u.role.name : u.role;
            options += `<option value="${u.id}">${escapeHtml(u.username)} (${escapeHtml(roleName)})</option>`;
        });
        issuerSelect.innerHTML = options;
        issuerSelect.value = currentIssuedBy ? String(currentIssuedBy) : '';
    }

    const picSelect = document.getElementById('edit-assignment-pic-select');
    if (picSelect) {
        let options = '<option value="">-- Unassigned --</option>';
        state.globalUsers.forEach(u => {
            const roleName = (typeof u.role === 'object' && u.role !== null) ? u.role.name : u.role;
            if (roleName === 'Dept Head') {
                const deptName = u.department || 'Unknown Dept';
                options += `<option value="${u.id}">${escapeHtml(u.username)} (${escapeHtml(deptName)})</option>`;
            }
        });
        picSelect.innerHTML = options;
        picSelect.value = currentPicId ? String(currentPicId) : '';
    }

    document.getElementById('modal-edit-assignment').classList.add('show');
}

export function closeEditAssignmentModal() {
    document.getElementById('modal-edit-assignment').classList.remove('show');
}

// Dibungkus kirimSekali(): tombolnya dikunci selama permintaan berjalan, supaya
// ketukan kedua tidak membuat baris/perubahan kembar.
export const submitEditAssignment = () => kirimSekali('btn-submit-assignment', 'Saving...', submitEditAssignmentInti);
async function submitEditAssignmentInti() {
    const id = document.getElementById('edit-assignment-issue-id').value;
    const issuerSelect = document.getElementById('edit-assignment-issuer-select');
    const picSelect = document.getElementById('edit-assignment-pic-select');

    const issuedBy = issuerSelect.value;
    const picId = picSelect.value;

    if (!issuedBy) return showCustomAlert("Warning", "Issued By cannot be empty!");

    const issuerLabel = issuerSelect.options[issuerSelect.selectedIndex].text;
    const picLabel = picId ? picSelect.options[picSelect.selectedIndex].text : 'Unassigned';

    const issue = state.globalIssues.find(i => String(i.id) === String(id));
    const currentStatus = issue ? issue.status : 'Open';

    const formData = new FormData();
    formData.append('status', currentStatus);
    formData.append('remark', `[✏️ Assignment corrected manually by MD — Issued By: ${issuerLabel}, PIC: ${picLabel}]`);
    formData.append('issuedBy', issuedBy);
    if (picId) formData.append('picId', picId);

    const headers = getAuthHeaders();
    delete headers['Content-Type'];

    try {
        const response = await fetch(`${API_URL}/issue/update/${id}`, {
            method: 'PATCH', headers, body: formData
        });

        if (response.ok) {
            closeEditAssignmentModal();
            showCustomAlert("Success", "Assignment updated successfully!");
            await loadDashboardMD();
            if (document.getElementById('view-issue-detail').classList.contains('active')) await openDetailView(Number(id));
        } else {
            showCustomAlert("Failed", "An error occurred while updating the assignment.");
        }
    } catch (error) {
        showCustomAlert("Error", "Server error.");
    }
}

// =========================================================
// FITUR EDIT ISSUE PENUH (KHUSUS MD) - Title, Description, Corrective Action
// Field lain (Status, Priority, Category, Due Date, PIC/Issued By) sudah punya jalur edit
// sendiri-sendiri, jadi sengaja tidak diulang di modal ini. Department TIDAK bisa diedit
// karena tidak disimpan sebagai kolom di Issue -- cuma dipakai sesaat saat issue dibuat
// untuk mencari PIC awal.
// =========================================================
export function openEditIssueModal() {
    const issue = state.detailIssue;
    if (!issue) return;

    document.getElementById('edit-issue-id').value = issue.id;
    document.getElementById('edit-issue-title').value = issue.caseNotification || '';
    document.getElementById('edit-issue-description').value = issue.description || '';
    document.getElementById('edit-issue-corrective-action').value = issue.correctiveAction || '';
    document.getElementById('modal-edit-issue').classList.add('show');
}

export function closeEditIssueModal() {
    document.getElementById('modal-edit-issue').classList.remove('show');
}

// Dibungkus kirimSekali(): tombolnya dikunci selama permintaan berjalan, supaya
// ketukan kedua tidak membuat baris/perubahan kembar.
export const submitEditIssue = () => kirimSekali('btn-submit-edit-issue', 'Saving...', submitEditIssueInti);
async function submitEditIssueInti() {
    const id = document.getElementById('edit-issue-id').value;
    const title = document.getElementById('edit-issue-title').value.trim();
    const description = document.getElementById('edit-issue-description').value.trim();
    const correctiveAction = document.getElementById('edit-issue-corrective-action').value.trim();

    if (!title || !description || !correctiveAction) {
        return showCustomAlert("Warning", "Title, Description, and Corrective Action cannot be empty!");
    }

    try {
        const response = await fetch(`${API_URL}/issue/${id}`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify({ title, description, correctiveAction })
        });

        if (response.ok) {
            closeEditIssueModal();
            showCustomAlert("Success", "Issue updated successfully!");
            await loadDashboardMD();
            await openDetailView(Number(id));
        } else {
            showCustomAlert("Failed", "An error occurred while updating the issue.");
        }
    } catch (error) {
        showCustomAlert("Error", "Server error.");
    }
}

// =========================================================
// FITUR HAPUS ISSUE (KHUSUS MD)
// =========================================================
export function confirmDeleteIssue() {
    const issue = state.detailIssue;
    if (!issue) return;

    const message = `Are you sure you want to permanently delete this issue?\n\n"${issue.caseNotification}"\n\nThis action cannot be undone — all progress history will be deleted as well.`;
    showCustomConfirm("Delete Issue", message, async () => {
        try {
            const response = await fetch(`${API_URL}/issue/${issue.id}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });

            if (response.ok) {
                showCustomAlert("Success", "Issue has been permanently deleted.");
                // Hapus TIDAK lewat kirimSekali() (dipicu dari dialog konfirmasi), jadi cache
                // dihanguskan di sini secara eksplisit.
                lupakanCacheIssue();
                await loadDashboardMD();
                backFromDetail();
            } else {
                showCustomAlert("Failed", "An error occurred while deleting the issue.");
            }
        } catch (error) {
            showCustomAlert("Error", "Server error.");
        }
    });
}