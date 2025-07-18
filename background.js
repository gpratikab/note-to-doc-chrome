// background.js

// --- Global State & Storage Functions ---
let NOTES = {};
let AUTH_TOKEN = null;
let IS_SAVING = false;
let OFFSCREEN_DOCUMENT_PATH;

// Map to store long-lived connections from content scripts, mapping tabId to port
const connectedPorts = new Map();

const getStorageData = (key) => new Promise((resolve) => chrome.storage.local.get(key, resolve));
const setStorageData = (data) => new Promise((resolve) => chrome.storage.local.set(data, resolve));
const getSyncData = (key) => new Promise((resolve) => chrome.storage.sync.get(key, resolve));

async function saveState() {
  await setStorageData({ notes: NOTES });
}

// --- Initialization ---
initializeState().then(setupListeners);

async function initializeState() {
  const { notes } = await getStorageData('notes');
  if (notes && typeof notes === 'object') {
    NOTES = notes;
    console.log('Quick Notes: State restored from storage.', NOTES);
  } else {
    console.log('Quick Notes: No state found, starting fresh.');
  }
}

function setupListeners() {
  // Listen for new connections from content scripts
  chrome.runtime.onConnect.addListener(onConnect);
  
  chrome.action.onClicked.addListener(onActionClicked);
  // This onMessage is for simple, one-off messages (like from the offscreen document)
  chrome.runtime.onMessage.addListener(onMessage);
  chrome.alarms.onAlarm.addListener(onAlarm);
  chrome.tabs.onUpdated.addListener(onTabUpdated);
  chrome.tabs.onActivated.addListener(onTabActivated);
  chrome.runtime.onInstalled.addListener(onInstalled);
  console.log('Quick Notes: All listeners registered successfully.');
}

// --- Connection Handling ---
function onConnect(port) {
    if (port.name !== 'quick-note-port') return;

    const tabId = port.sender.tab.id;
    connectedPorts.set(tabId, port);
    console.log(`Tab ${tabId} connected.`);

    // When a tab is closed or navigated away, the port disconnects.
    port.onDisconnect.addListener(() => {
        connectedPorts.delete(tabId);
        console.log(`Tab ${tabId} disconnected.`);
    });

    // Handle messages received from this specific port
    port.onMessage.addListener((request) => {
        handlePortMessage(request, port);
    });

    // When a new connection is made, send it the current state of all notes
    port.postMessage({ action: 'initialNotes', notes: NOTES });
}

// --- Message Handling ---

// Handles messages from long-lived connections
async function handlePortMessage(request, port) {
    const noteId = request.noteId;
    switch (request.action) {
      case "updateNoteContent":
        if (NOTES[noteId]) {
          NOTES[noteId].title = request.data.title;
          NOTES[noteId].content = request.data.content;
          NOTES[noteId].isDirty = true;
          await saveState();
          // Broadcast this update to all other tabs
          broadcastMessage({ action: 'updateNoteContent', noteId: noteId, data: request.data }, port.sender.tab.id);
        }
        break;
      case "updateNotePosition":
        if (NOTES[noteId]) {
          NOTES[noteId] = { ...NOTES[noteId], ...request.data };
          await saveState();
        }
        break;
      case "saveNote":
        if (NOTES[noteId]) {
          await saveNoteToDoc(NOTES[noteId], true);
        }
        break;
      case "toggleMinimize":
        if (NOTES[noteId]) {
          const note = NOTES[noteId];
          note.isMinimized = !note.isMinimized;
          await saveState();
          broadcastMessage({ action: 'updateNoteMinimizedState', noteId: noteId, isMinimized: note.isMinimized });
        }
        break;
      case "closeNote":
        if (NOTES[noteId]) {
          delete NOTES[noteId];
          await saveState();
          broadcastMessage({ action: 'removeNote', noteId: noteId });
        }
        break;
    }
}

// Handles one-off messages (mainly for offscreen document)
function onMessage(request, sender, sendResponse) {
    // The offscreen document communicates with a simple message, so we keep this listener.
    if (request.target === 'offscreen' || request.action === 'parseComplete') {
        // This functionality is handled by the listener inside `parseHtmlViaOffscreen`
        return true;
    }
    return true;
}


