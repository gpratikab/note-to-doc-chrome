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
  closeButton.title = 'Close without saving';

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
    <button class="qn-toolbar-btn" data-command="bold" title="Bold"><b>B</b></button>
    <button class="qn-toolbar-btn" data-command="italic" title="Italic"><i>I</i></button>
    <button class="qn-toolbar-btn" data-command="underline" title="Underline"><u>U</u></button>
    <button class="qn-toolbar-btn" data-command="insertUnorderedList" title="Bulleted List">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
            <path fill-rule="evenodd" d="M5 11.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm-3 1a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm0 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm0 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/>
        </svg>
    </button>
    <button class="qn-toolbar-btn" data-command="insertOrderedList" title="Numbered List">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
            <path fill-rule="evenodd" d="M1.224 11.85H.5v-1h.624a.56.56 0 0 1 .56.56v.38a.56.56 0 0 1-.56.56H.5v-1h.624a.56.56 0 0 1 .56.56v.38a.56.56 0 0 1-.56.56H.5v-1h.724v.216c.196.256.45.42.7.534.25.114.5.17.75.17.65 0 1.155-.33 1.405-.984.25-.654.229-1.422 0-1.924C3.15 9.42 2.5 9 1.65 9c-.45 0-.8.13-1.05.39-.25.26-.35.6-.35 1.05v.216h1.668v-1.14H.5v1.14h.624a.56.56 0 0 1 .56.56v.38a.56.56 0 0 1-.56.56H.5v-1h.624a.56.56 0 0 1 .56.56v.38a.56.56 0 0 1-.56.56zM5 11.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zM1.65 5.85c.55 0 .95.33 1.15.9.2.55.17 1.2-.05 1.65-.22.45-.6.7-1.1.7-.55 0-.95-.33-1.15-.9-.2-.55-.17-1.2.05-1.65.22-.45.6-.7 1.1-.7z"/>
        </svg>
    </button>
  `;

  const editor = document.createElement('div');
  editor.id = 'qn-editor';
  editor.className = 'qn-editor';
  editor.contentEditable = 'true';
  editor.setAttribute('data-placeholder', 'Start writing your note...');

  const footer = document.createElement('div');
  footer.className = 'qn-footer';
  
  const saveCloseButton = document.createElement('button');
  saveCloseButton.className = 'qn-save-close-btn';
  saveCloseButton.textContent = 'Save & Close';

  const statusSpan = document.createElement('span');
  statusSpan.id = 'qn-status';
  statusSpan.className = 'qn-status-idle';
  statusSpan.textContent = 'Ready';
  
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'qn-resize-handle';


  // --- Assemble the UI ---
  header.appendChild(closeButton);
  mainContainer.append(titleInput, toolbar, editor);
  // MODIFIED: Append resize handle inside the footer for correct positioning
  footer.append(saveCloseButton, statusSpan, resizeHandle);
  container.append(header, mainContainer, footer);
  document.body.appendChild(container);

  // --- Add CSS ---
  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = chrome.runtime.getURL('style.css');
  document.head.appendChild(styleLink);
  
  // --- UI Logic ---
  
  chrome.runtime.sendMessage({ action: "getInitialCache" }, (response) => {
    if (chrome.runtime.lastError) {
        console.log("Could not get initial cache. It may be empty.");
    } else if (response) {
      titleInput.value = response.title || '';
      editor.innerHTML = response.content || '';
    }
  });

  const performSaveAndClose = () => {
    const title = titleInput.value;
    const content = editor.innerHTML;
    container.style.display = 'none'; 
    chrome.runtime.sendMessage({ action: "saveAndClose", data: { title, content } });
  };

  closeButton.onclick = () => {
      container.style.display = 'none';
  };
  
  saveCloseButton.onclick = performSaveAndClose;

  makeDraggable(container, header);
  makeResizable(container, resizeHandle);

  toolbar.addEventListener('click', (e) => {
    const command = e.target.closest('.qn-toolbar-btn')?.dataset.command;
    if (command) {
      document.execCommand(command, false, null);
      editor.focus();
    }
  });

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
  
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "updateStatus") {
      try {
        updateStatus(request.status, request.message);
        sendResponse({ received: true });
      } catch (e) {
        console.error("Failed to update status UI:", e);
      }
      return true;
    }
  });

  function updateStatus(status, message = '') {
      if (!statusSpan) {
          console.error("Could not find status element to update.");
          return;
      }
      statusSpan.className = `qn-status-${status}`;
      switch (status) {
          case 'idle': statusSpan.textContent = message || 'Ready'; break;
          case 'saving': statusSpan.textContent = 'Saving...'; break;
          case 'saved': statusSpan.textContent = `Saved at ${new Date().toLocaleTimeString()}`; break;
          case 'error':
              statusSpan.textContent = `Error!`;
              statusSpan.title = message;
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
  
  // This is a robust, JavaScript-based resizer function.
  function makeResizable(element, handle) {
    handle.addEventListener('mousedown', function(e) {
        e.preventDefault();
        e.stopPropagation();

        const initialWidth = element.offsetWidth;
        const initialHeight = element.offsetHeight;
        const initialX = e.clientX;
        const initialY = e.clientY;
        const minWidth = 300; // From CSS
        const minHeight = 250; // From CSS

        function handleMouseMove(e) {
            const newWidth = initialWidth + (e.clientX - initialX);
            const newHeight = initialHeight + (e.clientY - initialY);
            element.style.width = `${Math.max(minWidth, newWidth)}px`;
            element.style.height = `${Math.max(minHeight, newHeight)}px`;
        }

        function handleMouseUp() {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        }

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    });
  }

})();

