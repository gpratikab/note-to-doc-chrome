// background.js

// --- Global State ---
let authToken = null;
let noteCache = { title: '', content: '' };

// --- Extension Lifecycle ---

// Listener for the extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  try {
    // Attempt to inject the content script into the active tab
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
  } catch (e) {
    // If injection fails, it's likely a protected page.
    console.error(`Quick Notes: Failed to inject script. Error: ${e.message}`);
    
    // Create a user-friendly notification to explain the issue.
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon128.png', // You'll need to add an icon to your extension folder
      title: 'Quick Notes Blocked',
      message: 'This page is protected by browser policy. The Quick Notes extension cannot run here.',
      priority: 2
    });
  }
});

// Listener for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "cacheNote") {
    noteCache = request.data;
  }
  if (request.action === "saveAndClose") {
    noteCache = request.data;
    saveNoteToDoc(true); // Force save on close
  }
  // This return true is important for async sendResponse
  return true;
});

// --- Alarms for Autosave ---

// Create an alarm to save the note every minute
chrome.alarms.create('auto-save-note', {
  delayInMinutes: 1,
  periodInMinutes: 1
});

// Listener for the alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'auto-save-note') {
    saveNoteToDoc(false);
  }
});


// --- Google Docs API Integration ---

// Function to get OAuth2 token
function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        authToken = token;
        resolve(token);
      }
    });
  });
}

// Main function to save the note
async function saveNoteToDoc(isFinalSave) {
  if ((!noteCache.content || noteCache.content.trim() === '') && (!noteCache.title || noteCache.title.trim() === '')) {
    if (isFinalSave) console.log("Note is empty, nothing to save.");
    return;
  }

  try {
    // Try to get token silently first. If it fails, try interactively.
    let token = await getAuthToken(false).catch(async () => {
      console.log("Silent auth failed, trying interactive auth.");
      return await getAuthToken(true);
    });

    if (!token) {
      console.error("Could not obtain authentication token. The user may have denied the request.");
      return;
    }
    
    // --- IMPORTANT ---
    // The Google Doc ID is now hardcoded. Replace the placeholder below.
    // Get the ID from your Google Doc's URL. For a URL like:
    // https://docs.google.com/document/d/1a2b3c4d_LONG_ID_HERE_5e6f/edit
    // The ID is "1a2b3c4d_LONG_ID_HERE_5e6f"
    const docId = "1QrcHJj661dqQdysr4Y4W-Qa6ltI-ikysg9X_ol4VZ34";

    if (docId === "YOUR_DOCUMENT_ID_HERE") {
      console.error("ACTION REQUIRED: Please hardcode your Google Doc ID in background.js before using the extension.");
      // We will stop here to prevent errors.
      return;
    }

    const timestamp = new Date().toLocaleString();
    const titleText = noteCache.title.trim() === '' ? 'Untitled Note' : noteCache.title;

    // This regular expression strips HTML tags from the content string.
    const plainTextContent = noteCache.content.replace(/<[^>]*>?/gm, '');
    
    const textToInsert = `\n\n--- ${timestamp} ---\nTitle: ${titleText}\n\n${plainTextContent}\n---`;

    // First, get the document to find its end index
    const getResponse = await fetch(`https://docs.googleapis.com/v1/documents/${docId}?fields=body.content`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!getResponse.ok) {
      // --- IMPROVED ERROR LOGGING ---
      // Try to get a more detailed error message from the API response body.
      let errorDetails = `Status: ${getResponse.status}, Status Text: "${getResponse.statusText}"`;
      try {
        const errorData = await getResponse.json();
        errorDetails += `, Response: ${JSON.stringify(errorData)}`;
      } catch (e) {
        // If the response isn't JSON, capture it as text.
        errorDetails += `, Body: "${await getResponse.text()}"`;
      }
      throw new Error(`Failed to get document. Details: ${errorDetails}`);
    }

    const docData = await getResponse.json();
    let insertionIndex = 1; // Default for an empty doc

    // Safely find the end of the document to append text
    if (docData.body && docData.body.content) {
      const lastElement = docData.body.content[docData.body.content.length - 1];
      if (lastElement.endIndex > 1) {
        insertionIndex = lastElement.endIndex - 1;
      }
    }
    
    const params = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        requests: [{
          insertText: {
            location: { index: insertionIndex },
            text: textToInsert
          }
        }]
      })
    };

    const updateResponse = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, params);

    if (!updateResponse.ok) {
      // --- IMPROVED ERROR LOGGING ---
      const errorData = await updateResponse.json();
      console.error('API Error on update:', errorData); // Keep the console log
      const errorDetails = `Status: ${updateResponse.status}, Response: ${JSON.stringify(errorData)}`;
      throw new Error(`Failed to update document. Details: ${errorDetails}`);
    }

    console.log('Note successfully saved to Google Doc.');
    // Clear cache after successful save
    noteCache = { title: '', content: '' };

  } catch (error) {
    console.error('Error saving note:', error);
    if (error.message.includes("token")) {
      chrome.identity.removeCachedAuthToken({ token: authToken }, () => {
        authToken = null;
        console.log("Removed invalid auth token.");
      });
    }
  }
}

