// content.js

(() => {
    if (window.quickNoteScriptInjected) return;
    window.quickNoteScriptInjected = true;

    const allNotes = new Map();
    
    // --- Resilient Connection Manager ---
    let port = null;
    let isConnecting = false;
    let messageQueue = [];

    const connect = () => {
        if (port || isConnecting) return;
        isConnecting = true;
        console.log("Quick Notes: Attempting to connect...");
        
        try {
            port = chrome.runtime.connect({ name: 'quick-note-port' });
            port.onMessage.addListener(handleMessage);
            port.onDisconnect.addListener(() => {
                console.warn("Quick Notes: Connection lost. Will attempt to reconnect automatically.");
                port = null;
                setTimeout(connect, 1000 + Math.random() * 2000);
            });
            console.log("Quick Notes: Connection successful.");
            isConnecting = false;
            while(messageQueue.length > 0) {
                port.postMessage(messageQueue.shift());
            }
        } catch (e) {
            console.error("Quick Notes: Connection failed.", e);
            isConnecting = false;
            port = null;
            setTimeout(connect, 5000);
        }
    };
    
    connect();

    const sendMessage = (message) => {
        if (port) {
            try {
                port.postMessage(message);
            } catch (e) {
                port = null;
                messageQueue.push(message);
                connect();
            }
        } else {
            messageQueue.push(message);
            connect();
        }
    };

    // --- Message Handler ---
    function handleMessage(request) {
        if (!port && request.action !== 'initialNotes') {
            connect();
            return;
        };

        const actions = {
            initialNotes: (req) => {
                allNotes.forEach(({ host }) => host.remove());
                allNotes.clear();
                if (req.notes) Object.values(req.notes).forEach(createNoteUI);
            },
            createNote: (req) => createNoteUI(req.note),
            removeNote: (req) => {
                const noteUI = allNotes.get(req.noteId);
                if (noteUI) {
                    noteUI.host.remove();
                    allNotes.delete(req.noteId);
                }
            },
            updateNoteMinimizedState: (req) => {
                allNotes.get(req.noteId)?.container.classList.toggle('minimized', req.isMinimized);
            },
            updatePinState: (req) => {
                 const noteUI = allNotes.get(req.noteId);
                 if(noteUI) {
                    noteUI.container.classList.toggle('pinned', req.isPinned);
                    noteUI.pinButton.classList.toggle('active', req.isPinned);
                 }
            },
            updateNoteColor: (req) => {
                const noteUI = allNotes.get(req.noteId);
                if (noteUI) {
                    noteUI.container.dataset.color = req.color;
                }
            },
            updateNoteContent: (req) => {
                const noteUI = allNotes.get(req.noteId);
                if (noteUI && req.data) {
                    noteUI.headerTitle.textContent = req.data.title || 'Quick Note';
                    if (document.activeElement !== noteUI.titleInput) noteUI.titleInput.value = req.data.title;
                    if (document.activeElement !== noteUI.editor) noteUI.editor.innerHTML = req.data.content;
                }
            },
            updateStatus: (req) => {
                const noteUI = allNotes.get(req.noteId);
                if (noteUI) {
                    const { statusSpan, saveButton } = noteUI;
                    statusSpan.className = `qn-status qn-status-${req.status}`;
                    const statusMap = { idle: 'Ready', saving: 'Saving...', saved: 'Saved!', error: 'Error!' };
                    statusSpan.textContent = statusMap[req.status];
                    saveButton.disabled = (req.status === 'saving');
                    if(req.status === 'error' && req.payload) statusSpan.title = req.payload.message;
                    if(req.status === 'saved') setTimeout(() => {
                        if (statusSpan.textContent === 'Saved!') statusSpan.textContent = 'Ready';
                    }, 2000);
                }
            }
        };
        actions[request.action]?.(request);
    }

    // --- UI Creation and Event Handling ---
    function createNoteUI(note) {
        if (allNotes.has(note.id)) return;

        const host = document.createElement('div');
        host.id = note.id;
        const shadowRoot = host.attachShadow({ mode: 'open' });

        const container = document.createElement('div');
        container.className = 'qn-container';
        container.dataset.color = note.color || 'default';
        if (note.isMinimized) container.classList.add('minimized');
        if (note.isPinned) container.classList.add('pinned');
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

        const pinButton = document.createElement('button');
        pinButton.className = 'qn-pin-btn';
        pinButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.126.125-.25.224-.354.298v4.431l.078.048c.203.127.476.314.751.555C12.36 7.775 13 8.527 13 9.5a.5.5 0 0 1-.5.5h-4v4.5c0 .276-.224.5-.5.5s-.5-.224-.5-.5V10h-4a.5.5 0 0 1-.5-.5c0-.973.64-1.725 1.17-2.176a6.57 6.57 0 0 1 .75-.56V2.777a.5.5 0 0 1-.354-.298C2.342 2.174 2 1.68 2 .5a.5.5 0 0 1 .5-.5z"/></svg>`;
        pinButton.title = 'Pin Note';
        if (note.isPinned) pinButton.classList.add('active');
        
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
        
        const toolbar = createToolbar(editor);

        const footer = document.createElement('div');
        footer.className = 'qn-footer';
        if (note.sourceUrl) {
            const sourceLink = document.createElement('a');
            sourceLink.href = note.sourceUrl;
            sourceLink.textContent = new URL(note.sourceUrl).hostname;
            sourceLink.className = 'qn-source-link';
            sourceLink.target = '_blank';
            footer.appendChild(sourceLink);
        }

        const saveButton = document.createElement('button');
        saveButton.className = 'qn-save-btn';
        saveButton.textContent = 'Save';

        const statusSpan = document.createElement('span');
        statusSpan.className = 'qn-status';
        statusSpan.textContent = 'Ready';

        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'qn-resize-handle';
        
        headerButtons.append(pinButton, minimizeButton, closeButton);
        header.append(headerTitle, headerButtons);
        mainContainer.append(titleInput, toolbar, editor);
        footer.append(statusSpan, saveButton);
        container.append(header, mainContainer, footer, resizeHandle);
        shadowRoot.append(styleLink, container);
        document.body.appendChild(host);

        const uiElements = { 
            host, container, titleInput, editor, statusSpan, saveButton, 
            minimizeButton, closeButton, headerTitle, pinButton, header, resizeHandle,
            colorPicker: toolbar.querySelector('.qn-color-picker')
        };
        allNotes.set(note.id, uiElements);
        attachEventListeners(note.id, uiElements);
    }
    
    function createToolbar(editor) {
        const toolbar = document.createElement('div');
        toolbar.className = 'qn-toolbar';

        const buttons = [
            { command: 'bold', title: 'Bold', content: '<b>B</b>' },
            { command: 'italic', title: 'Italic', content: '<i>I</i>' },
            { command: 'underline', title: 'Underline', content: '<u>U</u>' },
            { command: 'insertUnorderedList', title: 'Bulleted List', content: '<svg viewBox="0 0 16 16"><path fill-rule="evenodd" d="M5 11.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm-3 1a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm0 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm0 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/></svg>' },
            { command: 'insertOrderedList', title: 'Numbered List', content: '<svg viewBox="0 0 16 16"><path fill-rule="evenodd" d="M1.224 11.85H.5v-1h.624a.56.56 0 0 1 .56.56v.38a.56.56 0 0 1-.56.56H.5v-1h.624a.56.56 0 0 1 .56.56v.38a.56.56 0 0 1-.56.56H.5v-1h.724v.216c.196.256.45.42.7.534.25.114.5.17.75.17.65 0 1.155-.33 1.405-.984C3.48 11.43 3.45 10.65 3.2 10.15c-.25-.5-.65-.85-1.1-.85-.45 0-.8.13-1.05.39-.25.26-.35.6-.35 1.05v.216h1.668v-1.14H.5v1.14h.624a.56.56 0 0 1 .56.56v.38a.56.56 0 0 1-.56.56H.5v-1h.624a.56.56 0 0 1 .56.56v.38a.56.56 0 0 1-.56.56zM5 11.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zM1.65 5.85c.55 0 .95.33 1.15.9.2.55.17 1.2-.05 1.65-.22.45-.6.7-1.1.7-.55 0-.95-.33-1.15-.9C.42 7.65.45 6.9.65 6.4c.22-.45.6-.7 1-.7z"/></svg>' }
        ];

        buttons.forEach(({ command, title, content }) => {
            const btn = document.createElement('button');
            btn.className = 'qn-toolbar-btn';
            btn.title = title;
            btn.innerHTML = content;
            btn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                document.execCommand(command, false, null);
            });
            toolbar.appendChild(btn);
        });

        const checklistBtn = document.createElement('button');
        checklistBtn.className = 'qn-toolbar-btn';
        checklistBtn.title = 'Add Checklist Item';
        checklistBtn.innerHTML = `<svg viewBox="0 0 16 16"><path d="M14 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h12zM2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H2z"/><path d="M10.97 4.97a.75.75 0 0 1 1.071 1.05l-3.992 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.235.235 0 0 1 .02-.022z"/></svg>`;
        checklistBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            editor.focus();
            document.execCommand('insertHTML', false, '<div class="qn-checklist-item" data-checked="false" contenteditable="true">&#8203;</div>');
        });
        toolbar.appendChild(checklistBtn);
        
        const colorPicker = createColorPicker();
        toolbar.appendChild(colorPicker);

        return toolbar;
    }

    function createColorPicker() {
        const colors = ['default', 'yellow', 'blue', 'green', 'pink'];
        const pickerContainer = document.createElement('div');
        pickerContainer.className = 'qn-color-picker';
        const mainBtn = document.createElement('div');
        mainBtn.className = 'qn-color-swatch';
        pickerContainer.appendChild(mainBtn);
        const dropdown = document.createElement('div');
        dropdown.className = 'qn-color-dropdown';
        colors.forEach(color => {
            const swatch = document.createElement('div');
            swatch.className = 'qn-color-swatch';
            swatch.dataset.color = color;
            dropdown.appendChild(swatch);
        });
        pickerContainer.appendChild(dropdown);
        return pickerContainer;
    }

    function attachEventListeners(noteId, ui) {
        const debouncedCacheUpdate = debounce(() => {
            const newTitle = ui.titleInput.value;
            const newContent = ui.editor.innerHTML;
            ui.headerTitle.textContent = newTitle || 'Quick Note';
            sendMessage({ action: "updateNoteContent", noteId, data: { title: newTitle, content: newContent } });
        }, 500);

        ui.titleInput.addEventListener('input', debouncedCacheUpdate);
        ui.editor.addEventListener('input', debouncedCacheUpdate);
        ui.editor.addEventListener('paste', () => setTimeout(() => {
            linkifyNode(ui.editor);
            debouncedCacheUpdate();
        }, 50));

        ui.editor.addEventListener('click', (e) => {
            if (e.target.classList.contains('qn-checklist-item')) {
                 const isChecked = e.target.getAttribute('data-checked') === 'true';
                 e.target.setAttribute('data-checked', !isChecked);
                 debouncedCacheUpdate();
            }
        });
        
        ui.pinButton.addEventListener('click', () => sendMessage({ action: 'togglePin', noteId }));
        ui.minimizeButton.addEventListener('click', () => sendMessage({ action: 'toggleMinimize', noteId }));
        ui.saveButton.addEventListener('click', () => sendMessage({ action: 'saveNote', noteId }));
        
        ui.closeButton.addEventListener('click', () => {
            ui.host.remove();
            allNotes.delete(noteId);
            sendMessage({ action: 'closeNote', noteId });
        });
        
        ui.colorPicker.addEventListener('mousedown', (e) => {
             const color = e.target.dataset.color;
             if(color) sendMessage({ action: 'changeNoteColor', noteId, color });
        });

        makeDraggable(ui.container, ui.header, noteId);
        makeResizable(ui.container, ui.resizeHandle, noteId);
    }
    
    function debounce(func, delay) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    }

    function linkifyNode(node) {
        const urlRegex = /https?:\/\/[^\s<>"']+/g;
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        const nodesToProcess = [];
        let textNode;
        while (textNode = walker.nextNode()) {
            if (textNode.parentNode.tagName !== 'A' && urlRegex.test(textNode.nodeValue)) {
                nodesToProcess.push(textNode);
            }
        }
        nodesToProcess.forEach(textNode => {
            const fragment = document.createDocumentFragment();
            let lastIndex = 0;
            textNode.nodeValue.replace(urlRegex, (match, offset) => {
                const textBefore = textNode.nodeValue.substring(lastIndex, offset);
                if (textBefore) fragment.appendChild(document.createTextNode(textBefore));
                const link = document.createElement('a');
                link.href = match;
                link.textContent = match;
                fragment.appendChild(link);
                lastIndex = offset + match.length;
            });
            const textAfter = textNode.nodeValue.substring(lastIndex);
            if (textAfter) fragment.appendChild(document.createTextNode(textAfter));
            if (fragment.hasChildNodes()) textNode.parentNode.replaceChild(fragment, textNode);
        });
    }

    function makeDraggable(element, handle, noteId) {
        handle.onmousedown = (e) => {
            if (e.target.closest('button')) return;
            e.preventDefault();
            let pos3 = e.clientX, pos4 = e.clientY;
            document.onmousemove = (e) => {
                let pos1 = pos3 - e.clientX, pos2 = pos4 - e.clientY;
                pos3 = e.clientX; pos4 = e.clientY;
                element.style.top = `${element.offsetTop - pos2}px`;
                element.style.left = `${element.offsetLeft - pos1}px`;
            };
            document.onmouseup = () => {
                document.onmouseup = document.onmousemove = null;
                sendMessage({ action: "updateNotePosition", noteId, data: { top: element.offsetTop, left: element.offsetLeft } });
            };
        };
    }

    function makeResizable(element, handle, noteId) {
        handle.onmousedown = (e) => {
            e.preventDefault(); e.stopPropagation();
            let initialW = element.offsetWidth, initialH = element.offsetHeight;
            let initialX = e.clientX, initialY = e.clientY;
            document.onmousemove = (e) => {
                const newW = initialW + (e.clientX - initialX);
                const newH = initialH + (e.clientY - initialY);
                element.style.width = `${Math.max(300, newW)}px`;
                element.style.height = `${Math.max(250, newH)}px`;
            };
            document.onmouseup = () => {
                document.onmouseup = document.onmousemove = null;
                sendMessage({ action: "updateNotePosition", noteId, data: { width: element.offsetWidth, height: element.offsetHeight } });
            };
        };
    }
})();

