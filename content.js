// content.js

(() => {
    // This script can be injected multiple times, so we need to ensure we only run the setup once.
    if (window.quickNoteScriptInjected) {
        return;
    }
    window.quickNoteScriptInjected = true;

    // --- Global container for all note UIs on this page ---
    const allNotes = new Map();

    // --- Main Function to Create a Single Note UI ---
    function createNoteUI(note) {
        // If this note UI already exists, don't recreate it.
        if (allNotes.has(note.id)) {
            return;
        }

        const host = document.createElement('div');
        host.id = note.id; // The host element now gets the unique ID
        const shadowRoot = host.attachShadow({ mode: 'open' });

        const container = document.createElement('div');
        container.className = 'qn-container';
        container.style.top = `${note.top}px`;
        container.style.left = `${note.left}px`;
        container.style.width = `${note.width}px`;
        container.style.height = `${note.height}px`;

        const styleLink = document.createElement('link');
        styleLink.rel = 'stylesheet';
        styleLink.href = chrome.runtime.getURL('style.css');

        const header = document.createElement('div');
        header.className = 'qn-header';
        header.textContent = 'Quick Note';

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

        header.appendChild(closeButton);
        mainContainer.append(titleInput, toolbar, editor);
        footer.append(saveButton, statusSpan, resizeHandle);
        container.append(header, mainContainer, footer);
        shadowRoot.append(styleLink, container);
        document.body.appendChild(host);

        allNotes.set(note.id, { host, container, titleInput, editor, statusSpan, saveButton });

        // --- Attach Event Listeners for this specific note ---
        closeButton.onclick = () => {
            chrome.runtime.sendMessage({ action: "closeNote", noteId: note.id });
        };
        
        saveButton.onclick = () => {
            chrome.runtime.sendMessage({
                action: "saveNote",
                noteId: note.id
            });
        };

        let debounceTimer;
        const debouncedCacheUpdate = () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                chrome.runtime.sendMessage({
                    action: "updateNoteContent",
                    noteId: note.id,
                    data: { title: titleInput.value, content: editor.innerHTML }
                });
            }, 500);
        };

        titleInput.addEventListener('input', debouncedCacheUpdate);
        editor.addEventListener('input', debouncedCacheUpdate);

        toolbar.addEventListener('mousedown', (e) => {
            const button = e.target.closest('.qn-toolbar-btn');
            if (button) {
                e.preventDefault();
                const command = button.dataset.command;
                document.execCommand(command, false, null);
            }
        });

        makeDraggable(container, header, note.id);
        makeResizable(container, resizeHandle, note.id);
    }

    // --- Helper Functions ---
    function makeDraggable(element, dragHandle, noteId) {
        dragHandle.onmousedown = (e) => {
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
                chrome.runtime.sendMessage({
                    action: "updateNotePosition", noteId,
                    data: {
                        top: element.offsetTop, left: element.offsetLeft,
                        width: element.offsetWidth, height: element.offsetHeight
                    }
                });
            };
        };
    }

    function makeResizable(element, handle, noteId) {
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
                chrome.runtime.sendMessage({
                    action: "updateNotePosition", noteId,
                    data: {
                        top: element.offsetTop, left: element.offsetLeft,
                        width: element.offsetWidth, height: element.offsetHeight
                    }
                });
            };
        };
    }

    // --- Message Listener for Background Script ---
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "createNote") {
            createNoteUI(request.note);
        } else if (request.action === "removeNote") {
            const noteUI = allNotes.get(request.noteId);
            if (noteUI) {
                noteUI.host.remove();
                allNotes.delete(request.noteId);
            }
        } else if (request.action === "updateStatus") {
            const noteUI = allNotes.get(request.noteId);
            if (noteUI) {
                const { statusSpan, saveButton } = noteUI;
                statusSpan.className = `qn-status qn-status-${request.status}`;
                switch (request.status) {
                    case 'idle':
                        statusSpan.textContent = 'Ready';
                        saveButton.disabled = false;
                        break;
                    case 'saving':
                        statusSpan.textContent = 'Saving...';
                        saveButton.disabled = true;
                        break;
                    case 'saved':
                        statusSpan.textContent = 'Saved!';
                        saveButton.disabled = false;
                        setTimeout(() => statusSpan.textContent = 'Ready', 2000);
                        break;
                    case 'error':
                        statusSpan.textContent = 'Error!';
                        statusSpan.title = request.payload.message;
                        saveButton.disabled = false;
                        break;
                }
            }
        }
    });

    // --- Initial Load ---
    chrome.runtime.sendMessage({ action: "getInitialNotes" }, (initialNotes) => {
        if (chrome.runtime.lastError) { return; }
        if (initialNotes) {
            for (const noteId in initialNotes) {
                createNoteUI(initialNotes[noteId]);
            }
        }
    });

})();