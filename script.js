import { requestOpenAITTS } from './openai-tts.js';
import { requestNabuCasaTTS, populateNabuCasaVoiceSelect } from './nabu-casa-tts.js';
import { requestPiperTTS } from './piper-tts.js';
import { openDatabase, storeDataInIndexedDB, getDataFromIndexedDB, deleteDataFromIndexedDB } from './database.js';
import { storeAudioChunk, combineGeneratedAudio } from './audioChunks.js';
import { saveCredentials, loadCredentials, saveAppSettings, loadAppSettings } from './utils.js';

var text = "";
var chunks = [];
var filename = "";
let processedChunks = 0;
let completedChunks = 0;
let totalChunks = 0;
let canceled = false;
let continued = false;
let hasDownloadableFiles = false;
let openaiApiKey = ""
let nabuCasaServer = "";
let nabuCasaBearer = "";
let activeTTSTab = "piper"
let piperVoiceSelect = ""
let wakeLock = null;


const chunkSize = 2048;

const processingBar = document.getElementById('processing');
const completedBar = document.getElementById('completed');
const cancelButton = document.getElementById('cancel-button')

// IndexedDB setup
let db;

async function initializeStoredData() {
    console.log("initializing stored data")
    db = await openDatabase();
    const requiredItems = ['text', 'fileName', 'totalChunks', 'fileId'];
    const allItemsPresent = (await Promise.all(requiredItems.map(async item => await getDataFromIndexedDB(item) !== null))).every(Boolean);
    
    [openaiApiKey, nabuCasaServer, nabuCasaBearer] = await loadCredentials();

    // Add a small delay to ensure cookie is ready
    await new Promise(resolve => setTimeout(resolve, 1000));

    [activeTTSTab, piperVoiceSelect] = await loadAppSettings();

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
        if (button.getAttribute('data-tab') === activeTTSTab) {
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

    if (allItemsPresent) {
        text = await getDataFromIndexedDB('text');
        chunks = splitTextIntoChunks(text);
        filename = await getDataFromIndexedDB('fileName');
        completedChunks = parseInt(await getDataFromIndexedDB('completedChunks')) || 0;
        totalChunks = parseInt(await getDataFromIndexedDB('totalChunks'));
        processedChunks = completedChunks;

        // Set the necessary variables from IndexedDB
        document.getElementById('text-input').value = text;
        document.getElementById('results').innerHTML = '';
        updateConversionStatus(completedChunks, totalChunks);
        updateProgressBar(processingBar, (processedChunks / totalChunks) * 100);
        updateProgressBar(completedBar, (completedChunks / totalChunks) * 100);

        // Only continue if the conversion was not completed
        if (completedChunks < totalChunks) {
            console.log("Continuing conversion from chunk", completedChunks, "of", totalChunks);
            // Continue the conversion process
            convertTextToSpeech();
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
document.getElementById('hd-audio').addEventListener('change', saveAppSettingsHandler);
document.getElementById('piper-voice-select').addEventListener('change', saveAppSettingsHandler);
document.getElementById('convert-button').addEventListener('click', convertTextToSpeech);

// Tab changes
document.querySelectorAll('#tts-engine-tabs .tab-button').forEach(tab => {
    tab.addEventListener('click', async function() {
        // Update UI first
        const tabId = this.getAttribute('data-tab');
        
        // Update tab button states
        document.querySelectorAll('#tts-engine-tabs .tab-button').forEach(button => {
            if (button.getAttribute('data-tab') === tabId) {
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
        clearSession();
        canceled = true;
    }
}

// Listen to file upload
document.getElementById('file-input').addEventListener('change', async function(event) {
    const file = event.target.files[0];
    text = await readFile(file);
    filename = file.name;
    document.getElementById('file-name').textContent = filename;
    chunks = splitTextIntoChunks(text);
    totalChunks = chunks.length;
    updateConversionStatus(completedChunks, totalChunks);
    //displayEstimatedCost(text, activeTTSTab !== "openai");
    
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
    const selectedVoice = document.getElementById('openai-voice-select').value;
    const hdAudio = document.getElementById('hd-audio').checked;
    const resultsDiv = document.getElementById('results');  

    cancelButton.addEventListener('click', handleCancelButtonClick);
    cancelButton.style.display = 'block';
    
    canceled = false;

    if (activeTTSTab == "openai" && !openaiApiKey) {
        alert('Please enter your OpenAI API key.');
        return;
    }

    if (activeTTSTab == "nabu-casa" && !nabuCasaServer) {
        alert('Please enter Nabu Casa server address.');
        return;
    }

    if (activeTTSTab == "nabu-casa" && !nabuCasaBearer) {
        alert('Please enter Nabu Casa bearer token.');
        return;
    }
        
    if (!text) {
        alert('Please provide input text.');
        return;
    }

    if (hasDownloadableFiles) {
        if (confirm('You have a converted file available for download. If you press okay, it will be erased.')) {
            hasDownloadableFiles = false;
            clearSession();  
        } else {
            return;
        }
    }

    // Update label to Converting... when conversion starts
    document.getElementById('conversion-label').textContent = 'Converting...';

    await storeDataInIndexedDB('text', text)
    await storeDataInIndexedDB('fileName', filename);
    await processText(text, processingBar, completedBar, resultsDiv);

    await requestWakeLock();

    cancelButton.removeEventListener('click', handleCancelButtonClick);
    cancelButton.style.display = 'none';

    console.log('All text processed.');
}

async function processText(text, processingBar, completedBar, resultsDiv) {
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
                break;
                case 'nabu-casa':
                const [language, voice] = document.getElementById('nabu-casa-voice-select').value.split(" ");

                audioBlob = await requestNabuCasaTTS(
                    chunk, 
                    document.getElementById('nabu-casa-server').value,
                    document.getElementById('nabu-casa-bearer').value, 
                    language,
                    voice);
                break;
                case 'piper':
                audioBlob = await requestPiperTTS(
                    chunk, 
                    document.getElementById('piper-voice-select').value);
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
                updateProgressBar(processingBar, 0);
                updateProgressBar(completedBar, 0);
                return null;
            }
        }  
    }

    if (chunks.length > 0) {
        const combinedAudioBlob = await combineGeneratedAudio(fileId);
        if (combinedAudioBlob) {
            console.log(`Creating download link for ${filename}`);

            // Get the extension from the active tab button's data-extension attribute
            const activeTabButton = document.querySelector('#tts-engine-tabs .tab-button.active');
            const ext = activeTabButton.getAttribute('data-extension');
            const downloadLink = createDownloadLink(combinedAudioBlob, ext);

            resultsDiv.appendChild(downloadLink);
        } else {
            console.error(`Failed to combine audio chunks for ${filename}`);
        }

        releaseWakeLock();

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
    if (isFinite(value)) {
        bar.style.width = `${value}%`;
    } else {
        bar.style.width = '0%';
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
    const paragraphs = text.split('\n\n');
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
    // Take first 15 characters
    let baseFilename = safeText.substring(0, 15).trim();
    
    // If text was empty or all special characters, use a default
    if (!baseFilename) {
        baseFilename = 'text';
    }
    
    // Check if this filename already exists
    const existingFiles = document.querySelectorAll('#results span');
    let counter = 1;
    let finalFilename = baseFilename;
    
    while (Array.from(existingFiles).some(span => span.textContent === finalFilename + '.mp3' || span.textContent === finalFilename + '.wav')) {
        finalFilename = `${baseFilename}-${counter}`;
        counter++;
    }
    
    return finalFilename;
}

function createDownloadLink(blob, ext) {
    // Use the original filename if it's from a file upload, otherwise create a safe filename
    const fullFilename = filename === "pasted-text" ? createSafeFilename(text) + ext : filename + ext;
    const url = URL.createObjectURL(blob);
    
    const template = `
        <div class="p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700">
            <div class="flex items-center space-x-3">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd" />
                </svg>
                <span class="text-sm text-gray-700 dark:text-gray-300">${fullFilename}</span>
            </div>
            <div class="flex items-center space-x-3">
                <button class="download-btn px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                    Download
                </button>
                <button class="delete-btn p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                </button>
            </div>
        </div>
    `;
    
    const container = document.createElement('div');
    container.innerHTML = template;
    
    // Add event listeners
    container.querySelector('.download-btn').addEventListener('click', () => {
        const link = document.createElement('a');
        link.href = url;
        link.download = fullFilename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
    
    container.querySelector('.delete-btn').addEventListener('click', () => {
        container.remove();
        URL.revokeObjectURL(url);
        hasDownloadableFiles = false;
    });
    
    hasDownloadableFiles = true;
    return container;
}

async function clearSession() {
    try {
        const transaction = db.transaction(['sessionData'], 'readwrite');
        const store = transaction.objectStore('sessionData');
        const getAllKeysRequest = store.getAllKeys();

        getAllKeysRequest.onsuccess = async () => {
            const keys = getAllKeysRequest.result;

            const deletePromises = keys.map(key => deleteDataFromIndexedDB(key));
            await Promise.all(deletePromises);

            // Also clear the fileId
            await deleteDataFromIndexedDB('fileId');

            processedChunks = 0;
            completedChunks = 0;
            chunks = [];

            document.getElementById('results').textContent = '';

            // Reset progress bars and status
            console.log("setting status to 0")
            document.getElementById('conversion-status').textContent = '0/0 (0%)';
            document.getElementById('conversion-label').textContent = 'Ready';
            updateProgressBar(processingBar, 0);
            updateProgressBar(completedBar, 0);
            processingBar.classList.remove('processing-lightgreen');

            if (wakeLock !== null) {
                await releaseWakeLock();
            }

            cancelButton.style.display = 'none';

            console.log('Session cleared.');
        };

        getAllKeysRequest.onerror = (event) => {
            console.error('Error getting keys from IndexedDB:', event.target.errorCode);
        };

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
