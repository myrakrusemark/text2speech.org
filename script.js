import { requestOpenAITTS } from './openai-tts.js';
import { requestNabuCasaTTS, populateNabuCasaVoiceSelect } from './nabu-casa-tts.js';
import { requestKokoroTTS, populateKokoroVoiceSelect } from './kokoro-tts.js';
import { openDatabase, storeDataInIndexedDB, getDataFromIndexedDB, deleteDataFromIndexedDB } from './database.js';
import { storeAudioChunk, combineGeneratedAudio } from './audioChunks.js';
import { saveCredentials, loadCredentials, saveAppSettings, loadAppSettings } from './utils.js';
import { StreamingPlayer } from './streaming-player.js';

var text = "";
var chunks = [];
var filename = "";
let processedChunks = 0;
let completedChunks = 0;
let totalChunks = 0;
let canceled = false;
let openaiApiKey = ""
let nabuCasaServer = "";
let nabuCasaBearer = "";
let activeTTSTab = "kokoro"
let wakeLock = null;


const chunkSize = 2048;

const processingBar = document.getElementById('processing');
const completedBar = document.getElementById('completed');
const cancelButton = document.getElementById('cancel-button')

// Bottom player bar: streams audio live during conversion, then serves as
// the player for the finished file.
const playerBar = document.getElementById('player-bar');
const playerToggle = document.getElementById('player-toggle');
const playerSeek = document.getElementById('player-seek');
const playerTime = document.getElementById('player-time');
const playerTitle = document.getElementById('player-title');
const playerDownload = document.getElementById('player-download');
const player = new StreamingPlayer(updatePlayerUI);

let pendingFilename = '';   // filename (no extension) of the conversion in progress
let finalFilename = '';     // full filename of the finished file
let finalUrl = null;        // object URL of the finished file
let seeking = false;        // true while the user drags the seek slider

function updatePlayerUI(p) {
    document.getElementById('player-play-icon').classList.toggle('hidden', p.playing);
    document.getElementById('player-pause-icon').classList.toggle('hidden', !p.playing);
    playerToggle.setAttribute('aria-label', p.playing ? 'Pause' : 'Play');
}

