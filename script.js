import { requestKokoroTTS, populateKokoroVoiceSelect } from './kokoro-tts.js';
import { openDatabase, storeDataInIndexedDB, getDataFromIndexedDB, deleteDataFromIndexedDB } from './database.js';
import { storeAudioChunk, combineGeneratedAudio } from './audioChunks.js';
import { setCookie, getCookie } from './utils.js';
import { StreamingPlayer } from './streaming-player.js';

var text = "";
var chunks = [];
var filename = "";
let processedChunks = 0;
let completedChunks = 0;
let totalChunks = 0;
let canceled = false;
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

    // Populate Kokoro voice select (restores the saved voice from its cookie)
    populateKokoroVoiceSelect(document.getElementById('kokoro-voice-select'));

    // Restore the bookmarklet auto-convert preference (default: on)
    const autoConvert = document.getElementById('auto-convert');
    autoConvert.checked = getCookie('bookmarklet-auto-convert') !== 'false';

    // Text shared via the bookmarklet (#text=... fragment) takes precedence
    // over any stored session: fill the textarea and, if enabled, convert
    // immediately.
    const sharedText = consumeSharedText();
    if (sharedText) {
        await clearSession();
        const ta = document.getElementById('text-input');
        ta.value = sharedText;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        if (autoConvert.checked) {
            convertTextToSpeech();
        }
        return;
    }

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
// Persist the chosen voice
document.getElementById('kokoro-voice-select').addEventListener('change', (e) => {
    setCookie('kokoro-voice-select', e.target.value);
});
document.getElementById('auto-convert').addEventListener('change', (e) => {
    setCookie('bookmarklet-auto-convert', e.target.checked);
});
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

// Read and clear text handed over in the URL fragment by the bookmarklet.
// The fragment is replaced immediately so reloads don't re-trigger the
// conversion (and the possibly huge URL doesn't stick around).
function consumeSharedText() {
    if (!location.hash.startsWith('#text=')) return null;
    let shared = null;
    try {
        shared = decodeURIComponent(location.hash.slice(6));
    } catch (e) {
        console.error('Could not decode shared text:', e);
    }
    history.replaceState(null, '', location.pathname + location.search);
    return shared && shared.trim() ? shared : null;
}

// Call initializeStoredData when the window loads
window.addEventListener('load', initializeStoredData);

// A #text= fragment landing in an already-open tab (no document load)
// still needs handling — reload so the normal startup path picks it up.
window.addEventListener('hashchange', () => {
    if (location.hash.startsWith('#text=')) location.reload();
});

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

    for (var [index, chunk] of chunks.slice(completedChunks).entries()) {

        if (canceled) {
            canceled = false;
            return;
        }else{
            // Update progress before processing the chunk
            if(!canceled){
                processedChunks++;
            }
            updateConversionStatus(completedChunks, chunks.length);

            updateProgressBar(processingBar, (processedChunks / chunks.length) * 100);

            // Kokoro streams sentence-sized segments into the player.
            // Advance the green bar per segment: green means "this audio
            // is synthesized and listenable".
            const chunkBase = completedChunks;
            const audioBlob = await requestKokoroTTS(
                chunk,
                document.getElementById('kokoro-voice-select').value,
                (blob, segIndex, segTotal) => {
                    enqueueSegment(blob);
                    const fraction = (chunkBase + (segIndex + 1) / segTotal) / chunks.length;
                    updateProgressBar(completedBar, fraction * 100);
                });

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
            finalizeOutput(combinedAudioBlob, '.wav');
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
