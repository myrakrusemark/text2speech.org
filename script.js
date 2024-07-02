import { requestOpenAITTS } from './openai-tts.js';
import { requestNabuCasaTTS, populateNabuCasaVoiceSelect } from './nabu-casa-tts.js';
import { requestPiperTTS } from './piper-tts.js';
import { openDatabase, storeDataInIndexedDB, getDataFromIndexedDB, deleteDataFromIndexedDB } from './database.js';
import { storeAudioChunk, combineGeneratedAudio } from './audioChunks.js';
import { saveCredentials, loadCredentials, saveAppSettings, loadAppSettings, displayEstimatedCost } from './utils.js';

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
    db = await openDatabase();
    const requiredItems = ['text', 'fileName', 'totalChunks'];
    const allItemsPresent = (await Promise.all(requiredItems.map(async item => await getDataFromIndexedDB(item) !== null))).every(Boolean);
    
    [openaiApiKey, nabuCasaServer, nabuCasaBearer] = await loadCredentials();

    [activeTTSTab, piperVoiceSelect] = await loadAppSettings();

    populateNabuCasaVoiceSelect(
        document.getElementById('nabu-casa-server').value, 
        document.getElementById('nabu-casa-bearer').value, 
        "cloud");

    if (allItemsPresent) {
        continued = true;

        text = await getDataFromIndexedDB('text');

        displayEstimatedCost(text, activeTTSTab !== "openai");
        
        chunks = splitTextIntoChunks(text);

        filename = await getDataFromIndexedDB('fileName');
        completedChunks = parseInt(await getDataFromIndexedDB('completedChunks'));
        totalChunks = parseInt(await getDataFromIndexedDB('totalChunks'));
        processedChunks = completedChunks;

        // Set the necessary variables from IndexedDB
        document.getElementById('text-input').value = text;
        document.getElementById('file-name').textContent = filename;
        document.getElementById('results').innerHTML = '';
        updateConversionStatus(processedChunks, totalChunks);
        updateProgressBar(processingBar, (processedChunks / totalChunks) * 100);
        updateProgressBar(completedBar, (completedChunks / totalChunks) * 100);

        // Continue the conversion process
        convertTextToSpeech();

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
        await saveAppSettingsHandler();
    });
});

async function saveAppSettingsHandler(){
    activeTTSTab = await saveAppSettings(text);
    console.log("new tts: "+activeTTSTab)
}

function saveCredentialsHandler(){
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
    displayEstimatedCost(text, activeTTSTab !== "openai");
    
});

// Listen to text paste
document.getElementById('text-input').addEventListener('input', async function() {
    text = this.value;
    filename = "pasted-text";
    document.getElementById('file-name').textContent = 'Pasted Text';
    chunks = splitTextIntoChunks(text);
    totalChunks = chunks.length;
    updateConversionStatus(completedChunks, totalChunks);
    displayEstimatedCost(text, activeTTSTab !== "openai");
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
        //clearSession();
        return;
    }

    if (hasDownloadableFiles) {
        if (confirm('You have a converted file available for download. If you press okay, it will be erased.')) {
            hasDownloadableFiles = false;

            clearSession();  

        }else{
            return;
        }
    }

    await storeDataInIndexedDB('text', text)
    await storeDataInIndexedDB('fileName', filename);
    await processText(text, processingBar, completedBar, resultsDiv);

    //HUH?
    await requestWakeLock();

    cancelButton.removeEventListener('click', handleCancelButtonClick);
    cancelButton.style.display = 'none';

    console.log('All text processed.');
}

async function processText(text, processingBar, completedBar, resultsDiv) {

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
            updateConversionStatus(processedChunks, chunks.length);

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
                await storeAudioChunk(storeDataInIndexedDB, audioBlob, completedChunks);
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
        const combinedAudioBlob = await combineGeneratedAudio();
        if (combinedAudioBlob) {
            console.log(`Creating download link for ${filename}`);

            let ext = '.mp3'
            if(activeTTSTab == 'piper'){
                ext = '.wav'
            }
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
}

// Function to update progress bar safely
function updateProgressBar(bar, value) {
    if (isFinite(value)) {
        bar.value = value;
    } else {
        bar.value = 0;
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

// Replace the existing createDownloadLink function with this one
function createDownloadLink(blob, ext) {
    const fullFilename = filename + ext;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fullFilename;
    link.textContent = fullFilename;
    console.log(`Download link created for ${fullFilename}`);

    hasDownloadableFiles = true;

    const listItem = document.createElement('li');
    listItem.appendChild(link);
    return listItem;
}

async function clearSession() {
    try {
        //canceled = true;

        // Get all keys from the sessionData object store
        const transaction = db.transaction(['sessionData'], 'readwrite');
        const store = transaction.objectStore('sessionData');
        const getAllKeysRequest = store.getAllKeys();

        getAllKeysRequest.onsuccess = async () => {
            const keys = getAllKeysRequest.result;

            // Delete all keys
            const deletePromises = keys.map(key => deleteDataFromIndexedDB(key));
            await Promise.all(deletePromises);

            // Reset variables, excluding the blob-related ones
            processedChunks = 0;
            completedChunks = 0;
            chunks = [];

            document.getElementById('estimated-cost').textContent = '';
            document.getElementById('results').textContent = '';


            // Reset progress bars and status
            console.log("setting status to 0")
            updateConversionStatus(0, 0);
            updateProgressBar(processingBar, 0);
            updateProgressBar(completedBar, 0);
            processingBar.classList.remove('processing-lightgreen');

            // Release wake lock
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

