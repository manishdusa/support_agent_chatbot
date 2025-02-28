document.addEventListener('DOMContentLoaded', () => {
    // DOM elements with error handling for missing elements
    const userInput = document.getElementById('user-input') || createErrorElement('Missing #user-input element');
    const sendBtn = document.getElementById('send-btn') || createErrorElement('Missing #send-btn element');
    const chatBox = document.getElementById('chat-box') || createErrorElement('Missing #chat-box element');
    
    // State management
    let isProcessing = false;
    let messageHistory = [];
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000;
    
    // Initialize UI
    initializeUI();
    
    function initializeUI() {
        // Event listeners with error handling
        if (sendBtn && userInput) {
            sendBtn.addEventListener('click', handleSend);
            
            userInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                }
            });
            
            // Add input validation and character counter
            userInput.addEventListener('input', () => {
                const charCount = userInput.value.length;
                const maxLength = 500;
                
                // Update character counter if it exists
                const counter = document.getElementById('char-counter');
                if (counter) {
                    counter.textContent = `${charCount}/${maxLength}`;
                    counter.classList.toggle('text-danger', charCount > maxLength);
                }
                
                // Enable/disable send button based on input
                if (sendBtn) {
                    sendBtn.disabled = charCount === 0 || charCount > maxLength || isProcessing;
                }
            });
            
            // Focus the input field on load
            userInput.focus();
        }
        
        // Add welcome message
        addMessage("Welcome! I can answer questions about Segment, mParticle, Lytics, and Zeotap CDP platforms. What would you like to know?", 'bot');
    }

    async function handleSend() {
        if (isProcessing) return;
        
        const question = userInput.value.trim();
        if (!question) {
            showError('Please enter a question');
            return;
        }
        
        if (question.length > 500) {
            showError('Your question is too long. Please limit to 500 characters.');
            return;
        }
        
        // Set processing state
        isProcessing = true;
        userInput.disabled = true;
        sendBtn.disabled = true;
        
        try {
            // Save question to history
            messageHistory.push({ role: 'user', content: question });
            
            // Clear input
            userInput.value = '';
            
            // Add user message to chat
            addMessage(question, 'user');
            
            // Add loading indicator
            const loadingId = addLoading();
            
            // Get bot response with retry mechanism
            let response = null;
            let retries = 0;
            
            while (retries < MAX_RETRIES && !response) {
                try {
                    response = await fetchBotResponse(question);
                } catch (error) {
                    console.warn(`Fetch attempt ${retries + 1} failed:`, error);
                    retries++;
                    
                    if (retries >= MAX_RETRIES) {
                        throw error;
                    }
                    
                    // Wait before retrying
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * retries));
                }
            }
            
            // Remove loading indicator
            removeLoading(loadingId);
            
            // Process and display the response
            if (response && response.answer) {
                const formattedResponse = formatBotResponse(response.answer);
                addMessage(formattedResponse, 'bot');
                
                // Save response to history
                messageHistory.push({ role: 'assistant', content: response.answer });
                
                // Show metadata if available
                if (response.platform && response.section) {
                    addMetadata(`Source: ${response.platform.charAt(0).toUpperCase() + response.platform.slice(1)} Documentation (${response.section})`);
                }
            } else {
                throw new Error('Invalid response format');
            }
        } catch (error) {
            console.error('Error processing request:', error);
            removeAllLoading();
            
            if (error.name === 'AbortError') {
                showError('Request timed out. Please try again.');
            } else if (error.message.includes('NetworkError') || error.message.includes('Failed to fetch')) {
                showError('Network error. Please check your connection and try again.');
            } else {
                showError('Sorry, there was an error processing your request. Please try again.');
            }
        } finally {
            // Reset UI state
            isProcessing = false;
            userInput.disabled = false;
            sendBtn.disabled = false;
            userInput.focus();
        }
    }
    
    async function fetchBotResponse(question) {
        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30-second timeout
        
        try {
            const response = await fetch('http://127.0.0.1:5000/ask', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ question }),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Server error (${response.status}): ${errorText}`);
            }
            
            return await response.json();
        } finally {
            clearTimeout(timeoutId);
        }
    }
    
    function formatBotResponse(rawText) {
        if (!rawText) return '';
        
        // Convert markdown/plaintext to HTML
        let formatted = rawText
            // Sanitize to prevent XSS
            .replace(/</g, '&lt;').replace(/>/g, '&gt;')
            
            // Format code blocks
            .replace(/```([^`]+)```/g, '<pre class="docs-code-block">$1</pre>')
            .replace(/`([^`]+)`/g, '<code class="docs-code">$1</code>')
            
            // Format section headers
            .replace(/---\s*([A-Z][A-Za-z0-9 _]+)\s*---/g, '<h3 class="docs-section-header">$1</h3>')
            .replace(/\n([A-Z][A-Za-z0-9 _]+:)/g, '<h4 class="docs-subsection-header">$1</h4>')
            
            // Numbered steps (preserving existing formatting or creating new)
            .replace(/(\d+)\.\s+([^\n]+)/g, '<div class="docs-step"><span class="step-number">$1.</span> $2</div>')
            
            // Warnings/notes
            .replace(/Note:\s*([^\n]+)/g, '<div class="docs-note"><span class="note-icon">ℹ️</span> $1</div>')
            .replace(/Warning:\s*([^\n]+)/g, '<div class="docs-warning"><span class="warning-icon">⚠️</span> $1</div>')
            
            // Links (handle both markdown and plain links)
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
            .replace(/(https?:\/\/\S+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
            
            // Paragraphs (preserve existing or create new)
            .replace(/\n\n/g, '</p><p>');
        
        // Wrap in paragraph tags if not already done
        if (!formatted.startsWith('<p>')) {
            formatted = '<p>' + formatted + '</p>';
        }
        
        return formatted;
    }
    
    function addMessage(content, sender) {
        if (!chatBox) return;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}-message`;
        
        // Add sender icon/avatar
        const iconDiv = document.createElement('div');
        iconDiv.className = 'message-icon';
        iconDiv.innerHTML = sender === 'user' ? '<i class="fas fa-user"></i>' : '<i class="fas fa-robot"></i>';
        messageDiv.appendChild(iconDiv);
        
        // Add message content
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        if (sender === 'bot') {
            contentDiv.innerHTML = content;
        } else {
            // Escape HTML in user content to prevent XSS
            const safeContent = document.createElement('div');
            safeContent.textContent = content;
            contentDiv.innerHTML = `<p>${safeContent.innerHTML}</p>`;
        }
        
        messageDiv.appendChild(contentDiv);
        
        // Add timestamp
        const timestamp = document.createElement('div');
        timestamp.className = 'message-timestamp';
        timestamp.textContent = formatTimestamp(new Date());
        messageDiv.appendChild(timestamp);
        
        // Add to chat and scroll
        chatBox.appendChild(messageDiv);
        scrollToBottom();
        
        // Add animation class
        setTimeout(() => messageDiv.classList.add('visible'), 10);
    }
    
    function addMetadata(text) {
        if (!chatBox) return;
        
        const metaDiv = document.createElement('div');
        metaDiv.className = 'message-metadata';
        metaDiv.textContent = text;
        
        // Find the last bot message
        const messages = chatBox.querySelectorAll('.bot-message');
        if (messages.length > 0) {
            const lastBotMessage = messages[messages.length - 1];
            lastBotMessage.appendChild(metaDiv);
        }
    }
    
    function addLoading() {
        if (!chatBox) return null;
        
        const loaderId = `loader-${Date.now()}`;
        const loaderDiv = document.createElement('div');
        loaderDiv.id = loaderId;
        loaderDiv.className = 'message bot-message loading';
        
        // Create dot animation container
        const dotsContainer = document.createElement('div');
        dotsContainer.className = 'loading-dots';
        dotsContainer.innerHTML = `
            <div class="loading-text">Searching documentation</div>
            <div class="dots">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
            </div>
        `;
        
        loaderDiv.appendChild(dotsContainer);
        chatBox.appendChild(loaderDiv);
        scrollToBottom();
        
        return loaderId;
    }
    
    function removeLoading(loaderId) {
        if (!loaderId) return;
        
        const loader = document.getElementById(loaderId);
        if (loader) {
            loader.classList.add('fade-out');
            setTimeout(() => {
                if (loader.parentNode) {
                    loader.parentNode.removeChild(loader);
                }
            }, 300);
        }
    }
    
    function removeAllLoading() {
        const loaders = document.querySelectorAll('.loading');
        loaders.forEach(loader => {
            loader.classList.add('fade-out');
            setTimeout(() => {
                if (loader.parentNode) {
                    loader.parentNode.removeChild(loader);
                }
            }, 300);
        });
    }
    
    function showError(message) {
        if (!chatBox) return;
        
        const errorDiv = document.createElement('div');
        errorDiv.className = 'message system-message error';
        errorDiv.innerHTML = `<div class="error-icon">⚠️</div><div class="error-text">${message}</div>`;
        
        chatBox.appendChild(errorDiv);
        scrollToBottom();
        
        // Auto-remove after delay
        setTimeout(() => {
            errorDiv.classList.add('fade-out');
            setTimeout(() => {
                if (errorDiv.parentNode) {
                    errorDiv.parentNode.removeChild(errorDiv);
                }
            }, 300);
        }, 5000);
    }
    
    function scrollToBottom() {
        if (chatBox) {
            chatBox.scrollTo({
                top: chatBox.scrollHeight,
                behavior: 'smooth'
            });
        }
    }
    function formatDocumentationResponse(rawText, platform, section) {
        if (!rawText) return '';
        
        // Extract the main content and clean it up
        let cleanedText = rawText
            .replace(/^\d+\.\s+/gm, '') // Remove numbering from the beginning of lines
            .replace(/\s{2,}/g, ' ')    // Remove extra spaces
            .trim();
        
        // Create a structured response object
        const responseObj = {
            platform: platform.charAt(0).toUpperCase() + platform.slice(1),
            section: section.charAt(0).toUpperCase() + section.slice(1),
            title: extractTitle(cleanedText),
            summary: generateSummary(cleanedText),
            keyPoints: extractKeyPoints(cleanedText),
            codeExamples: extractCodeExamples(cleanedText),
            relatedContent: extractRelatedContent(cleanedText)
        };
        
        // Generate the formatted HTML response
        return generateFormattedHTML(responseObj);
    }
    
    function extractTitle(text) {
        // Try to find a title (usually at the beginning, often with # or similar)
        const titleMatch = text.match(/^(?:# )?(.*?)(?:\n|$)/);
        return titleMatch ? titleMatch[1].trim() : 'Documentation Overview';
    }
    
    function generateSummary(text) {
        // Extract first paragraph or create a summary
        const firstPara = text.split(/\n\n/)[0];
        return firstPara.length > 300 ? firstPara.substring(0, 300) + '...' : firstPara;
    }
    
    function extractKeyPoints(text) {
        const keyPoints = [];
        
        // Look for list items, section headers, or important statements
        const lines = text.split('\n');
        
        lines.forEach(line => {
            line = line.trim();
            
            // Check for list items
            if (line.match(/^[-*•]\s+/) || line.match(/^\d+\.\s+/)) {
                keyPoints.push(line.replace(/^[-*•]\d+\.\s+/, ''));
            }
            // Check for section headers (all caps or ## style)
            else if (line.match(/^##\s+/) || line === line.toUpperCase() && line.length > 10) {
                keyPoints.push(line.replace(/^##\s+/, ''));
            }
            // Check for lines with words like "important", "note", etc.
            else if (line.match(/\b(important|note|key|remember|crucial)\b/i) && line.length < 150) {
                keyPoints.push(line);
            }
        });
        
        // Limit to most relevant points
        return keyPoints.slice(0, 5);
    }
    
    function extractCodeExamples(text) {
        const codeExamples = [];
        
        // Extract code blocks (```code``` or indented blocks)
        const codeBlockRegex = /```(?:\w+)?\n([\s\S]+?)\n```|`([^`]+)`/g;
        let match;
        
        while ((match = codeBlockRegex.exec(text)) !== null) {
            const code = match[1] || match[2];
            if (code && code.trim()) {
                codeExamples.push(code.trim());
            }
        }
        
        return codeExamples;
    }
    
    function extractRelatedContent(text) {
        const relatedContent = [];
        
        // Look for "Related content", "See also", etc.
        const lines = text.split('\n');
        let inRelatedSection = false;
        
        lines.forEach(line => {
            if (line.match(/related\s+content|see\s+also/i)) {
                inRelatedSection = true;
            } else if (inRelatedSection && line.trim()) {
                // Check if it looks like a link or title
                if (!line.match(/^\s*#/) && line.length < 100) {
                    relatedContent.push(line.trim());
                }
            } else if (inRelatedSection && !line.trim()) {
                inRelatedSection = false;
            }
        });
        
        return relatedContent;
    }
    
    function generateFormattedHTML(responseObj) {
        let html = `
            <div class="docs-response">
                <div class="docs-header">
                    <h2>${responseObj.title}</h2>
                    <div class="docs-source">Source: ${responseObj.platform} Documentation (${responseObj.section})</div>
                </div>
                
                <div class="docs-summary">
                    <h3>Summary</h3>
                    <p>${responseObj.summary}</p>
                </div>`;
        
        if (responseObj.keyPoints.length > 0) {
            html += `
                <div class="docs-key-points">
                    <h3>Key Points</h3>
                    <ul>
                        ${responseObj.keyPoints.map(point => `<li>${point}</li>`).join('')}
                    </ul>
                </div>`;
        }
        
        if (responseObj.codeExamples.length > 0) {
            html += `
                <div class="docs-code-examples">
                    <h3>Code Examples</h3>
                    ${responseObj.codeExamples.map(code => `<pre class="docs-code-block">${code}</pre>`).join('')}
                </div>`;
        }
        
        if (responseObj.relatedContent.length > 0) {
            html += `
                <div class="docs-related">
                    <h3>Related Content</h3>
                    <ul>
                        ${responseObj.relatedContent.map(item => `<li>${item}</li>`).join('')}
                    </ul>
                </div>`;
        }
        
        html += '</div>';
        return html;
    }
    
    function formatTimestamp(date) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    function createErrorElement(message) {
        console.error(message);
        const errorDiv = document.createElement('div');
        errorDiv.className = 'critical-error';
        errorDiv.textContent = message;
        document.body.appendChild(errorDiv);
        return null;
    }
    
    // Public methods for external access
    window.CDPDocChat = {
        clearChat: function() {
            if (chatBox) {
                // Keep only welcome message
                while (chatBox.children.length > 1) {
                    chatBox.removeChild(chatBox.lastChild);
                }
                messageHistory = [];
            }
        },
        
        downloadChat: function() {
            if (messageHistory.length === 0) {
                showError('No conversation to download');
                return;
            }
            
            const chatText = messageHistory.map(msg => 
                `${msg.role === 'user' ? 'You' : 'Assistant'}: ${msg.content}`
            ).join('\n\n');
            
            const blob = new Blob([chatText], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `cdp-chat-${new Date().toISOString().slice(0, 10)}.txt`;
            a.click();
            
            URL.revokeObjectURL(url);
        }
    };
});