// --- Event Handlers ---
async function onActionClicked(tab) {
  if (!tab.url || !tab.url.startsWith('http')) return;
  await ensureScriptInjected(tab.id);

  const noteId = `note-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const newNote = {
    id: noteId,
    title: '',
    content: '',
    top: 60 + (Object.keys(NOTES).length % 10) * 20,
    left: 60 + (Object.keys(NOTES).length % 10) * 20,
    width: 350,
    height: 400,
    isDirty: false,
    isMinimized: false,
    namedRangeId: null
  };
  NOTES[noteId] = newNote;
  
  // Broadcast the creation of the new note to all connected tabs
  broadcastMessage({ action: 'createNote', note: newNote });
  await saveState();
}


async function onAlarm(alarm) {
  if (alarm.name === 'auto-save-all-notes') {
    const dirtyNotes = Object.values(NOTES).filter(note => note && note.isDirty);
    if (dirtyNotes.length > 0) {
      console.log(`[Auto-Save] Found ${dirtyNotes.length} dirty notes to save.`);
      for (const note of dirtyNotes) {
        await saveNoteToDoc(note, false);
      }
    }
  }
}

async function onInstalled(details) {
    if (details.reason === 'install') {
        await chrome.storage.local.clear();
        chrome.alarms.create('auto-save-all-notes', {
            delayInMinutes: 1,
            periodInMinutes: 1
        });
        chrome.runtime.openOptionsPage();
    }
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    for (const tab of tabs) {
       await ensureScriptInjected(tab.id);
    }
}

function onTabUpdated(tabId, changeInfo, tab) {
    if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
        ensureScriptInjected(tabId);
    }
}

async function onTabActivated(activeInfo) {
    await ensureScriptInjected(activeInfo.tabId);
}

// --- Core Logic ---
async function ensureScriptInjected(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch (e) {
    // console.warn(`Could not inject script into tab ${tabId}:`, e.message);
  }
}

// Updated to use the persistent ports
async function broadcastMessage(message, excludeTabId = null) {
  for (const [tabId, port] of connectedPorts.entries()) {
    if (tabId === excludeTabId) continue;
    try {
        port.postMessage(message);
    } catch(e) {
        console.warn(`Could not post message to disconnected tab ${tabId}. Removing port.`);
        connectedPorts.delete(tabId);
    }
  }
}

async function sendStatusUpdate(noteId, status, payload = {}) {
  await broadcastMessage({ action: "updateStatus", noteId, status, payload });
}

// --- API and Saving Logic (no changes in this function) ---
async function saveNoteToDoc(note, isManualSave) {
  const logPrefix = `[SAVE NOTE]`;

  if (IS_SAVING) {
    console.log(`${logPrefix} Save already in progress. Marking note as dirty to save later.`);
    if (NOTES[note.id]) NOTES[note.id].isDirty = true;
    return;
  }

  const { id, title, content } = note;
  const noteStateAtSaveStart = { title, content };

  if (!title.trim() && !content.replace(/<[^>]*>?/gm, '').trim()) {
    console.log(`${logPrefix} Note is empty. Aborting save.`);
    return;
  }

  IS_SAVING = true;
  await sendStatusUpdate(id, "saving");
  console.log(`${logPrefix} Starting save for note ID: ${note.id}. NamedRangeId: ${note.namedRangeId}`);

  try {
    const { docId } = await getSyncData('docId');
    if (!docId) throw new Error("Google Doc ID is not configured. Please set it in the extension options.");
    
    const token = await getAuthToken(isManualSave);
    const requests = [];

    const { plainText: contentText, requests: contentFormattingRequests } = await parseHtmlViaOffscreen(content);
    
    const now = new Date();
    const formattedDate = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const formattedTime = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const titleText = title.trim() || `Note from ${formattedDate}`;
    const contentLabelText = `Content:\n`;

    if (note.namedRangeId) {
        const docResponse = await fetch(`https://docs.googleapis.com/v1/documents/${docId}?fields=namedRanges`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!docResponse.ok) throw new Error(`Failed to fetch doc data: ${(await docResponse.json()).error.message}`);
        
        const docData = await docResponse.json();
        const namedRangeInfo = docData.namedRanges?.[note.id];
        const existingRange = namedRangeInfo?.namedRanges?.[0]?.ranges?.[0];
        
        if (!existingRange) {
            note.namedRangeId = null; 
        } else {
            const timestampText = `Updated: ${formattedDate} at ${formattedTime}\n`;
            const fullTextToInsert = `${titleText}\n${timestampText}${contentLabelText}${contentText}\n\n`;
            
            requests.push({ deleteContentRange: { range: existingRange } });
            requests.push({ insertText: { location: { index: existingRange.startIndex }, text: fullTextToInsert } });
            
            let titleEndIndex = existingRange.startIndex + titleText.length;
            requests.push({ updateParagraphStyle: { range: { startIndex: existingRange.startIndex, endIndex: titleEndIndex }, paragraphStyle: { namedStyleType: 'HEADING_1' }, fields: 'namedStyleType' } });
            
            let contentStartIndex = titleEndIndex + 1 + timestampText.length + contentLabelText.length;
            contentFormattingRequests.forEach(req => {
                const reqKey = Object.keys(req)[0];
                req[reqKey].range.startIndex += contentStartIndex;
                req[reqKey].range.endIndex += contentStartIndex;
                requests.push(req);
            });

            requests.push({ createNamedRange: { name: id, range: { startIndex: existingRange.startIndex, endIndex: existingRange.startIndex + fullTextToInsert.length } } });
        }
    } 
    
    if (!note.namedRangeId) {
        const docResponse = await fetch(`https://docs.googleapis.com/v1/documents/${docId}?fields=body.content`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!docResponse.ok) throw new Error(`Failed to fetch doc body: ${(await docResponse.json()).error.message}`);
        const docData = await docResponse.json();

        const timestampText = `Created: ${formattedDate} at ${formattedTime}\n`;
        const fullTextToInsert = `${titleText}\n${timestampText}${contentLabelText}${contentText}\n\n`;
        const insertionIndex = docData.body.content[docData.body.content.length - 1].endIndex - 1;
        
        requests.push({ insertText: { location: { index: insertionIndex }, text: fullTextToInsert } });
        
        let titleEndIndex = insertionIndex + titleText.length;
        requests.push({ updateParagraphStyle: { range: { startIndex: insertionIndex, endIndex: titleEndIndex }, paragraphStyle: { namedStyleType: 'HEADING_1' }, fields: 'namedStyleType' } });
        
        let contentStartIndex = titleEndIndex + 1 + timestampText.length + contentLabelText.length;
        contentFormattingRequests.forEach(req => {
            const reqKey = Object.keys(req)[0];
            req[reqKey].range.startIndex += contentStartIndex;
            req[reqKey].range.endIndex += contentStartIndex;
            requests.push(req);
        });

        requests.push({ createNamedRange: { name: id, range: { startIndex: insertionIndex, endIndex: insertionIndex + fullTextToInsert.length } } });
    }
    
    const updateResponse = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ requests }) });
    if (!updateResponse.ok) throw new Error(`batchUpdate failed: ${(await updateResponse.json()).error.message}`);

    const replyData = await updateResponse.json();
    const createNamedRangeReply = replyData.replies.find(r => r.createNamedRange);
    const newNamedRangeId = createNamedRangeReply?.createNamedRange?.namedRangeId;

    if (NOTES[id] && newNamedRangeId) {
      if (NOTES[id].title === noteStateAtSaveStart.title && NOTES[id].content === noteStateAtSaveStart.content) {
        NOTES[id].isDirty = false;
      }
      NOTES[id].namedRangeId = newNamedRangeId; 
    } else {
      console.error(`${logPrefix} Failed to update local note state. Note object or newNamedRangeId was missing.`);
    }
    await sendStatusUpdate(id, "saved");

  } catch (error) {
    console.error(`${logPrefix} --- ERROR DURING SAVE ---`);
    console.error(error);
    await sendStatusUpdate(id, "error", { message: error.message });
    if (error.message.toLowerCase().includes("token")) {
      chrome.identity.removeCachedAuthToken({ token: AUTH_TOKEN }, () => { AUTH_TOKEN = null; });
    }
  } finally {
    IS_SAVING = false;
    await saveState();
  }
}

// --- Auth and Offscreen Functions ---
function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    if (AUTH_TOKEN) return resolve(AUTH_TOKEN);
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      AUTH_TOKEN = token;
      resolve(token);
    });
  });
}

async function hasOffscreenDocument() {
    if (!chrome.offscreen) return false;
    const path = chrome.runtime.getURL('offscreen.html');
    const clients = await self.clients.matchAll();
    return clients.some(client => client.url === path);
}

async function setupOffscreenDocument() {
    if (await hasOffscreenDocument()) return;
    await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.DOM_PARSER],
        justification: 'The DOMParser API is not available in service workers.',
    });
}

async function parseHtmlViaOffscreen(html) {
    await setupOffscreenDocument();
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