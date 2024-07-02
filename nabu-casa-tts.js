import { getCookie } from './utils.js';

export async function requestNabuCasaTTS(chunk, server, bearer, selectedLang, selectedVoice) {
    const url = `${server}/api/tts_get_url`;
    const headers = {
        "Authorization": `Bearer ${bearer}`,
        "Content-Type": "application/json"
    };
    const data = {
        "platform": "cloud",
        "message": chunk,
        "cache": false,
        "language": selectedLang,
        "options": {
            "voice": selectedVoice
        }
    };
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(data)
        });
        if (response.ok) {
            const jsonResponse = await response.json();
            const audioUrl = jsonResponse.url;
            const audioResponse = await fetch(audioUrl);
            return await audioResponse.blob();
        } else {
            console.error(`Error: ${response.status}, ${response.statusText}`);
            return null;
        }
    } catch (error) {
        if (error.name === 'TypeError') {
            const errorMessage = `Network error occurred. Refreshing usually fixes this issue.\n\nError details: ${error.message}\n\nDo you want to refresh the page?`;
            if (window.confirm(errorMessage)) {
                window.location.reload();
            } else {
                console.warn('Refresh cancelled by user.');
            }
            return null;
        } else {
            console.error('Error in requestNabuCasaTTS:', error);
            return null;
        }
    }
}

async function getVoicesForEngine(server, bearer, engineId, language) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(server+"/api/websocket");

        ws.onopen = function open() {
            // Authenticate with Home Assistant
            ws.send(JSON.stringify({ type: "auth", access_token: bearer }));
        };

        ws.onmessage = function incoming(event) {
            const message = JSON.parse(event.data);

            // Handle authentication response
            if (message.type === "auth_ok") {
                // Send the command to list voices
                ws.send(JSON.stringify({
                    id: 1,
                    type: "tts/engine/voices",
                    engine_id: engineId,
                    language: language
                }));
            }

            // Handle the response to list voices
            if (message.id === 1) {
                if (message.result) {
                    resolve(message.result.voices);
                    ws.close();
                } else if (message.error) {
                    reject(`Error: ${message.error.message}`);
                    ws.close();
                }
            }
        };

        ws.onerror = function error(err) {
            reject(`WebSocket error: ${err.message}`);
        };
    });
}

export async function populateNabuCasaVoiceSelect(server, bearer, engineId) {
    const voicesSelect = document.getElementById("nabu-casa-voice-select");
    const selectedOption = getCookie("nabu-casa-voice-select");

    try {
        const languages = await getSupportedLanguages(server, bearer, engineId);
        voicesSelect.innerHTML = ''; // Clear existing options

        for (const language of languages) {
            const voices = await getVoicesForEngine(server, bearer, engineId, language);
            for (const voice of voices) {
                const option = document.createElement('option');
                const optionValue = `${language} ${voice.voice_id}`;
                option.value = optionValue;
                option.textContent = `${language} - ${voice.name}`;
                voicesSelect.appendChild(option);

                // Check if the current option matches the cookie value
                if (optionValue === selectedOption) {
                    voicesSelect.value = optionValue;
                }
            }
        }
    } catch (error) {
        console.error('Error populating voice select:', error);
    }
}

async function getSupportedLanguages(server, bearer, engineId) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(server+"/api/websocket");

        ws.onopen = function open() {
            // Authenticate with Home Assistant
            ws.send(JSON.stringify({ type: "auth", access_token: bearer }));
        };

        ws.onmessage = function incoming(event) {
            const message = JSON.parse(event.data);

            // Handle authentication response
            if (message.type === "auth_ok") {
                // Send the command to get engine info
                ws.send(JSON.stringify({
                    id: 1,
                    type: "tts/engine/get",
                    engine_id: engineId
                }));
            }

            // Handle the response to get engine info
            if (message.id === 1) {
                if (message.result && message.result.provider) {
                    resolve(message.result.provider.supported_languages);
                    ws.close();
                } else if (message.error) {
                    reject(`Error: ${message.error.message}`);
                    ws.close();
                }
            }
        };

        ws.onerror = function error(err) {
            reject(`WebSocket error: ${err.message}`);
        };
    });
}
