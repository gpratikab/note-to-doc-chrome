// background.js

// --- Utility Functions ---
const getStorageData = (key) => new Promise((resolve) => chrome.storage.sync.get(key, resolve));

async function getDocId() {
  const { docId } = await getStorageData('docId');
  if (docId) {
    return docId;
  }
  // If no ID is set, open the options page for the user to set it.
  console.log("Google Doc ID not found. Opening options page.");
  chrome.runtime.openOptionsPage();
  return null;
}

// --- Global State ---
let authToken = null;
let noteCache = { title: '', content: '' };


// --- Extension Lifecycle ---

// On install, check if Doc ID is set. If not, open options.
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        getDocId(); // This will open the options page if the ID isn't set
    }
});


// Listener for the extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
  } catch (e) {
    console.error(`Quick Notes: Failed to inject script. Error: ${e.message}`);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon128.png',
      title: 'Quick Notes Blocked',
      message: 'This page is protected by browser policy and the Quick Notes extension cannot run here.',
      priority: 2
    });
  }
});

// Listener for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "cacheNote") {
    noteCache = request.data;
  } else if (request.action === "saveAndClose") {
    noteCache = request.data;
    saveNoteToDoc(true, sender.tab.id); // Force save on close
  } else if (request.action === "getInitialCache") {
    sendResponse(noteCache);
  }
  return true; // Important for async sendResponse
});


// --- Alarms for Autosave ---
chrome.alarms.create('auto-save-note', { delayInMinutes: 1, periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'auto-save-note') {
    // We pass null for the tabId because an alarm doesn't have a specific tab
    saveNoteToDoc(false, null);
  }
});


// --- Google Docs API Integration ---
function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        authToken = token;
        resolve(token);
      }
    });
  });
}

// --- Messaging to Content Script ---
async function sendStatusUpdate(tabId, status, message = '') {
  try {
    let targetTabId = tabId;
    // If the save was triggered by an alarm, we need to find an active tab with the notepad open.
    if (!targetTabId) {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (activeTab) {
        targetTabId = activeTab.id;
      }
    }
    // Only send if we have a valid tab
    if (targetTabId) {
      // A simple check to see if the content script is likely to be there before sending.
      chrome.tabs.sendMessage(targetTabId, { action: "updateStatus", status, message }, (response) => {
          if (chrome.runtime.lastError) {
              console.log("Could not send status to content script, it might be closed.");
          }
      });
    }
  } catch (error) {
    console.log("Error trying to send status update:", error);
  }
}

// Main function to save the note
async function saveNoteToDoc(isFinalSave, tabId) {
  // Don't autosave an empty note. Only check this for autosaves.
  if (!isFinalSave && (!noteCache.content || noteCache.content.trim() === '') && (!noteCache.title || noteCache.title.trim() === '')) {
    return;
  }
  
  await sendStatusUpdate(tabId, "saving");

  try {
    const docId = await getDocId();
    if (!docId) {
      throw new Error("Google Doc ID is not configured. Please set it in the extension options.");
    }
    
    // This will prompt the user to log in if necessary.
    const token = await getAuthToken(false).catch(() => getAuthToken(true));

    const timestamp = new Date().toLocaleString();
    const titleText = noteCache.title.trim() === '' ? 'Untitled Note' : noteCache.title;
    const plainTextContent = noteCache.content.replace(/<[^>]*>?/gm, '');

    // Also don't save if the note is completely empty on a final save.
    if (plainTextContent.trim() === '' && titleText === 'Untitled Note') {
        if(isFinalSave) console.log("Note is empty, nothing to save.");
        await sendStatusUpdate(tabId, "idle"); // Reset status to idle
        return;
    }
    
    const textToInsert = `\n\n--- ${titleText} | ${timestamp} ---\n\n${plainTextContent}\n`;

    // First, get the document to find its end index
    const getResponse = await fetch(`https://docs.googleapis.com/v1/documents/${docId}?fields=body.content`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!getResponse.ok) {
      const errorData = await getResponse.json();
      let message = errorData.error?.message || `Status: ${getResponse.status}`;
      if (getResponse.status === 404) {
          message = "Document not found. Check the ID in the options.";
      }
      throw new Error(message);
    }

    const docData = await getResponse.json();
    const lastElement = docData.body?.content?.slice(-1)[0];
    const insertionIndex = lastElement?.endIndex > 1 ? lastElement.endIndex - 1 : 1;
    
    // Update the document
    const updateResponse = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ insertText: { location: { index: insertionIndex }, text: textToInsert } }] })
    });

    if (!updateResponse.ok) {
      const errorData = await updateResponse.json();
      throw new Error(errorData.error?.message || `Failed to update document.`);
    }

    console.log('Note successfully saved to Google Doc.');
    noteCache = { title: '', content: '' }; // Clear cache after successful save
    await sendStatusUpdate(tabId, "saved");

  } catch (error) {
    console.error('Error saving note:', error.message);
    await sendStatusUpdate(tabId, "error", error.message);
    // If the token is invalid, try to remove it so we can get a fresh one next time.
    if (error.message.includes("token") || error.message.includes("Authentication")) {
      chrome.identity.removeCachedAuthToken({ token: authToken }, () => { authToken = null; });
    }
  }
}

