// offscreen.js

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request) => {
  if (request.target === 'offscreen' && request.action === 'parseHtml') {
    const result = parseHtmlToGoogleDocs(request.html);
    // Send the result back to the background script
    chrome.runtime.sendMessage({ action: 'parseComplete', data: result });
  }
});

// This function correctly parses HTML from the content-editable div
// into a flat text string and an array of Google Docs API requests.
function parseHtmlToGoogleDocs(html) {
    // Sanitize HTML for more reliable parsing
    const cleanHtml = html.replace(/&nbsp;/g, ' ').replace(/<div>/g, '<p>').replace(/<\/div>/g, '</p>');
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

            const newStyles = { ...styles };
            if (['B', 'STRONG'].includes(tagName)) newStyles.bold = true;
            if (['I', 'EM'].includes(tagName)) newStyles.italic = true;
            if (['U'].includes(tagName)) newStyles.underline = true;
            
            const isParagraph = ['P', 'H1', 'H2', 'H3', 'LI'].includes(tagName);

            if (isParagraph) {
                // Ensure each paragraph starts on a new line.
                if (plainText.length > 0 && !plainText.endsWith('\n')) {
                    plainText += '\n';
                }
                const paragraphStartIndex = plainText.length;

                // Process children with the new styles
                node.childNodes.forEach(child => walk(child, newStyles));

                const paragraphEndIndex = plainText.length;

                // Apply list formatting if the paragraph is a list item and not empty
                if (tagName === 'LI' && paragraphStartIndex < paragraphEndIndex) {
                    const parentTag = node.parentNode.tagName.toUpperCase();
                    requests.push({
                        createParagraphBullets: {
                            range: { startIndex: paragraphStartIndex, endIndex: paragraphEndIndex },
                            bulletPreset: parentTag === 'OL' ? 'NUMBERED_DECIMAL_ALPHA_ROMAN' : 'BULLET_DISC_CIRCLE_SQUARE'
                        }
                    });
                }
            } else { // For non-paragraph elements like UL, OL, or inline tags
                node.childNodes.forEach(child => walk(child, newStyles));
            }
        }
    }
    
    doc.body.childNodes.forEach(node => walk(node));
    
    // The final plain text should not end with multiple newlines.
    // Google Docs adds its own spacing.
    return { plainText: plainText.trim(), requests };
}

