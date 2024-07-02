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
    setCookie('openai_api_key', openaiApiKey);
    setCookie('nabu_casa_server', nabuCasaServer);
    setCookie('nabu_casa_bearer', nabuCasaBearer);
}

// Load saved credentials
export async function loadCredentials() {
    const openaiApiKey = getCookie('openai_api_key');
    const nabuCasaServer = getCookie('nabu_casa_server');
    const nabuCasaBearer = getCookie('nabu_casa_bearer');
    if (openaiApiKey) document.getElementById('openai-api-key').value = openaiApiKey;
    if (nabuCasaServer) document.getElementById('nabu-casa-server').value = nabuCasaServer;
    if (nabuCasaBearer) document.getElementById('nabu-casa-bearer').value = nabuCasaBearer;
    console.log(openaiApiKey)
    return [openaiApiKey, nabuCasaServer, nabuCasaBearer];
}

// Function to save app settings
export async function saveAppSettings(text) {
    let activeTTSTab = document.querySelector('#tts-engine-tabs .tab-button.active').getAttribute('data-tab');
    
    await new Promise((resolve) => {
        setTimeout(() => {
            activeTTSTab = document.querySelector('#tts-engine-tabs .tab-button.active').getAttribute('data-tab');
            setCookie('active_tts_engine', activeTTSTab);
            displayEstimatedCost(text, activeTTSTab !== "openai");
            console.log("TTS engine switched to: " + activeTTSTab);
            resolve();
        }, 50);
    });
    
    setCookie('openai_voice', document.getElementById('openai-voice-select').value);
    setCookie('hd_audio', document.getElementById('hd-audio').checked);
    setCookie('piper-voice-select', document.getElementById('piper-voice-select').value);
    setCookie('nabu-casa-voice-select', document.getElementById('nabu-casa-voice-select').value);
    
    return activeTTSTab;
}

export async function loadAppSettings() {
    // Load app settings
    const activeTTSTab = setActiveTTSTabOnInit();
    
    document.getElementById('openai-voice-select').value = getCookie('openai_voice') || document.getElementById('openai-voice-select').value;
    document.getElementById('hd-audio').checked = getCookie('hd_audio') === 'true';

    // See piper-tts.js. The cookie updates the select as it loads.
    //document.getElementById('piper-voice-select').value = getCookie('piper-voice-select') || "en_US-joe-medium";

    // See nabu-casa-tts.js. The cookie updates the select as it loads.
    //document.getElementById('nabu-casa-voice-select').value = getCookie('nabu-casa-voice-select');


    return [activeTTSTab, document.getElementById('piper-voice-select').value];
}

// Function to set the active tab when loading app settings
function setActiveTTSTabOnInit() {
    const tabs = document.querySelectorAll('#tts-engine-tabs .tab-button');
    const activeTTSTab = getCookie('active_tts_engine') || 'piper';

    tabs.forEach(tab => {
        if (tab.getAttribute('data-tab') === activeTTSTab) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });

    return activeTTSTab

}

export function displayEstimatedCost(text, clear = false) {
    const costPerMilChar = 0.015;

    if (clear) {
        document.getElementById('estimated-cost').textContent = "";
    } else {
        const charCount = text.length;
        const cost = (charCount / 1000) * costPerMilChar;
        const formattedCost = cost.toFixed(2);
        document.getElementById('estimated-cost').textContent = `($${formattedCost})`;
    }
}