function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Keep the seek bar and clock in sync with playback (and with the growing
// stream while conversion is running).
setInterval(() => {
    if (playerBar.getAttribute('aria-hidden') === 'true' || seeking) return;
    const duration = player.totalDuration;
    const position = player.getPosition();
    playerSeek.value = duration ? (position / duration) * 100 : 0;
    playerSeek.setAttribute('aria-valuetext', formatTime(position));
    playerTime.textContent =
        `${formatTime(position)} / ${formatTime(duration)}${player.complete ? '' : '+'}`;
}, 250);

playerToggle.addEventListener('click', () => {
    if (player.playing) {
        player.pause();
    } else {
        player.play();
    }
});

playerSeek.addEventListener('input', () => { seeking = true; });
playerSeek.addEventListener('change', () => {
    player.seek((playerSeek.value / 100) * player.totalDuration);
    seeking = false;
});

playerDownload.addEventListener('click', triggerDownload);
document.getElementById('player-close').addEventListener('click', () => {
    hidePlayerBar();
    document.getElementById('convert-button').focus();
});

function showPlayerBar() {
    playerBar.classList.remove('translate-y-full');
    playerBar.setAttribute('aria-hidden', 'false');
}

function hidePlayerBar() {
    player.pause();
    playerBar.classList.add('translate-y-full');
    playerBar.setAttribute('aria-hidden', 'true');
    playerDownload.classList.add('hidden');
}

let playerAnnounced = false;

function enqueueSegment(blob) {
    if (playerBar.getAttribute('aria-hidden') === 'true' && !playerAnnounced) {
        playerAnnounced = true;
        announce('Audio is ready to preview in the player at the bottom of the page. Press P to play or pause.');
    }
    showPlayerBar();
    player.enqueue(blob).catch(err => console.warn('Preview decode failed:', err));
}

function triggerDownload() {
    if (!finalUrl) return;
    const link = document.createElement('a');
    link.href = finalUrl;
    link.download = finalFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Main-section button states: Convert (idle/converting) vs Download +
// Convert another (done).
function setDoneState() {
    document.getElementById('convert-button').classList.add('hidden');
    document.getElementById('download-button').classList.remove('hidden');
    document.getElementById('convert-another-button').classList.remove('hidden');
    document.getElementById('download-button').focus();
}

function setIdleState() {
    document.getElementById('convert-button').classList.remove('hidden');
    document.getElementById('download-button').classList.add('hidden');
    document.getElementById('convert-another-button').classList.add('hidden');
}

function finalizeOutput(blob, ext) {
    if (finalUrl) URL.revokeObjectURL(finalUrl);
    finalFilename = pendingFilename + ext;
    finalUrl = URL.createObjectURL(blob);
    playerTitle.textContent = finalFilename;
    playerDownload.classList.remove('hidden');
    showPlayerBar();
    setDoneState();
    announce(`Conversion complete. ${finalFilename}, ${formatTime(player.totalDuration)} of audio. Download button is focused.`);
}

document.getElementById('download-button').addEventListener('click', triggerDownload);
document.getElementById('convert-another-button').addEventListener('click', async () => {
    await clearSession();
    const ta = document.getElementById('text-input');
    ta.focus();
    ta.select();
});

// Polite screen-reader announcement (visually hidden live region)
function announce(message) {
    const el = document.getElementById('sr-announcer');
    el.textContent = '';
    // Re-set on the next tick so identical messages are re-announced
    setTimeout(() => { el.textContent = message; }, 50);
}

function showError(message) {
    const el = document.getElementById('form-error');
    el.textContent = message;
    el.classList.remove('hidden');
}

function clearError() {
    const el = document.getElementById('form-error');
    el.textContent = '';
    el.classList.add('hidden');
}

// IndexedDB setup
let db;

async function initializeStoredData() {
    console.log("initializing stored data")
    db = await openDatabase();
    const requiredItems = ['text', 'fileName', 'totalChunks', 'fileId'];
    const allItemsPresent = (await Promise.all(requiredItems.map(async item => await getDataFromIndexedDB(item) !== null))).every(Boolean);
    
    [openaiApiKey, nabuCasaServer, nabuCasaBearer] = await loadCredentials();

    activeTTSTab = await loadAppSettings();

    // Show/hide tab content based on active tab
    document.querySelectorAll('.tab-content').forEach(content => {
        if (content.id === activeTTSTab) {
            console.log("showing tab: "+activeTTSTab)
            content.classList.remove('hidden');
            content.classList.add('fade-in');
        } else {
            content.classList.add('hidden');
            content.classList.remove('fade-in');
        }
    });

    // Update tab button states
    document.querySelectorAll('#tts-engine-tabs .tab-button').forEach(button => {
        const isActive = button.getAttribute('data-tab') === activeTTSTab;
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        button.setAttribute('tabindex', isActive ? '0' : '-1');
        if (isActive) {
            button.classList.add('active', 'bg-blue-600', 'text-white');
            button.classList.remove('text-gray-700', 'dark:text-gray-300', 'hover:bg-gray-200', 'dark:hover:bg-gray-600');
        } else {
            button.classList.remove('active', 'bg-blue-600', 'text-white');
            button.classList.add('text-gray-700', 'dark:text-gray-300', 'hover:bg-gray-200', 'dark:hover:bg-gray-600');
        }
    });

    //populateNabuCasaVoiceSelect(
    //    document.getElementById('nabu-casa-server').value, 
    //    document.getElementById('nabu-casa-bearer').value, 
    //    "cloud");

    // Populate Kokoro voice select
    const kokoroVoiceSelectElement = document.getElementById('kokoro-voice-select');
    populateKokoroVoiceSelect(kokoroVoiceSelectElement);
    

    if (allItemsPresent) {
        text = await getDataFromIndexedDB('text');
        chunks = splitTextIntoChunks(text);
        filename = await getDataFromIndexedDB('fileName');
        completedChunks = parseInt(await getDataFromIndexedDB('completedChunks')) || 0;
        totalChunks = parseInt(await getDataFromIndexedDB('totalChunks'));
        processedChunks = completedChunks;

        // Set the necessary variables from IndexedDB
        document.getElementById('text-input').value = text;
        updateConversionStatus(completedChunks, totalChunks);
        updateProgressBar(processingBar, (processedChunks / totalChunks) * 100);
        updateProgressBar(completedBar, (completedChunks / totalChunks) * 100);

        // Only offer to continue if the conversion was not completed
        if (completedChunks < totalChunks) {
            showResumePrompt(completedChunks, totalChunks);
        } else {
            // If conversion was completed, clear the session
            clearSession();
        }
    } else {
        clearSession();
    }
}

//Add event listeners
// Save credentials and app settings when UI changes
document.getElementById('openai-api-key').addEventListener('input', saveCredentialsHandler);
document.getElementById('nabu-casa-server').addEventListener('input', saveCredentialsHandler);
document.getElementById('nabu-casa-bearer').addEventListener('input', saveCredentialsHandler);
document.getElementById('openai-voice-select').addEventListener('change', saveAppSettingsHandler);
document.getElementById('nabu-casa-voice-select').addEventListener('change', saveAppSettingsHandler);
document.getElementById('kokoro-voice-select').addEventListener('change', saveAppSettingsHandler);
document.getElementById('hd-audio').addEventListener('change', saveAppSettingsHandler);
document.getElementById('convert-button').addEventListener('click', convertTextToSpeech);

// Keyboard shortcut: Ctrl+Enter (or Cmd+Enter) converts from the textarea
document.getElementById('text-input').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        convertTextToSpeech();
    }
});

