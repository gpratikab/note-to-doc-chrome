// background.js

// --- Global State & Storage Functions ---
let NOTES = {};
let AUTH_TOKEN = null;
let IS_SAVING = false;
let OFFSCREEN_DOCUMENT_PATH;

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
  chrome.action.onClicked.addListener(onActionClicked);
  chrome.runtime.onMessage.addListener(onMessage);
  chrome.alarms.onAlarm.addListener(onAlarm);
  chrome.tabs.onUpdated.addListener(onTabUpdated);
  chrome.tabs.onActivated.addListener(onTabActivated);
  chrome.runtime.onInstalled.addListener(onInstalled);
  console.log('Quick Notes: All listeners registered successfully.');
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
    namedRangeId: null // This will hold the official ID from Google Docs.
  };
  NOTES[noteId] = newNote;
  
  chrome.tabs.sendMessage(tab.id, { action: 'createNote', note: newNote }).catch(() => {});
  await saveState();
}

function onMessage(request, sender, sendResponse) {
  if (request.target === 'offscreen') return true;
    
  (async () => {
    switch (request.action) {
      case "getInitialNotes":
        sendResponse(NOTES);
        break;
      case "updateNoteContent":
        if (NOTES[request.noteId]) {
          NOTES[request.noteId].title = request.data.title;
          NOTES[request.noteId].content = request.data.content;
          NOTES[request.noteId].isDirty = true;
          await saveState();
        }
        break;
      case "updateNotePosition":
        if (NOTES[request.noteId]) {
          NOTES[request.noteId] = { ...NOTES[request.noteId], ...request.data };
          await saveState();
        }
        break;
      case "saveNote":
        if (NOTES[request.noteId]) {
          await saveNoteToDoc(NOTES[request.noteId], true);
        }
        break;
      case "closeNote":
        if (NOTES[request.noteId]) {
          delete NOTES[request.noteId];
          broadcastMessage({ action: 'removeNote', noteId: request.noteId });
          await saveState();
        }
        break;
    }
  })();
  return true;
}

async function onAlarm(alarm) {
  if (alarm.name === 'auto-save-all-notes') {
    for (const noteId in NOTES) {
      if (NOTES[noteId]?.isDirty) {
        saveNoteToDoc(NOTES[noteId], false);
      }
    }
  }
}

async function onInstalled(details) {
    if (details.reason === 'install') {
        await chrome.storage.local.clear();
        chrome.alarms.create('auto-save-all-notes', {
            delayInMinutes: 0.2,
            periodInMinutes: 0.2
        });
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
  } catch (e) { /* Ignore */ }
}

async function broadcastMessage(message) {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, message).catch(() => {});
  }
}

async function sendStatusUpdate(noteId, status, payload = {}) {
  await broadcastMessage({ action: "updateStatus", noteId, status, payload });
}

