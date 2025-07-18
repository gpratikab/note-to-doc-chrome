// offscreen.js

chrome.runtime.onMessage.addListener((request) => {
  if (request.target === 'offscreen' && request.action === 'parseHtml') {
    const result = parseHtmlToGoogleDocs(request.html);
    chrome.runtime.sendMessage({ action: 'parseComplete', data: result, target: 'background' });
  }
});

function parseHtmlToGoogleDocs(html) {
    const cleanHtml = html.replace(/&nbsp;/g, ' ').replace(/<div><br><\/div>/g, '<p><br></p>');
    const doc = new DOMParser().parseFromString(`<body>${cleanHtml}</body>`, 'text/html');
    let plainText = '';
    const requests = [];

    function walk(node, styles = {}) {
        if (node.nodeType === 3) { // Text Node
            const startIndex = plainText.length;
            plainText += node.textContent;
            const endIndex = plainText.length;
            if (Object.keys(styles).length > 0 && startIndex < endIndex) {
                requests.push({
                    updateTextStyle: { range: { startIndex, endIndex }, textStyle: styles, fields: Object.keys(styles).join(',') }
                });
            }
        } else if (node.nodeType === 1) { // Element Node
            const tagName = node.tagName.toUpperCase();
            
            // Handle Checklist Items
            if (tagName === 'DIV' && node.classList.contains('qn-checklist-item')) {
                const isChecked = node.getAttribute('data-checked') === 'true';
                const prefix = isChecked ? '[x] ' : '[ ] ';
                const startIndex = plainText.length;
                plainText += prefix + node.textContent.trim() + '\n';
                const endIndex = plainText.length;
                 // FIX: Correctly structure the textStyle request for setting a font family.
                 requests.push({
                    updateTextStyle: {
                        range: { startIndex, endIndex },
                        textStyle: {
                            weightedFontFamily: {
                                fontFamily: 'Roboto Mono' // Use a monospaced font for alignment
                            }
                        },
                        fields: 'weightedFontFamily'
                    }
                });
                return; // Stop further processing of this node
            }
            
            const newStyles = { ...styles };
            if (['B', 'STRONG'].includes(tagName)) newStyles.bold = true;
            if (['I', 'EM'].includes(tagName)) newStyles.italic = true;
            if (['U'].includes(tagName)) newStyles.underline = true;
            
            if (tagName === 'A' && node.href) {
                newStyles.link = { url: node.href };
                newStyles.foregroundColor = { color: { rgbColor: { red: 0.066, green: 0.337, blue: 0.831 } } };
                if (styles.underline !== false) newStyles.underline = true;
            }
            
            const isBlock = ['P', 'H1', 'H2', 'H3', 'LI', 'DIV'].includes(tagName);

            if (isBlock) {
                if (plainText.length > 0 && !plainText.endsWith('\n')) {
                    plainText += '\n';
                }
                const pStartIndex = plainText.length;
                node.childNodes.forEach(child => walk(child, newStyles));
                const pEndIndex = plainText.length;

                if (tagName === 'LI' && pStartIndex < pEndIndex) {
                    requests.push({
                        createParagraphBullets: {
                            range: { startIndex: pStartIndex, endIndex: pEndIndex },
                            bulletPreset: node.parentNode.tagName.toUpperCase() === 'OL' ? 'NUMBERED_DECIMAL_ALPHA_ROMAN' : 'BULLET_DISC_CIRCLE_SQUARE'
                        }
                    });
                }
            } else {
                node.childNodes.forEach(child => walk(child, newStyles));
            }
        }
    }
    
    doc.body.childNodes.forEach(node => walk(node));
    return { plainText: plainText.trim(), requests };
}