// Global shortcut: P toggles the player (when not typing in a form field)
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if ((e.key === 'p' || e.key === 'P') && playerBar.getAttribute('aria-hidden') === 'false') {
        e.preventDefault();
        if (player.playing) {
            player.pause();
        } else {
            player.play();
        }
    }
});

// WAI-ARIA tabs pattern: arrow keys move between engine tabs
document.getElementById('tts-engine-tabs').addEventListener('keydown', (e) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const tabs = Array.from(document.querySelectorAll('#tts-engine-tabs .tab-button'));
    const current = tabs.indexOf(document.activeElement);
    if (current === -1) return;
    e.preventDefault();
    let next;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else next = (current + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    tabs[next].click();
});

// Resume-prompt buttons
function showResumePrompt(done, total) {
    document.getElementById('resume-message').textContent =
        `An unfinished conversion was found (${done} of ${total} parts done). Resume it?`;
    document.getElementById('resume-prompt').classList.remove('hidden');
    document.getElementById('resume-btn').focus();
}

function hideResumePrompt() {
    document.getElementById('resume-prompt').classList.add('hidden');
}

document.getElementById('resume-btn').addEventListener('click', () => {
    hideResumePrompt();
    convertTextToSpeech();
});

document.getElementById('discard-btn').addEventListener('click', () => {
    hideResumePrompt();
    clearSession();
});

// Tab changes
document.querySelectorAll('#tts-engine-tabs .tab-button').forEach(tab => {
    tab.addEventListener('click', async function() {
        // Update UI first
        const tabId = this.getAttribute('data-tab');
        
        // Update tab button states
        document.querySelectorAll('#tts-engine-tabs .tab-button').forEach(button => {
            const isActive = button.getAttribute('data-tab') === tabId;
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
            button.setAttribute('tabindex', isActive ? '0' : '-1');
            if (isActive) {
                button.classList.add('active', 'bg-blue-600', 'text-white');
                button.classList.remove('text-gray-700', 'dark:text-gray-300', 'hover:bg-gray-200', 'dark:hover:bg-gray-600');
            } else {
                button.classList.remove('active', 'bg-blue-600', 'text-white');
                button.classList.add('text-gray-700', 'dark:text-gray-300', 'hover:bg-gray-200', 'dark:hover:bg-gray-600');
            }
        });

        // Update tab content visibility
        document.querySelectorAll('.tab-content').forEach(content => {
            if (content.id === tabId) {
                content.classList.remove('hidden');
                content.classList.add('fade-in');
            } else {
                content.classList.add('hidden');
                content.classList.remove('fade-in');
            }
        });
        
        // Then save settings
        await saveAppSettingsHandler();
    });
});

async function saveAppSettingsHandler(){
    activeTTSTab = await saveAppSettings(text);
    console.log("new tts: "+activeTTSTab)
}

