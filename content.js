// content.js

(() => {
    // This script can be injected multiple times, so we need to ensure we only run the setup once.
    if (window.quickNoteScriptInjected) {
        return;
    }
    window.quickNoteScriptInjected = true;

    let port;
    const allNotes = new Map();

    // REMOVED: The 'killAllNotes' listener is no longer needed with the new background script logic.

    function setupConnection() {
        port = chrome.runtime.connect({ name: 'quick-note-port' });

        // Listen for messages from the background script via the persistent connection
        port.onMessage.addListener(handleMessage);

        // Handle disconnection (e.g., when the extension is reloaded)
        port.onDisconnect.addListener(() => {
            console.warn("Quick Notes: Connection to background script lost. Refresh page to restore.");
            // Grey out the UI to indicate it's disconnected
            allNotes.forEach(({ host }) => {
                 const shadow = host.shadowRoot;
                if (shadow) {
                    const container = shadow.querySelector('.qn-container');
                    if (container) container.style.opacity = '0.5';
                    const status = shadow.querySelector('.qn-status');
                    if (status) {
                        status.textContent = 'Error: Refresh page';
                        status.className = 'qn-status qn-status-error';
                    }
                    // Disable all buttons
                    shadow.querySelectorAll('button').forEach(btn => btn.disabled = true);
                }
            });
            port = null; // Clear the port
        });
    }

    // Establish the initial connection
    setupConnection();


    // --- Message Handler for the persistent port ---
    function handleMessage(request) {
        // If the port is null, it means we are disconnected.
        if (!port) return;

        switch (request.action) {
            case "initialNotes":
                // When a tab is focused or opened, it receives all existing notes.
                // Clear any old notes first to prevent duplicates.
                allNotes.forEach(({ host }) => host.remove());
                allNotes.clear();
                if (request.notes) {
                    Object.values(request.notes).forEach(createNoteUI);
                }
                break;
            case "createNote":
                createNoteUI(request.note);
                break;
            case "removeNote":
                const noteToRemove = allNotes.get(request.noteId);
                if (noteToRemove) {
                    noteToRemove.host.remove();
                    allNotes.delete(request.noteId);
                }
                break;
            case "updateNoteMinimizedState":
                const noteToMinimize = allNotes.get(request.noteId);
                if (noteToMinimize) {
                    noteToMinimize.container.classList.toggle('minimized', request.isMinimized);
                }
                break;
            case "updateNoteContent":
                const noteToUpdateContent = allNotes.get(request.noteId);
                if (noteToUpdateContent) {
                    noteToUpdateContent.headerTitle.textContent = request.data.title || 'Quick Note';
                    if(document.activeElement !== noteToUpdateContent.titleInput) {
                        noteToUpdateContent.titleInput.value = request.data.title;
                    }
                    if(document.activeElement !== noteToUpdateContent.editor) {
                        noteToUpdateContent.editor.innerHTML = request.data.content;
                    }
                }
                break;
            case "updateStatus":
                const noteToUpdate = allNotes.get(request.noteId);
                if (noteToUpdate) {
                    const { statusSpan, saveButton } = noteToUpdate;
                    statusSpan.className = `qn-status qn-status-${request.status}`;
                    switch (request.status) {
                        case 'idle':
                            statusSpan.textContent = 'Ready';
                            statusSpan.title = '';
                            saveButton.disabled = false;
                            break;
                        case 'saving':
                            statusSpan.textContent = 'Saving...';
                            saveButton.disabled = true;
                            break;
                        case 'saved':
                            statusSpan.textContent = 'Saved!';
                            saveButton.disabled = false;
                            setTimeout(() => {
                                if (statusSpan.textContent === 'Saved!') {
                                    statusSpan.textContent = 'Ready';
                                }
                            }, 2000);
                            break;
                        case 'error':
                            statusSpan.textContent = 'Error!';
                            statusSpan.title = request.payload.message;
                            saveButton.disabled = false;
                            break;
                    }
                }
                break;
        }
    }


    // --- Main Function to Create a Single Note UI ---
    function createNoteUI(note) {
        if (allNotes.has(note.id)) return;

        const host = document.createElement('div');
        host.id = note.id;
        const shadowRoot = host.attachShadow({ mode: 'open' });

        const container = document.createElement('div');
        container.className = 'qn-container';
        if (note.isMinimized) container.classList.add('minimized');
        
        container.style.top = `${note.top}px`;
        container.style.left = `${note.left}px`;
        container.style.width = `${note.width}px`;
        container.style.height = `${note.height}px`;

        const styleLink = document.createElement('link');
        styleLink.rel = 'stylesheet';
        styleLink.href = chrome.runtime.getURL('style.css');

        const header = document.createElement('div');
        header.className = 'qn-header';
        
        const headerTitle = document.createElement('span');
        headerTitle.className = 'qn-header-title';
        headerTitle.textContent = note.title || 'Quick Note';

        const headerButtons = document.createElement('div');
        headerButtons.className = 'qn-header-buttons';

        const minimizeButton = document.createElement('button');
        minimizeButton.innerHTML = '&#8210;';
        minimizeButton.className = 'qn-minimize-btn';
        minimizeButton.title = 'Minimize Note';

        const closeButton = document.createElement('button');
        closeButton.innerHTML = '&times;';
        closeButton.className = 'qn-close-btn';
        closeButton.title = 'Close Note';

        const mainContainer = document.createElement('div');
        mainContainer.className = 'qn-main';

        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.className = 'qn-input';
        titleInput.placeholder = 'Note Title';
        titleInput.value = note.title;

        const editor = document.createElement('div');
        editor.className = 'qn-editor';
        editor.contentEditable = 'true';
        editor.setAttribute('data-placeholder', 'Start writing your note...');
        editor.innerHTML = note.content;

        const toolbar = document.createElement('div');
        toolbar.className = 'qn-toolbar';
        toolbar.innerHTML = `
            <button class="qn-toolbar-btn" data-command="bold" title="Bold"><b>B</b></button>
            <button class="qn-toolbar-btn" data-command="italic" title="Italic"><i>I</i></button>
            <button class="qn-toolbar-btn" data-command="underline" title="Underline"><u>U</u></button>
            <button class="qn-toolbar-btn" data-command="insertUnorderedList" title="Bulleted List"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M5 11.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm-3 1a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm0 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm0 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/></svg></button>
            <button class="qn-toolbar-btn" data-command="insertOrderedList" title="Numbered List"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M1.224 11.85H.5v-1h.624a.56.56 0 0 1 .56.56v.38a.56.56 0 0 1-.56.56H.5v-1h.624a.56.56 0 0 1 .56.56v.38a.56.56 0 0 1-.56.56H.5v-1h.724v.216c.196.256.45.42.7.534.25.114.5.17.75.17.65 0 1.155-.33 1.405-.984.25-.654.229-1.422 0-1.924C3.15 9.42 2.5 9 1.65 9c-.45 0-.8.13-1.05.39-.25.26-.35.6-.35 1.05v.216h1.668v-1.14H.5v1.14h.624a.56.56 0 0 1 .56.56v.38a.56.56 0 0 1-.56.56H.5v-1h.624a.56.56 0 0 1 .56.56v.38a.56.56 0 0 1-.56.56zM5 11.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zM1.65 5.85c.55 0 .95.33 1.15.9.2.55.17 1.2-.05 1.65-.22.45-.6.7-1.1.7-.55 0-.95-.33-1.15-.9-.2-.55-.17-1.2.05-1.65.22-.45.6-.7 1.1-.7z"/></svg></button>
        `;

        const footer = document.createElement('div');
        footer.className = 'qn-footer';

        const saveButton = document.createElement('button');
        saveButton.className = 'qn-save-btn';
        saveButton.textContent = 'Save';

        const statusSpan = document.createElement('span');
        statusSpan.className = 'qn-status';
        statusSpan.textContent = 'Ready';

        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'qn-resize-handle';

        header.appendChild(headerTitle);
        headerButtons.append(minimizeButton, closeButton);
        header.appendChild(headerButtons);
        mainContainer.append(titleInput, toolbar, editor);
        footer.append(saveButton, statusSpan);
        container.append(header, mainContainer, footer, resizeHandle);
        shadowRoot.append(styleLink, container);
        document.body.appendChild(host);

        allNotes.set(note.id, { host, container, titleInput, editor, statusSpan, saveButton, minimizeButton, headerTitle });

        const postIfConnected = (message) => {
            if (port) port.postMessage(message);
        };

        closeButton.onclick = () => postIfConnected({ action: "closeNote", noteId: note.id });
        minimizeButton.onclick = () => postIfConnected({ action: "toggleMinimize", noteId: note.id });
        saveButton.onclick = () => postIfConnected({ action: "saveNote", noteId: note.id });

        let debounceTimer;
        const debouncedCacheUpdate = () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                headerTitle.textContent = titleInput.value || 'Quick Note';
                postIfConnected({
                    action: "updateNoteContent",
                    noteId: note.id,
                    data: { title: titleInput.value, content: editor.innerHTML }
                });
            }, 500);
        };
        
        // Add a paste event listener to the editor to auto-format links
        editor.addEventListener('paste', (e) => {
            // Let the paste happen naturally, then process the result.
            setTimeout(() => {
                linkifyNode(editor);
                debouncedCacheUpdate(); // Trigger a save after linkifying
            }, 50); 
        });

        titleInput.addEventListener('input', debouncedCacheUpdate);
        editor.addEventListener('input', debouncedCacheUpdate);

        toolbar.addEventListener('mousedown', (e) => {
            const button = e.target.closest('.qn-toolbar-btn');
            if (button) {
                e.preventDefault();
                document.execCommand(button.dataset.command, false, null);
                debouncedCacheUpdate();
            }
        });

        makeDraggable(container, header, note.id, postIfConnected);
        makeResizable(container, resizeHandle, note.id, postIfConnected);
    }

    // --- Helper Functions ---

    // New function to find and format URLs within a given node.
    function linkifyNode(node) {
        const urlRegex = /https?:\/\/[^\s<>"']+/g;
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        const nodesToProcess = [];

        // First, find all text nodes that contain a URL and are not already in a link.
        let textNode;
        while (textNode = walker.nextNode()) {
            if (textNode.parentNode.tagName !== 'A' && urlRegex.test(textNode.nodeValue)) {
                nodesToProcess.push(textNode);
            }
        }

        // Process the collected nodes to avoid issues with DOM modification during traversal.
        nodesToProcess.forEach(textNode => {
            const fragment = document.createDocumentFragment();
            let lastIndex = 0;

            textNode.nodeValue.replace(urlRegex, (match, offset) => {
                // Add the text before the found URL.
                const textBefore = textNode.nodeValue.substring(lastIndex, offset);
                if (textBefore) {
                    fragment.appendChild(document.createTextNode(textBefore));
                }

                // Create the link element.
                const link = document.createElement('a');
                link.href = match;
                link.textContent = match;
                fragment.appendChild(link);

                lastIndex = offset + match.length;
            });

            // Add any remaining text after the last URL.
            const textAfter = textNode.nodeValue.substring(lastIndex);
            if (textAfter) {
                fragment.appendChild(document.createTextNode(textAfter));
            }

            // Replace the original text node with the new fragment containing links.
            if (fragment.hasChildNodes()) {
                textNode.parentNode.replaceChild(fragment, textNode);
            }
        });
    }

    function makeDraggable(element, dragHandle, noteId, postIfConnected) {
        dragHandle.onmousedown = (e) => {
            if (e.target.closest('button')) return;
            e.preventDefault();
            let pos3 = e.clientX, pos4 = e.clientY;
            document.onmousemove = (e) => {
                e.preventDefault();
                let pos1 = pos3 - e.clientX, pos2 = pos4 - e.clientY;
                pos3 = e.clientX; pos4 = e.clientY;
                element.style.top = `${element.offsetTop - pos2}px`;
                element.style.left = `${element.offsetLeft - pos1}px`;
            };
            document.onmouseup = () => {
                document.onmouseup = document.onmousemove = null;
                postIfConnected({ action: "updateNotePosition", noteId, data: { top: element.offsetTop, left: element.offsetLeft } });
            };
        };
    }

    function makeResizable(element, handle, noteId, postIfConnected) {
        handle.onmousedown = (e) => {
            e.preventDefault(); e.stopPropagation();
            let initialWidth = element.offsetWidth, initialHeight = element.offsetHeight;
            let initialX = e.clientX, initialY = e.clientY;
            const minWidth = 300, minHeight = 250;
            document.onmousemove = (e) => {
                const newWidth = initialWidth + (e.clientX - initialX);
                const newHeight = initialHeight + (e.clientY - initialY);
                element.style.width = `${Math.max(minWidth, newWidth)}px`;
                element.style.height = `${Math.max(minHeight, newHeight)}px`;
            };
            document.onmouseup = () => {
                document.onmouseup = document.onmousemove = null;
                postIfConnected({ action: "updateNotePosition", noteId, data: { width: element.offsetWidth, height: element.offsetHeight } });
            };
        };
    }
})();