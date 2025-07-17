// content.js

(() => {
  // Ensure script runs only once, but allow it to be shown again if hidden
  if (document.getElementById('quick-note-container')) {
    const container = document.getElementById('quick-note-container');
    container.style.display = 'flex';
    return;
  }

  // --- Create the Notepad UI ---
  const container = document.createElement('div');
  container.id = 'quick-note-container';
  container.className = 'qn-container';

  const header = document.createElement('div');
  header.id = 'quick-note-header';
  header.className = 'qn-header';
  header.textContent = 'Quick Note';

  const closeButton = document.createElement('button');
  closeButton.innerHTML = '&times;';
  closeButton.className = 'qn-close-btn';

  const mainContainer = document.createElement('div');
  mainContainer.id = 'qn-main-container';
  mainContainer.className = 'qn-main';

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.id = 'qn-title-input';
  titleInput.placeholder = 'Note Title';
  titleInput.className = 'qn-input';

  const toolbar = document.createElement('div');
  toolbar.className = 'qn-toolbar';
  toolbar.innerHTML = `
    <button class="qn-toolbar-btn" data-command="bold"><b>B</b></button>
    <button class="qn-toolbar-btn" data-command="italic"><i>I</i></button>
    <button class="qn-toolbar-btn" data-command="underline"><u>U</u></button>
  `;

  const editor = document.createElement('div');
  editor.id = 'qn-editor';
  editor.className = 'qn-editor';
  editor.contentEditable = 'true';
  editor.setAttribute('data-placeholder', 'Start writing your note...');

  const footer = document.createElement('div');
  footer.className = 'qn-footer';
  const statusSpan = document.createElement('span');
  statusSpan.id = 'qn-status';
  statusSpan.className = 'qn-status-idle';
  statusSpan.textContent = 'Ready';
  footer.appendChild(statusSpan);


  // --- Assemble the UI ---
  header.appendChild(closeButton);
  mainContainer.append(titleInput, toolbar, editor);
  container.append(header, mainContainer, footer);
  document.body.appendChild(container);

  // --- Add CSS ---
  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = chrome.runtime.getURL('style.css');
  document.head.appendChild(styleLink);
  
  // --- UI Logic ---
  
  // Load cached note from background script on open
  chrome.runtime.sendMessage({ action: "getInitialCache" }, (response) => {
    if (chrome.runtime.lastError) {
        console.log("Could not get initial cache. It may be empty.");
    } else if (response) {
      titleInput.value = response.title || '';
      editor.innerHTML = response.content || '';
    }
  });

  closeButton.onclick = () => {
    const title = titleInput.value;
    const content = editor.innerHTML;
    // Hide the container immediately for a faster user experience
    container.style.display = 'none'; 
    chrome.runtime.sendMessage({ action: "saveAndClose", data: { title, content } });
  };

  makeDraggable(container, header);

  toolbar.addEventListener('click', (e) => {
    const command = e.target.closest('.qn-toolbar-btn')?.dataset.command;
    if (command) {
      document.execCommand(command, false, null);
      editor.focus();
    }
  });

  // Debounced message sending to background script for caching
  let debounceTimer;
  const sendNoteToBackground = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const title = titleInput.value;
      const content = editor.innerHTML;
      chrome.runtime.sendMessage({ action: "cacheNote", data: { title, content } });
      updateStatus('idle', 'Unsaved changes');
    }, 500);
  };

  titleInput.addEventListener('input', sendNoteToBackground);
  editor.addEventListener('input', sendNoteToBackground);
  
  // --- Status Update Listener ---
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // This listener is only responsible for status updates.
    if (request.action === "updateStatus") {
      try {
        updateStatus(request.status, request.message);
        sendResponse({ received: true });
      } catch (e) {
        console.error("Failed to update status UI:", e);
      }
      // Return true to indicate that we are sending a response (best practice for async handling).
      return true;
    }
    // IMPORTANT: Do not return true for other message types, as this listener does not handle them.
    // This allows the message channel to close properly for unhandled actions.
  });

  function updateStatus(status, message = '') {
      // Defensive check to ensure the element exists before trying to modify it.
      if (!statusSpan) {
          console.error("Could not find status element to update.");
          return;
      }
      statusSpan.className = `qn-status-${status}`;
      switch (status) {
          case 'idle':
              statusSpan.textContent = message || 'Ready';
              break;
          case 'saving':
              statusSpan.textContent = 'Saving...';
              break;
          case 'saved':
              statusSpan.textContent = `Saved at ${new Date().toLocaleTimeString()}`;
              break;
          case 'error':
              statusSpan.textContent = `Error!`; // Keep it brief
              statusSpan.title = message; // Show full error on hover
              break;
      }
  }
  
  // --- Helper Functions ---
  function makeDraggable(element, dragHandle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    dragHandle.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
      e.preventDefault();
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      element.style.top = (element.offsetTop - pos2) + "px";
      element.style.left = (element.offsetLeft - pos1) + "px";
    }

    function closeDragElement() {
      document.onmouseup = null;
      document.onmousemove = null;
    }
  }
})();