function saveCredentialsHandler(){
    console.log("saving credentials")
    saveCredentials(
        document.getElementById('openai-api-key').value, 
        document.getElementById('nabu-casa-server').value, 
        document.getElementById('nabu-casa-bearer').value);
}

// Call initializeStoredData when the window loads
window.addEventListener('load', initializeStoredData);

// Cancel button
function handleCancelButtonClick() {
    if (confirm('Are you sure you want to cancel the conversion?')) {
        canceled = true;
        clearSession();
    }
}

// Listen to file upload
document.getElementById('file-input').addEventListener('change', async function(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.type && file.type !== 'text/plain') {
        alert('Please upload a valid text file (.txt)');
        return;
    }
    text = await readFile(file);
    filename = file.name.replace(/\.[^.]+$/, '');
    document.getElementById('text-input').value = text;
    document.getElementById('empty-state').style.display = 'none';
    chunks = splitTextIntoChunks(text);
    totalChunks = chunks.length;
    updateConversionStatus(completedChunks, totalChunks);
});

// Listen to text paste
document.getElementById('text-input').addEventListener('input', async function() {
    text = this.value;
    filename = "pasted-text";
    chunks = splitTextIntoChunks(text);
    totalChunks = chunks.length;
    // Only update the progress numbers, not the label
    document.getElementById('conversion-status').textContent = `${completedChunks}/${totalChunks} (0%)`;
});

async function convertTextToSpeech() {
    // The textarea is the source of truth: programmatic updates (Paste button,
    // file upload) don't fire 'input' events, so re-read it here.
    text = document.getElementById('text-input').value;
    if (!filename) filename = "pasted-text";

    clearError();

    if (activeTTSTab == "openai" && !openaiApiKey) {
        showError('Please enter your OpenAI API key (in Settings).');
        return;
    }

    if (activeTTSTab == "nabu-casa" && !nabuCasaServer) {
        showError('Please enter your Nabu Casa server address (in Settings).');
        return;
    }

    if (activeTTSTab == "nabu-casa" && !nabuCasaBearer) {
        showError('Please enter your Nabu Casa bearer token (in Settings).');
        return;
    }

    if (!text.trim()) {
        showError('Please provide input text.');
        return;
    }

    canceled = false;
    cancelButton.addEventListener('click', handleCancelButtonClick);
    cancelButton.style.display = 'block';

    // Fresh player stream; unlocking here (inside the click) satisfies the
    // browser's autoplay policy for later playback.
    player.reset();
    player.unlock();
    hidePlayerBar();
    playerAnnounced = false;
    pendingFilename = filename === "pasted-text" ? createSafeFilename(text) : filename;
    playerTitle.textContent = pendingFilename;

    // Update label to Converting... when conversion starts
    document.getElementById('conversion-label').textContent = 'Converting...';

    await storeDataInIndexedDB('text', text)
    await storeDataInIndexedDB('fileName', filename);

    await requestWakeLock();
    try {
        await processText(text, processingBar, completedBar);
    } finally {
        releaseWakeLock();
        cancelButton.removeEventListener('click', handleCancelButtonClick);
        cancelButton.style.display = 'none';
    }

    console.log('All text processed.');
}

