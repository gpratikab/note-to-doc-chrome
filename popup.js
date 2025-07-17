// popup.js - This script controls the UI and logic for the popup window.

// --- Get UI Elements ---
const container = document.querySelector('.qn-container');
const titleInput = document.getElementById('qn-title-input');
const editor = document.getElementById('qn-editor');
const toolbar = document.querySelector('.qn-toolbar');
const closeButton = document.querySelector('.qn-close-btn');
const saveCloseButton = document.querySelector('.qn-save-close-btn');
const statusSpan = document.getElementById('qn-status');

// --- UI Logic ---

// Load cached note from background script when the popup opens
chrome.runtime.sendMessage({ action: "getInitialCache" }, (response) => {
    if (chrome.runtime.lastError) {
        console.log("Could not get initial cache. It may be empty.");
    } else if (response) {
      titleInput.value = response.title || '';
      editor.innerHTML = response.content || '';
    }
});

// The 'x' button just closes the window without saving recent changes
closeButton.onclick = () => {
    window.close();
};

// The "Save & Close" button sends the final content to the background script to save
saveCloseButton.onclick = () => {
    const title = titleInput.value;
    const content = editor.innerHTML;
    // Disable the button to prevent multiple clicks
    saveCloseButton.disabled = true;
    saveCloseButton.textContent = 'Saving...';
    // Send message to background to save and then close the window
    chrome.runtime.sendMessage({ action: "saveAndClose", data: { title, content } });
};


// --- Toolbar and Editor Event Listeners ---

toolbar.addEventListener('click', (e) => {
    const command = e.target.closest('.qn-toolbar-btn')?.dataset.command;
    if (command) {
        document.execCommand(command, false, null);
        editor.focus(); // Keep focus on the editor after a command
    }
});

// Debounced function to send note content to the background script for caching
let debounceTimer;
const sendNoteToBackground = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        const title = titleInput.value;
        const content = editor.innerHTML;
        chrome.runtime.sendMessage({ action: "cacheNote", data: { title, content } });
        updateStatus('idle', 'Unsaved changes');
    }, 500); // 500ms debounce time
};

titleInput.addEventListener('input', sendNoteToBackground);
editor.addEventListener('input', sendNoteToBackground);

// --- Status Update Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "updateStatus") {
        updateStatus(request.status, request.message);
        
        // MODIFIED: The popup no longer closes itself.
        // The background script controls closing after a final save.
        // We just need to handle the UI state here.
        if (request.status === 'error' || request.status === 'idle') {
            // Re-enable the button if an error occurs or if the save is idle
            saveCloseButton.disabled = false;
            saveCloseButton.textContent = 'Save & Close';
        }
    }
});

function updateStatus(status, message = '') {
    if (!statusSpan) return;
    
    statusSpan.className = `qn-status-${status}`;
    switch (status) {
        case 'idle':   statusSpan.textContent = message || 'Ready'; break;
        case 'saving': statusSpan.textContent = 'Saving...'; break;
        case 'saved':  statusSpan.textContent = `Saved at ${new Date().toLocaleTimeString()}`; break;
        case 'error':
            statusSpan.textContent = `Error!`;
            statusSpan.title = message; // Show full error on hover
            break;
    }
}

