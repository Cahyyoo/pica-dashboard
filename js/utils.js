let alertTimeout;

export function showCustomAlert(title, message) {
    const alertBox = document.getElementById('custom-alert');
    const iconBox = document.getElementById('alert-icon');
    const titleEl = document.getElementById('alert-title');
    
    // Set teks
    titleEl.innerText = title;
    document.getElementById('alert-message').innerText = message;
    
    // Deteksi warna dan ikon berdasarkan kata kunci di title
    const lowerTitle = title.toLowerCase();
    
    if (lowerTitle.includes('success')) {
        // Tema Hijau (Berhasil)
        alertBox.style.borderLeftColor = '#10b981';
        iconBox.style.backgroundColor = '#d1fae5';
        iconBox.style.color = '#059669';
        iconBox.innerText = '✓';
    } else if (lowerTitle.includes('error') || lowerTitle.includes('fail')) {
        // Tema Merah (Gagal)
        alertBox.style.borderLeftColor = '#ef4444';
        iconBox.style.backgroundColor = '#fee2e2';
        iconBox.style.color = '#b91c1c';
        iconBox.innerText = '✕';
    } else {
        // Tema Kuning (Warning / Info)
        alertBox.style.borderLeftColor = '#f59e0b';
        iconBox.style.backgroundColor = '#fef3c7';
        iconBox.style.color = '#b45309';
        iconBox.innerText = '!';
    }

    // Tampilkan notifikasi dengan meluncur ke bawah
    alertBox.classList.add('show');

    // Hapus timer lama jika ada notifikasi bertubi-tubi
    if (alertTimeout) {
        clearTimeout(alertTimeout);
    }
    
    // Sembunyikan otomatis setelah 3 detik (3000 ms)
    alertTimeout = setTimeout(() => {
        alertBox.classList.remove('show');
    }, 3000); 
}

export function closeCustomAlert() {
    const alertBox = document.getElementById('custom-alert');
    if (alertBox) alertBox.classList.remove('show');
}

export function showView(viewId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
}

export function navigateToRole(role) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('global-nav').style.display = 'flex'; 
    document.getElementById('user-badge').innerText = role;       

    // Perubahan: Hapus Admin, Tambahkan KTT
    if (role === "User") document.getElementById('view-user-menu').classList.add('active');
    else if (role === "Dept Head") document.getElementById('view-dept-head').classList.add('active'); 
    else if (role === "MD") document.getElementById('view-md-menu').classList.add('active');
    else if (role === "KTT") document.getElementById('view-ktt-menu').classList.add('active');
}

export function getStatusBadge(status) {
    // Status condition values match the backend/database records
    if (status === 'Open') return '<span class="badge badge-open">Open</span>';
    if (status === 'Progress') return '<span class="badge badge-progress">Progress</span>';
    return `<span class="badge badge-prio">${status}</span>`;
}

// --- PENANDA APAKAH ISSUE SUDAH DIUPDATE OLEH PIC HARI INI ---
export function hasUpdatedToday(issue) {
    if (!issue.histories || issue.histories.length === 0) return false;

    const todayDate = new Date().toDateString();
    const todayHistories = issue.histories.filter(hist => new Date(hist.createdAt).toDateString() === todayDate);
    if (todayHistories.length === 0) return false;

    todayHistories.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const latestTodayAction = todayHistories[0];

    // Forward ke PIC lain tidak dihitung sebagai progress update
    if (latestTodayAction.remark && latestTodayAction.remark.includes('[🔄 Task Forwarded to:')) return false;

    return true;
}

export function getDailyUpdateBadge(issue) {
    if (issue.status === 'Closed') return '<span style="color:#9ca3af; font-size:12px;">-</span>';

    return hasUpdatedToday(issue)
        ? '<span class="badge badge-updated">✅ Updated Today</span>'
        : '<span class="badge badge-not-updated">⏳ Not Updated Yet</span>';
}

// --- MODULAR HTML INJECTION FUNCTION ---
export async function loadComponent(containerId, filePath) {
    try {
        const response = await fetch(filePath);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const html = await response.text();
        
        // Inject HTML into the target container
        document.getElementById(containerId).insertAdjacentHTML('beforeend', html);
    } catch (error) {
        console.error(`Failed to load component ${filePath}:`, error);
    }
}

// --- CONFIRMATION MODAL CONTROL (CUSTOM CONFIRM) ---
export function showCustomConfirm(title, message, onConfirmCallback) {
    document.getElementById('confirm-title').innerText = title;
    document.getElementById('confirm-message').innerText = message;
    document.getElementById('custom-confirm').classList.add('show');

    const btnYes = document.getElementById('btn-confirm-yes');
    
    // Execute the callback (e.g., Delete API) ONLY if the 'Yes' button is clicked
    btnYes.onclick = () => {
        closeCustomConfirm(); 
        if (typeof onConfirmCallback === 'function') {
            onConfirmCallback(); 
        }
    };
}

export function closeCustomConfirm() {
    document.getElementById('custom-confirm').classList.remove('show');
}