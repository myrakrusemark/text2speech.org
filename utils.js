function setCookie(name, value, days = 365) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + expires + '; path=/';
}

export function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return decodeURIComponent(parts.pop().split(';').shift());
}

// Save API keys and bearer tokens
export async function saveCredentials(openaiApiKey, nabuCasaServer, nabuCasaBearer) {
    setCookie('openai-api-key', openaiApiKey);
    setCookie('nabu-casa-server', nabuCasaServer);
    setCookie('nabu-casa-bearer', nabuCasaBearer);
}

// Load saved credentials
export async function loadCredentials() {
    const openaiApiKey = getCookie('openai-api-key');
    const nabuCasaServer = getCookie('nabu-casa-server');
    const nabuCasaBearer = getCookie('nabu-casa-bearer');
    if (openaiApiKey) document.getElementById('openai-api-key').value = openaiApiKey;
    if (nabuCasaServer) document.getElementById('nabu-casa-server').value = nabuCasaServer;
    if (nabuCasaBearer) document.getElementById('nabu-casa-bearer').value = nabuCasaBearer;
    console.log(openaiApiKey)
    return [openaiApiKey, nabuCasaServer, nabuCasaBearer];
}

// Function to save app settings
export async function saveAppSettings(text) {
    const activeTTSTab = document.querySelector('#tts-engine-tabs .tab-button.active').getAttribute('data-tab');
    setCookie('active-tts-engine', activeTTSTab);
    console.log("TTS engine switched to: " + activeTTSTab);
    
    setCookie('openai-voice', document.getElementById('openai-voice-select').value);
    setCookie('hd-audio', document.getElementById('hd-audio').checked);
    setCookie('piper-voice-select', document.getElementById('piper-voice-select').value);
    setCookie('nabu-casa-voice-select', document.getElementById('nabu-casa-voice-select').value);
    
    return activeTTSTab;
}

export async function loadAppSettings() {
    // Load app settings
    const activeTTSTab = setActiveTTSTabOnInit();
    
    document.getElementById('openai-voice-select').value = getCookie('openai-voice') || document.getElementById('openai-voice-select').value;
    document.getElementById('hd-audio').checked = getCookie('hd-audio') === 'true';

    // See piper-tts.js. The cookie updates the select as it loads.
    //document.getElementById('piper-voice-select').value = getCookie('piper-voice-select') || "en_US-joe-medium";

    // See nabu-casa-tts.js. The cookie updates the select as it loads.
    //document.getElementById('nabu-casa-voice-select').value = getCookie('nabu-casa-voice-select');


    return [activeTTSTab, document.getElementById('piper-voice-select').value];
}

// Function to set the active tab when loading app settings
function setActiveTTSTabOnInit() {
    const tabs = document.querySelectorAll('#tts-engine-tabs .tab-button');
    const activeTTSTab = getCookie('active-tts-engine') || 'piper';

    tabs.forEach(tab => {
        if (tab.getAttribute('data-tab') === activeTTSTab) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });

    return activeTTSTab

}

/*export function displayEstimatedCost(text, clear = false) {
    const costPerMilChar = 0.015;

    if (clear) {
        document.getElementById('estimated-cost').textContent = "";
    } else {
        const charCount = text.length;
        const cost = (charCount / 1000) * costPerMilChar;
        const formattedCost = cost.toFixed(2);
        document.getElementById('estimated-cost').textContent = `($${formattedCost})`;
    }
}*/
