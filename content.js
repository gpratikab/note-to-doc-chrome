// content.js

(() => {
  // Ensure script runs only once
  if (document.getElementById('quick-note-container')) {
    const container = document.getElementById('quick-note-container');
    container.style.display = container.style.display === 'none' ? 'block' : 'none';
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
  closeButton.onclick = () => {
    const title = document.getElementById('qn-title-input').value;
    const content = document.getElementById('qn-editor').innerHTML;
    chrome.runtime.sendMessage({ action: "saveAndClose", data: { title, content } });
    container.remove();
  };

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

  // --- Assemble the UI ---
  header.appendChild(closeButton);
  mainContainer.append(titleInput, toolbar, editor);
  container.append(header, mainContainer);
  document.body.appendChild(container);

  // --- Add CSS ---
  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = chrome.runtime.getURL('style.css');
  document.head.appendChild(styleLink);

  // --- UI Logic ---
  
  // Make the container draggable
  makeDraggable(container, header);

  // Formatting buttons
  toolbar.addEventListener('click', (e) => {
    const command = e.target.closest('.qn-toolbar-btn')?.dataset.command;
    if (command) {
      document.execCommand(command, false, null);
      editor.focus();
    }
  });

  // Debounced message sending to background script
  let debounceTimer;
  const sendNoteToBackground = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const title = titleInput.value;
      const content = editor.innerHTML;
      chrome.runtime.sendMessage({ action: "cacheNote", data: { title, content } });
    }, 500); // Send update 500ms after user stops typing
  };

  titleInput.addEventListener('input', sendNoteToBackground);
  editor.addEventListener('input', sendNoteToBackground);
  
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