// --- API and Saving Logic with extensive logging ---
async function saveNoteToDoc(note, isManualSave) {
  const logPrefix = `[DEBUG saveNoteToDoc]`;

  console.log(`${logPrefix} --- Initiating save for note ID: ${note.id} ---`);

  if (IS_SAVING) {
    console.log(`${logPrefix} Save already in progress. Marking note as dirty and returning.`);
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
  console.log(`${logPrefix} Locking save function. Current namedRangeId from state: ${note.namedRangeId}`);

  try {
    const { docId } = await getSyncData('docId');
    if (!docId) throw new Error("Google Doc ID is not configured.");
    
    console.log(`${logPrefix} Got Doc ID: ${docId}`);
    
    const token = await getAuthToken(isManualSave);
    const requests = [];
    let createNamedRangeIndex = -1;

    console.log(`${logPrefix} Parsing HTML content via offscreen document.`);
    const { plainText: contentText, requests: contentFormattingRequests } = await parseHtmlViaOffscreen(content);
    
    const now = new Date();
    const formattedDate = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const formattedTime = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const titleText = title.trim() || `Note from ${formattedDate}`;
    const contentLabelText = `Content : \n`;

    if (note.namedRangeId) {
        console.log(`${logPrefix} Entering UPDATE path because namedRangeId exists.`);
        const docResponse = await fetch(`https://docs.googleapis.com/v1/documents/${docId}?fields=namedRanges`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!docResponse.ok) throw new Error(`Failed to fetch doc data: ${(await docResponse.json()).error.message}`);
        
        const docData = await docResponse.json();
        console.log(`${logPrefix} Fetched document named ranges:`, docData.namedRanges);
        
        const namedRange = docData.namedRanges?.[note.id].namedRanges[0];
        
        console.log(`${logPrefix} Pratik Debug`,docData.namedRanges, note.namedRangeId, docData.namedRanges?.[note.id].namedRanges[0]);
        if (!namedRange?.ranges?.length) {
            console.warn(`${logPrefix} Named range ID '${note.namedRangeId}' not found in fetched data. This can be due to API lag. Aborting save; will retry on next cycle.`);
            IS_SAVING = false;
            await sendStatusUpdate(id, "idle");
            return;
        }
        
        console.log(`${logPrefix} Successfully found named range. Proceeding with update.`);
        const existingRange = namedRange.ranges[0];
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
        createNamedRangeIndex = requests.length - 1;

    } else {
        console.log(`${logPrefix} Entering CREATE path because namedRangeId is missing.`);
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
        createNamedRangeIndex = requests.length - 1;
    }
    
    console.log(`${logPrefix} Sending batchUpdate request to Google Docs API with ${requests.length} requests.`);
    // console.log(`${logPrefix} Request body:`, JSON.stringify({ requests }, null, 2));

    const updateResponse = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ requests }) });
    if (!updateResponse.ok) throw new Error(`batchUpdate failed: ${(await updateResponse.json()).error.message}`);

    const replyData = await updateResponse.json();
    console.log(`${logPrefix} Received batchUpdate reply:`, replyData);

    const newNamedRangeId = replyData.replies[createNamedRangeIndex]?.createNamedRange?.namedRangeId;
    console.log(`${logPrefix} Extracted new namedRangeId: ${newNamedRangeId}`);

    if (NOTES[id] && newNamedRangeId) {
      if (NOTES[id].title === noteStateAtSaveStart.title && NOTES[id].content === noteStateAtSaveStart.content) {
        NOTES[id].isDirty = false;
      }
      NOTES[id].namedRangeId = newNamedRangeId; 
      console.log(`${logPrefix} Successfully updated note state in memory with new namedRangeId.`);
    } else {
      console.error(`${logPrefix} Failed to update note state in memory. Note object or newNamedRangeId was missing.`);
    }
    await sendStatusUpdate(id, "saved");

  } catch (error) {
    console.error(`${logPrefix} --- ERROR DURING SAVE ---`);
    console.error(error);
    await sendStatusUpdate(id, "error", { message: error.message });
    if (error.message.includes("token")) {
      chrome.identity.removeCachedAuthToken({ token: AUTH_TOKEN }, () => { AUTH_TOKEN = null; });
    }
  } finally {
    console.log(`${logPrefix} Entering finally block. Releasing save lock and saving state.`);
    await saveState();
    IS_SAVING = false;
    console.log(`${logPrefix} --- Save process finished for note ID: ${note.id} ---`);
  }
}

// --- Auth and Offscreen Functions ---
function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      AUTH_TOKEN = token;
      resolve(token);
    });
  });
}

async function setupOffscreenDocument() {
    OFFSCREEN_DOCUMENT_PATH = OFFSCREEN_DOCUMENT_PATH || chrome.runtime.getURL('offscreen.html');
    const clients = await self.clients.matchAll();
    if (clients.some(client => client.url === OFFSCREEN_DOCUMENT_PATH)) return;
    await chrome.offscreen.createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: ['DOM_PARSER'],
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