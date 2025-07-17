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
let notes = {}; // Store all note objects, keyed by a unique ID.
let offscreenDocumentPath;
let isSaving = false; // MODIFIED: Add a lock to prevent concurrent saves.

// --- Core Logic ---

async function ensureScriptInjected(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js'],
        });
    } catch (e) { /* Ignore errors on special pages */ }
}

// --- Event Listeners ---

chrome.action.onClicked.addListener(async (tab) => {
    if (!tab.url || !tab.url.startsWith('http')) {
        return;
    }

    const noteId = `note-${Date.now()}`;
    const newNote = {
        id: noteId,
        title: '',
        content: '',
        top: 60 + (Object.keys(notes).length % 10) * 20,
        left: 60 + (Object.keys(notes).length % 10) * 20,
        width: 350,
        height: 400,
        isDirty: false,
        namedRangeId: null
    };
    notes[noteId] = newNote;

    await ensureScriptInjected(tab.id);
    chrome.tabs.sendMessage(tab.id, { action: 'createNote', note: newNote })
      .catch(err => {});
});

chrome.runtime.onInstalled.addListener(async () => {
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    for (const tab of tabs) {
       await ensureScriptInjected(tab.id);
    }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
        ensureScriptInjected(tabId);
    }
});


chrome.tabs.onActivated.addListener(async (activeInfo) => {
    await ensureScriptInjected(activeInfo.tabId);
});

// --- Message Handling ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getInitialNotes") {
    sendResponse(notes);
    return true;
  }
  if (request.action === "updateNoteContent") {
    if (notes[request.noteId]) {
      notes[request.noteId].title = request.data.title;
      notes[request.noteId].content = request.data.content;
      notes[request.noteId].isDirty = true;
    }
  }
  if (request.action === "updateNotePosition") {
     if (notes[request.noteId]) {
        notes[request.noteId].top = request.data.top;
        notes[request.noteId].left = request.data.left;
        notes[request.noteId].width = request.data.width;
        notes[request.noteId].height = request.data.height;
     }
  }
  if (request.action === "saveNote") {
     if (notes[request.noteId]) {
        saveNoteToDoc(notes[request.noteId], true);
     }
  }
  if (request.action === "closeNote") {
    if (notes[request.noteId]) {
      delete notes[request.noteId];
      broadcastMessage({ action: 'removeNote', noteId: request.noteId });
    }
  }
  return true;
});


async function broadcastMessage(message) {
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
}


// --- API and Saving Logic ---

const tenSecondsInMinutes = 10 / 60;
chrome.alarms.create('auto-save-all-notes', {
    delayInMinutes: tenSecondsInMinutes,
    periodInMinutes: tenSecondsInMinutes
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'auto-save-all-notes') {
        for (const noteId in notes) {
            const note = notes[noteId];
            if (note.isDirty) {
                saveNoteToDoc(note, false);
            }
        }
    }
});


async function sendStatusUpdate(noteId, status, payload = {}) {
    await broadcastMessage({ action: "updateStatus", noteId, status, payload });
}

