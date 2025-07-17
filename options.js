// options.js

// Saves options to chrome.storage
function saveOptions() {
  const docId = document.getElementById('docId').value;
  chrome.storage.sync.set({ docId: docId }, () => {
    // Update status to let user know options were saved.
    const status = document.getElementById('status');
    status.textContent = 'Options saved!';
    setTimeout(() => {
      status.textContent = '';
    }, 1500);
  });
}

// Restores select box and checkbox state using the preferences
// stored in chrome.storage.
function restoreOptions() {
  chrome.storage.sync.get('docId', (data) => {
    document.getElementById('docId').value = data.docId || '';
  });
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);
