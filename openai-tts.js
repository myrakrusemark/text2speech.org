// openai-tts.js

export async function requestOpenAITTS(openaiApiKey, text, selectedVoice, hdAudio) {
    let model = hdAudio ? 'tts-1-hd' : 'tts-1';

    try {
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${openaiApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model,
                input: text,
                voice: selectedVoice
            })
        });

        if (response.status === 429) {
            console.error('You are making too many requests, or you are out of funds on your account.');
            alert('You are making too many requests, or you are out of funds on your account.');
            return null;
        }

        if (!response.ok) {
            console.error('Error from OpenAI API:', response.statusText);
            return null;
        }

        document.getElementById('processing').classList.add('processing-lightgreen');
        const buffer = await response.arrayBuffer();
        return new Blob([buffer], { type: 'audio/mpeg' });
    } catch (error) {
        console.error('Error sending text to OpenAI API:', error);
        return null;
    }
}