async function saveNoteToDoc(note, isManualSave) {
  // MODIFIED: If a save is already in progress, skip this one.
  if (isSaving) {
    console.log("A save is already in progress. Queuing this save for the next cycle.");
    // Mark the note as dirty so the next alarm cycle picks it up.
    if (notes[note.id]) {
        notes[note.id].isDirty = true;
    }
    return;
  }
  isSaving = true; // Set the lock

  const { id, title, content, namedRangeId } = note;

  if (!title.trim() && !content.replace(/<[^>]*>?/gm, '').trim()) {
    isSaving = false; // Release lock
    return;
  }
  
  await sendStatusUpdate(id, "saving");

  try {
    const docId = await getDocId();
    if (!docId) throw new Error("Google Doc ID is not configured.");
    const token = await getAuthToken(isManualSave);

    const docResponse = await fetch(`https://docs.googleapis.com/v1/documents/${docId}?fields=namedRanges,body.content`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!docResponse.ok) throw new Error((await docResponse.json()).error?.message);
    const docData = await docResponse.json();

    const requests = [];
    const namedRange = namedRangeId ? docData.namedRanges?.[namedRangeId] : null;
    const existingRange = (namedRange && namedRange.ranges && namedRange.ranges.length > 0) ? namedRange.ranges[0] : null;

    const now = new Date();
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const timeOptions = { hour: 'numeric', minute: '2-digit', second: '2-digit' };
    const formattedDate = now.toLocaleDateString('en-US', dateOptions);
    const formattedTime = now.toLocaleTimeString('en-US', timeOptions);
    
    const titleText = title.trim() || `Note from ${formattedDate}`;
    const { plainText: contentText, requests: contentFormattingRequests } = await parseHtmlViaOffscreen(content);
    
    if (existingRange) {
        // --- UPDATE PATH ---
        const timestampText = `Updated: ${formattedDate} at ${formattedTime}\n`;
        const contentLabelText = `Content : \n`;
        const fullTextToInsert = `${titleText}\n${timestampText}${contentLabelText}${contentText}\n\n`;
        
        requests.push({ deleteContentRange: { range: existingRange } });
        requests.push({ insertText: { location: { index: existingRange.startIndex }, text: fullTextToInsert } });

        let currentIndex = existingRange.startIndex;
        requests.push({ updateParagraphStyle: { range: { startIndex: currentIndex, endIndex: currentIndex + titleText.length }, paragraphStyle: { namedStyleType: 'HEADING_1' }, fields: 'namedStyleType' } });
        currentIndex += titleText.length + 1;
        requests.push({ updateTextStyle: { range: { startIndex: currentIndex, endIndex: currentIndex + 9 }, textStyle: { bold: true }, fields: 'bold' } });
        currentIndex += timestampText.length;
        requests.push({ updateTextStyle: { range: { startIndex: currentIndex, endIndex: currentIndex + 10 }, textStyle: { bold: true }, fields: 'bold' } });
        currentIndex += contentLabelText.length;
        
        contentFormattingRequests.forEach(req => {
            const reqKey = Object.keys(req)[0];
            req[reqKey].range.startIndex += currentIndex;
            req[reqKey].range.endIndex += currentIndex;
            requests.push(req);
        });

        requests.push({ createNamedRange: { name: id, range: { startIndex: existingRange.startIndex, endIndex: existingRange.startIndex + fullTextToInsert.length } } });

    } else {
        // --- CREATE PATH ---
        const insertionIndex = docData.body?.content?.[docData.body.content.length - 1]?.endIndex - 1 || 1;
        const timestampText = `Created: ${formattedDate} at ${formattedTime}\n`;
        const contentLabelText = `Content : \n`;
        const fullTextToInsert = `${titleText}\n${timestampText}${contentLabelText}${contentText}\n\n`;

        requests.push({ insertText: { location: { index: insertionIndex }, text: fullTextToInsert } });
        
        let currentIndex = insertionIndex;
        requests.push({ updateParagraphStyle: { range: { startIndex: currentIndex, endIndex: currentIndex + titleText.length }, paragraphStyle: { namedStyleType: 'HEADING_1' }, fields: 'namedStyleType' } });
        currentIndex += titleText.length + 1;
        requests.push({ updateTextStyle: { range: { startIndex: currentIndex, endIndex: currentIndex + 9 }, textStyle: { bold: true }, fields: 'bold' } });
        currentIndex += timestampText.length;
        requests.push({ updateTextStyle: { range: { startIndex: currentIndex, endIndex: currentIndex + 10 }, textStyle: { bold: true }, fields: 'bold' } });
        currentIndex += contentLabelText.length;
        
        contentFormattingRequests.forEach(req => {
            const reqKey = Object.keys(req)[0];
            req[reqKey].range.startIndex += currentIndex;
            req[reqKey].range.endIndex += currentIndex;
            requests.push(req);
        });
        
        requests.push({ createNamedRange: { name: id, range: { startIndex: insertionIndex, endIndex: insertionIndex + fullTextToInsert.length } } });
    }
    
    const updateResponse = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests })
    });

    if (!updateResponse.ok) throw new Error((await updateResponse.json()).error?.message);

    console.log(`Note ${id} successfully saved.`);
    if (notes[id]) {
      notes[id].isDirty = false;
      notes[id].namedRangeId = id;
    }
    await sendStatusUpdate(id, "saved");

  } catch (error) {
    console.error(`Error saving note ${id}:`, error.message);
    await sendStatusUpdate(id, "error", { message: error.message });
    if (error.message.includes("token")) {
      chrome.identity.removeCachedAuthToken({ token: authToken }, () => { authToken = null; });
    }
  } finally {
    isSaving = false; // MODIFIED: Release the lock in a finally block.
  }
}

// --- Offscreen and Auth Functions ---
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
async function hasOffscreenDocument() {
    offscreenDocumentPath = offscreenDocumentPath || chrome.runtime.getURL('offscreen.html');
    const clients = await self.clients.matchAll();
    return clients.some(client => client.url.startsWith(offscreenDocumentPath));
}
async function setupOffscreenDocument(path) {
    if (await hasOffscreenDocument()) return;
    await chrome.offscreen.createDocument({
        url: path,
        reasons: ['DOM_PARSER'],
        justification: 'The DOMParser API is not available in service workers.',
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
        chrome.runtime.sendMessage({ target: 'offscreen', action: 'parseHtml', html: html });
    });
}