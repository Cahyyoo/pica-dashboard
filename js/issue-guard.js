// js/issue-guard.js
import { API_URL } from './config.js';
import { hasUpdatedToday } from './utils.js';

export async function checkDailyUpdates() {
    const role = localStorage.getItem('user_role');
    const userId = String(localStorage.getItem('user_id'));

    if (role !== 'Dept Head') return true;

    try {
        const res = await fetch(`${API_URL}/issue`);
        if (!res.ok) return true;
        const allIssues = await res.json();

        const activeMyTasks = allIssues.filter(i =>
            i.status !== 'Closed' && String(i.picId) === userId
        );

        if (activeMyTasks.length === 0) return true;

        const unupdatedTasks = activeMyTasks.filter(task => !hasUpdatedToday(task));

        if (unupdatedTasks.length > 0) return false;
        return true;
    } catch (error) {
        console.error("Gagal memvalidasi status harian:", error);
        return true;
    }
}