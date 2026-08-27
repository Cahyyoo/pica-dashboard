export const API_URL = 'http://192.168.100.205:3000';
// export const API_URL = 'http://localhost:3000';

export function getAuthHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('access_token')}`
    };
}