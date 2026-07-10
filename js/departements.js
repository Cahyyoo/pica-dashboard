import { API_URL, getAuthHeaders } from './config.js';
import { showCustomAlert, showCustomConfirm } from './utils.js'; 
import { loadDepartments } from './issues.js'; 

// ==========================================
// 1. READ: Load Department Table Data (Admin)
// ==========================================
export async function loadAdminDepartments() {
    try {
        const res = await fetch(`${API_URL}/department`);
        const depts = await res.json();
        
        const tbody = document.getElementById('tbody-manage-dept');
        if (!tbody) return;
        tbody.innerHTML = '';

        depts.forEach((d, index) => {
            tbody.innerHTML += `
                <tr>
                    <td style="text-align: center;">${index + 1}</td>
                    <td>${d.name}</td>
                    <td>
                        <div style="display: flex; gap: 8px; justify-content: center;">
                            <button class="btn-sm btn-secondary" onclick="openEditDeptModal(${d.id}, '${d.name}')">Edit</button>
                            <button class="btn-sm btn-danger" onclick="deleteDepartment(${d.id}, '${d.name}')">Delete</button>
                        </div>
                    </td>
                </tr>
            `;
        });
    } catch (error) {
        console.error("Failed to fetch department data:", error);
    }
}

// ==========================================
// 2. CREATE: Save New Department
// ==========================================
export async function submitNewDepartment() {
    const nameInput = document.getElementById('admin-new-dept-name');
    const name = nameInput.value.trim();

    if (!name) return showCustomAlert("Warning", "Department name cannot be empty!");

    try {
        const response = await fetch(`${API_URL}/department`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ name })
        });

        if (response.ok) {
            showCustomAlert("Success", `Department ${name} added successfully!`);
            nameInput.value = ''; 
            
            loadAdminDepartments(); 
            loadDepartments(); 
        } else {
            const errorData = await response.json();
            showCustomAlert("Failed", errorData.message || "Failed to save department.");
        }
    } catch (error) {
        showCustomAlert("Error", "Failed to connect to backend server.");
    }
}

// ==========================================
// 3. DELETE: Delete Department
// ==========================================
export function deleteDepartment(id, name) {
    const message = `Are you sure you want to delete department:\n${name}?\n\nPlease ensure no Users or PICA Reports are linked to this department!`;
    
    showCustomConfirm("Delete Department", message, async () => {
        try {
            const response = await fetch(`${API_URL}/department/${id}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });

            if (response.ok) {
                showCustomAlert("Success", `Department ${name} has been deleted.`);
                loadAdminDepartments(); 
                loadDepartments();      
            } else {
                showCustomAlert("Failed", "Cannot delete department. Ensure it is not used by User/Issue data.");
            }
        } catch (error) {
            showCustomAlert("Error", "Failed to connect to backend server.");
        }
    });
}

// ==========================================
// 4. UPDATE: Edit Department
// ==========================================
export function openEditDeptModal(id, currentName) {
    document.getElementById('edit-dept-id').value = id;
    document.getElementById('edit-dept-name').value = currentName;
    document.getElementById('modal-edit-dept').style.display = 'flex';
}

export function closeEditDeptModal() {
    document.getElementById('modal-edit-dept').style.display = 'none';
}

export async function submitEditDepartment() {
    const id = document.getElementById('edit-dept-id').value;
    const nameInput = document.getElementById('edit-dept-name');
    const name = nameInput.value.trim();

    if (!name) return showCustomAlert("Warning", "Department name cannot be empty!");

    try {
        document.querySelector('button[onclick="submitEditDepartment()"]').innerText = "Saving...";

        const response = await fetch(`${API_URL}/department/${id}`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify({ name })
        });

        document.querySelector('button[onclick="submitEditDepartment()"]').innerText = "Save Changes";

        if (response.ok) {
            closeEditDeptModal();
            showCustomAlert("Success", `Department successfully updated to ${name}!`);
            
            loadAdminDepartments(); 
            loadDepartments(); 
        } else {
            const errorData = await response.json();
            showCustomAlert("Failed", errorData.message || "Failed to update department.");
        }
    } catch (error) {
        showCustomAlert("Error", "Failed to connect to backend server.");
        document.querySelector('button[onclick="submitEditDepartment()"]').innerText = "Save Changes";
    }
}