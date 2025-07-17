// background.js

// --- Utility Functions ---
const getStorageData = (key) => new Promise((resolve) => chrome.storage.sync.get(key, resolve));

async function getDocId() {
  const { docId } = await getStorageData('docId');
  if (docId) {
    return docId;
  }
  console.log("Google Doc ID not found. Opening options page.");
  chrome.runtime.openOptionsPage();
  return null;
}

// --- Global State ---
let authToken = null;
let noteCache = { title: '', content: '' };
let offscreenDocumentPath;

// --- Extension Lifecycle ---
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        getDocId();
    }
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
  } catch (e) {
    console.error(`Quick Notes: Failed to inject script. Error: ${e.message}`);
    chrome.notifications.create({
      type: 'basic', iconUrl: 'icon128.png', title: 'Quick Notes Blocked',
      message: 'This page is protected by browser policy and the Quick Notes extension cannot run here.',
      priority: 2
    });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "cacheNote") {
    noteCache = request.data;
  } else if (request.action === "saveAndClose") {
    noteCache = request.data;
    saveNoteToDoc(true, sender.tab.id);
  } else if (request.action === "getInitialCache") {
    sendResponse(noteCache);
  }
  return true;
});

// --- Alarms for Autosave ---
// MODIFIED: Sync frequency changed to 5 seconds.
const fiveSecondsInMinutes = 5 / 60;
chrome.alarms.create('auto-save-note', { delayInMinutes: fiveSecondsInMinutes, periodInMinutes: fiveSecondsInMinutes });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'auto-save-note') {
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

// --- Offscreen Document Logic to handle DOM Parsing ---
async function hasOffscreenDocument() {
    offscreenDocumentPath = offscreenDocumentPath || chrome.runtime.getURL('offscreen.html');
    const clients = await self.clients.matchAll();
    return clients.some(client => client.url.startsWith(offscreenDocumentPath));
}

async function setupOffscreenDocument(path) {
    if (await hasOffscreenDocument()) {
        return;
    }
    await chrome.offscreen.createDocument({
        url: path,
        reasons: ['DOM_PARSER'],
        justification: 'The DOMParser API is not available in service workers; using an offscreen document to parse HTML content.',
    });
}

async function parseHtmlViaOffscreen(html) {
    offscreenDocumentPath = offscreenDocumentPath || chrome.runtime.getURL('offscreen.html');
    await setupOffscreenDocument(offscreenDocumentPath);

    return new Promise((resolve) => {
        const listener = (message) => {
            if (message.action === 'parseComplete') {
                chrome.runtime.onMessage.removeListener(listener);
                resolve(message.data);
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        chrome.runtime.sendMessage({
            target: 'offscreen',
            action: 'parseHtml',
            html: html
        });
    });
}


// --- Messaging to Content Script ---
async function sendStatusUpdate(tabId, status, message = '') {
  try {
    let targetTabId = tabId;
    if (!targetTabId) {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (activeTab) targetTabId = activeTab.id;
    }
    if (targetTabId) {
      chrome.tabs.sendMessage(targetTabId, { action: "updateStatus", status, message }, (response) => {
          if (chrome.runtime.lastError) console.log("Could not send status to content script, it might be closed.");
      });
    }
  } catch (error) {
    console.log("Error trying to send status update:", error);
  }
}

// Main function to save the note
async function saveNoteToDoc(isFinalSave, tabId) {
  const { title, content } = noteCache;

  if (!title.trim() && !content.replace(/<[^>]*>?/gm, '').trim()) {
    if (isFinalSave) console.log("Note is empty, nothing to save.");
    await sendStatusUpdate(tabId, "idle");
    return;
  }
  
  await sendStatusUpdate(tabId, "saving");

  try {
    const docId = await getDocId();
    if (!docId) throw new Error("Google Doc ID is not configured.");
    
    const token = await getAuthToken(false).catch(() => getAuthToken(true));

    const now = new Date();
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const timeOptions = { hour: 'numeric', minute: '2-digit', second: '2-digit' };
    const formattedDate = now.toLocaleDateString('en-US', dateOptions);
    const formattedTime = now.toLocaleTimeString('en-US', timeOptions);
    
    let titleText = title.trim() || `Note from ${formattedDate}`;
    const timestampText = `Time : ${formattedDate} at ${formattedTime}\n`;
    const contentLabelText = `Content : \n`;
    
    const { plainText: contentText, requests: contentRequests } = await parseHtmlViaOffscreen(content);
    const fullTextToInsert = `${titleText}\n${timestampText}${contentLabelText}${contentText}\n\n`;
    
    const getResponse = await fetch(`https://docs.googleapis.com/v1/documents/${docId}?fields=body.content`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
     if (!getResponse.ok) {
      const errorData = await getResponse.json();
      let message = errorData.error?.message || `Status: ${getResponse.status}`;
      if (getResponse.status === 404) message = "Document not found. Check the ID in the options.";
      throw new Error(message);
    }
    const docData = await getResponse.json();
    const insertionIndex = docData.body?.content?.slice(-1)[0]?.endIndex - 1 || 1;

    const allRequests = [{ insertText: { location: { index: insertionIndex }, text: fullTextToInsert } }];
    let currentIndex = insertionIndex;

    allRequests.push({ updateParagraphStyle: { range: { startIndex: currentIndex, endIndex: currentIndex + titleText.length }, paragraphStyle: { namedStyleType: 'HEADING_1' }, fields: 'namedStyleType' } });
    currentIndex += titleText.length + 1;

    allRequests.push({ updateTextStyle: { range: { startIndex: currentIndex, endIndex: currentIndex + 7 }, textStyle: { bold: true }, fields: 'bold' } });
    currentIndex += timestampText.length;
    
    allRequests.push({ updateTextStyle: { range: { startIndex: currentIndex, endIndex: currentIndex + 10 }, textStyle: { bold: true }, fields: 'bold' } });
    currentIndex += contentLabelText.length;
    
    contentRequests.forEach(req => {
        const requestKey = Object.keys(req)[0];
        req[requestKey].range.startIndex += currentIndex;
        req[requestKey].range.endIndex += currentIndex;
        allRequests.push(req);
    });
    
    const updateResponse = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: allRequests })
    });

    if (!updateResponse.ok) {
      const errorData = await updateResponse.json();
      let message = errorData.error?.message || `Status: ${updateResponse.status}`;
      if (updateResponse.status === 404) message = "Document not found. Check the ID in the options.";
      throw new Error(message);
    }

    console.log('Note successfully saved to Google Doc.');
    noteCache = { title: '', content: '' };
    await sendStatusUpdate(tabId, "saved");

  } catch (error) {
    console.error('Error saving note:', error.message);
    await sendStatusUpdate(tabId, "error", error.message);
    if (error.message.includes("token") || error.message.includes("Authentication")) {
      chrome.identity.removeCachedAuthToken({ token: authToken }, () => { authToken = null; });
    }
  }
}