async function processText(text, processingBar, completedBar) {
    // Get or create fileId from IndexedDB
    let fileId = await getDataFromIndexedDB('fileId');
    if (!fileId) {
        fileId = Date.now().toString();
        await storeDataInIndexedDB('fileId', fileId);
    }
    
    chunks = splitTextIntoChunks(text);
    await storeDataInIndexedDB('totalChunks', chunks.length);

    completedChunks = parseInt(await getDataFromIndexedDB('completedChunks')) || 0;
    processedChunks = completedChunks;

    //activeTTSTab = document.querySelector('#tts-engine-tabs .tab-button.active').getAttribute('data-tab');

    for (var [index, chunk] of chunks.slice(completedChunks).entries()) {

        if (canceled) {
            canceled = false;
            return;
        }else{
            //Home Assistant asyncio.CancelledError issue causes caching/processing issue where, if a request is canceled, a request with the same text cannot be processed again (until cache is cleared).
            //HA audio files are named with a hash of the content. Add a non-spoken character to the chunk so the hash will be different, and the continuation is successful.
            if (activeTTSTab == "nabu-casa" && index == 0 && completedChunks > 0){
                console.log("Continuing with Nabu Case!")
                chunk = chunk + " "
            }

            // Update progress before processing the chunk
            if(!canceled){
                processedChunks++;
            }
            updateConversionStatus(completedChunks, chunks.length);

            updateProgressBar(processingBar, (processedChunks / chunks.length) * 100);
            processingBar.classList.remove('processing-lightgreen');

            let audioBlob;
            console.log("Current TTS: "+activeTTSTab)
            switch (activeTTSTab) {
                case 'openai':
                audioBlob = await requestOpenAITTS(
                    openaiApiKey,
                    chunk,
                    document.getElementById('openai-voice-select').value,
                    document.getElementById('hd-audio').checked);
                if (audioBlob) enqueueSegment(audioBlob);
                break;
                case 'nabu-casa':
                const [language, voice] = document.getElementById('nabu-casa-voice-select').value.split(" ");

                audioBlob = await requestNabuCasaTTS(
                    chunk,
                    document.getElementById('nabu-casa-server').value,
                    document.getElementById('nabu-casa-bearer').value,
                    language,
                    voice);
                if (audioBlob) enqueueSegment(audioBlob);
                break;
                case 'kokoro':
                    // Kokoro streams sentence-sized segments into the preview.
                    // Advance the green bar per segment: green means "this
                    // audio is synthesized and listenable".
                    const chunkBase = completedChunks;
                    audioBlob = await requestKokoroTTS(
                        chunk,
                        document.getElementById('kokoro-voice-select').value,
                        (blob, segIndex, segTotal) => {
                            enqueueSegment(blob);
                            const fraction = (chunkBase + (segIndex + 1) / segTotal) / chunks.length;
                            updateProgressBar(completedBar, fraction * 100);
                        });
                    break;

            }

            if (!canceled && audioBlob) {
                await storeAudioChunk(storeDataInIndexedDB, audioBlob, completedChunks, fileId);
                console.log(`Stored chunk ${completedChunks + 1}/${chunks.length} of size: ${audioBlob.size}`);

                //if (!canceled) {
                completedChunks++;
                await storeDataInIndexedDB('completedChunks', completedChunks.toString());

                // Update progress after processing the chunk
                updateConversionStatus(completedChunks, chunks.length);
                updateProgressBar(completedBar, (completedChunks / chunks.length) * 100);
                //}
            } else {
                console.error(`Failed to synthesize chunk ${completedChunks + index + 1}/${chunks.length}.`);
                document.getElementById('conversion-label').textContent = 'Error — conversion failed';
                updateProgressBar(processingBar, 0);
                updateProgressBar(completedBar, 0);
                return null;
            }
        }  
    }

    if (chunks.length > 0) {
        player.markComplete();

        const combinedAudioBlob = await combineGeneratedAudio(fileId);
        if (combinedAudioBlob) {
            // Get the extension from the active tab button's data-extension attribute
            const activeTabButton = document.querySelector('#tts-engine-tabs .tab-button.active');
            const ext = activeTabButton.getAttribute('data-extension');
            finalizeOutput(combinedAudioBlob, ext);
        } else {
            console.error(`Failed to combine audio chunks for ${filename}`);
        }

        return completedChunks;
    }
}

function updateConversionStatus(processed, total) {
    const percentage = total ? Math.round((processed / total) * 100) : 0;
    const statusText = `${processed}/${total} (${percentage}%)`;
    document.getElementById('conversion-status').textContent = statusText;
    
    // Update the conversion label based on state
    const conversionLabel = document.getElementById('conversion-label');
    if (total === 0) {
        conversionLabel.textContent = 'Ready';
    } else if (processed < total) {
        conversionLabel.textContent = 'Converting...';
    } else {
        conversionLabel.textContent = 'Done';
    }
}

// Function to update progress bar safely
function updateProgressBar(bar, value) {
    const pct = isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
    bar.style.width = `${pct}%`;
    const track = bar.parentElement;
    if (track && track.getAttribute('role') === 'progressbar') {
        track.setAttribute('aria-valuenow', Math.round(pct));
    }
}

function readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            resolve(reader.result);
        };
        reader.onerror = () => {
            console.error(`Error reading file: ${file.name}`, reader.error);
            reject(reader.error);
        };
        reader.readAsText(file);
    });
}

function splitTextIntoChunks(text) {
    const paragraphs = text.replace(/\r\n/g, '\n').split('\n\n');
    const chunks = [];
    let currentChunk = '';

    paragraphs.forEach(paragraph => {
        if ((currentChunk + paragraph).length <= chunkSize) {
            currentChunk += paragraph + '\n\n';
        } else {
            if (currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
            }

            let subChunks = splitByDelimiter(paragraph, '\n', chunkSize);
            subChunks.forEach(subChunk => {
                if (subChunk.length <= chunkSize) {
                    if (subChunk.trim().length > 0) {
                        chunks.push(subChunk.trim());
                    }
                } else {
                    let periodChunks = splitByDelimiter(subChunk, '.', chunkSize);
                    periodChunks.forEach(periodChunk => {
                        if (periodChunk.length <= chunkSize) {
                            if (periodChunk.trim().length > 0) {
                                chunks.push(periodChunk.trim());
                            }
                        } else {
                            let spaceChunks = splitByDelimiter(periodChunk, ' ', chunkSize);
                            spaceChunks.forEach(spaceChunk => {
                                if (spaceChunk.length <= chunkSize) {
                                    if (spaceChunk.trim().length > 0) {
                                        chunks.push(spaceChunk.trim());
                                    }
                                } else {
                                    console.error('Chunk too large even after all splitting attempts:', spaceChunk);
                                }
                            });
                        }
                    });
                }
            });
        }
    });

    if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}

function splitByDelimiter(text, delimiter) {
    const parts = text.split(delimiter);
    const subChunks = [];
    let currentPart = '';

    parts.forEach(part => {
        if ((currentPart + delimiter + part).length <= chunkSize) {
            currentPart += delimiter + part;
        } else {
            if (currentPart) {
                subChunks.push(currentPart.trim());
                currentPart = part;
            } else {
                subChunks.push(part.trim());
                currentPart = '';
            }
        }
    });

    if (currentPart) {
        subChunks.push(currentPart.trim());
    }

    return subChunks;
}

function createSafeFilename(text) {
    // Remove any non-alphanumeric characters and spaces, convert to lowercase
    const safeText = text.replace(/[^a-zA-Z0-9\s]/g, '').toLowerCase();
    // Take first 15 characters; fall back if empty or all special characters
    return safeText.substring(0, 15).trim() || 'text';
}

async function clearSession() {
    try {
        const transaction = db.transaction(['sessionData'], 'readwrite');
        const store = transaction.objectStore('sessionData');
        const keys = await new Promise((resolve, reject) => {
            const request = store.getAllKeys();
            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(event.target.errorCode);
        });

        await Promise.all(keys.map(key => deleteDataFromIndexedDB(key)));

        processedChunks = 0;
        completedChunks = 0;
        chunks = [];

        // Reset progress bars and status
        document.getElementById('conversion-status').textContent = '0/0 (0%)';
        document.getElementById('conversion-label').textContent = 'Ready';
        updateProgressBar(processingBar, 0);
        updateProgressBar(completedBar, 0);
        processingBar.classList.remove('processing-lightgreen');

        // Reset player, output buttons, and prompts
        player.reset();
        hidePlayerBar();
        playerAnnounced = false;
        setIdleState();
        if (finalUrl) {
            URL.revokeObjectURL(finalUrl);
            finalUrl = null;
        }
        hideResumePrompt();
        clearError();

        releaseWakeLock();

        cancelButton.style.display = 'none';

        console.log('Session cleared.');
    } catch (error) {
        console.error('Error clearing session:', error);
    }
}

async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
        } catch (err) {
            console.error(`${err.name}, ${err.message}`);
        }
    } else {
        console.warn('Wake Lock API not supported');
    }
}

function releaseWakeLock() {
    if (wakeLock !== null) {
        wakeLock.release()
            .then(() => {
                wakeLock = null;
            });
    }
}
