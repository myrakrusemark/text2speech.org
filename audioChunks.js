import { getDataFromIndexedDB } from './database.js';

export async function storeAudioChunk(storeDataInIndexedDB, chunk, index, fileId) {
    await storeDataInIndexedDB(`audioChunk_${fileId}_${index}`, chunk);
}

async function getAndCombineAudioChunks(chunkCount, fileId) {
    const chunks = [];
    let format = '';

    for (let i = 0; i < chunkCount; i++) {
        const chunkKey = `audioChunk_${fileId}_${i}`;
        console.log(`Retrieving ${chunkKey}`);
        const chunk = await getDataFromIndexedDB(chunkKey);
        console.log(`Size of ${chunkKey}: ${chunk.size} bytes`);
        chunks.push(chunk);

    }

    const activeTabButton = document.querySelector('#tts-engine-tabs .tab-button.active');
    const ext = activeTabButton.getAttribute('data-extension');

    if (ext === '.wav') {
        return await combineWAVChunks(chunks);
    } else if (ext === '.mp3') {
        return await combineMPEGChunks(chunks);
    } else {
        throw new Error('Unsupported audio format: '+format);
    }
}

async function combineWAVChunks(chunks) {
    const audioDataChunks = [];
    let totalLength = 0;
    let sampleRate = 0;
    let numChannels = 0;

    for (const chunk of chunks) {
        const audioBuffer = await chunk.arrayBuffer();
        const dataView = new DataView(audioBuffer);

        // Read WAV file header information
        const chunkSampleRate = dataView.getUint32(24, true);
        const chunkNumChannels = dataView.getUint16(22, true);

        // Ensure all chunks have the same sample rate and number of channels
        if (sampleRate === 0) {
            sampleRate = chunkSampleRate;
            numChannels = chunkNumChannels;
        } else if (chunkSampleRate !== sampleRate || chunkNumChannels !== numChannels) {
            throw new Error('Incompatible WAV chunk format');
        }

        // Extract the raw audio data (PCM)
        const dataOffset = 44; // WAV header size
        const audioData = audioBuffer.slice(dataOffset);
        audioDataChunks.push(audioData);
        totalLength += audioData.byteLength;
    }

    // Concatenate the audio data chunks
    const combinedAudioData = new Uint8Array(totalLength);
    let offset = 0;
    for (const audioData of audioDataChunks) {
        combinedAudioData.set(new Uint8Array(audioData), offset);
        offset += audioData.byteLength;
    }

    // Create a new WAV file header
    const headerBuffer = new ArrayBuffer(44);
    const headerView = new DataView(headerBuffer);

    // Set WAV file header fields
    headerView.setUint32(0, 0x46464952, true); // "RIFF"
    headerView.setUint32(4, 36 + totalLength, true); // File size - 8
    headerView.setUint32(8, 0x45564157, true); // "WAVE"
    headerView.setUint32(12, 0x20746d66, true); // "fmt "
    headerView.setUint32(16, 16, true); // Format chunk size
    headerView.setUint16(20, 1, true); // Audio format (1 = PCM)
    headerView.setUint16(22, numChannels, true); // Number of channels
    headerView.setUint32(24, sampleRate, true); // Sample rate
    headerView.setUint32(28, sampleRate * numChannels * 2, true); // Byte rate
    headerView.setUint16(32, numChannels * 2, true); // Block align
    headerView.setUint16(34, 16, true); // Bits per sample
    headerView.setUint32(36, 0x61746164, true); // "data"
    headerView.setUint32(40, totalLength, true); // Data chunk size

    // Concatenate the WAV header and audio data
    const wavFileBlob = new Blob([headerBuffer, combinedAudioData], { type: 'audio/wav' });
    return wavFileBlob;
}

async function combineMPEGChunks(chunks) {
    const audioDataChunks = [];

    for (const chunk of chunks) {
        const audioData = await chunk.arrayBuffer();
        audioDataChunks.push(audioData);
    }

    // Concatenate the MPEG audio data chunks
    const combinedAudioData = new Blob(audioDataChunks, { type: 'audio/mpeg' });
    return combinedAudioData;
}

/*function detectAudioFormat(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = function() {
            const arr = new Uint8Array(reader.result);
            console.log('First 4 bytes:', arr[0], arr[1], arr[2], arr[3]);
            if (arr[0] === 0x52 && arr[1] === 0x49 && arr[2] === 0x46 && arr[3] === 0x46) {
                console.log('Detected WAV format');
                resolve('audio/wav');
            } else if (arr[0] === 0x49 && arr[1] === 0x44 && arr[2] === 0x33) {
                console.log('Detected MP3 format');
                resolve('audio/mpeg');
            } else {
                console.log('Unknown format, defaulting to MP3');
                resolve('audio/mpeg');
            }
        };
        reader.onerror = function(error) {
            console.error('Error reading blob:', error);
            reject(error);
        };
        reader.readAsArrayBuffer(blob.slice(0, 4));
    });
}*/

export async function combineGeneratedAudio(fileId) {
    const chunkCount = parseInt(await getDataFromIndexedDB('completedChunks'));
    console.log("completed chunks: " + chunkCount);
    const combinedBlob = await getAndCombineAudioChunks(chunkCount, fileId);
    const activeTabButton = document.querySelector('#tts-engine-tabs .tab-button.active');
    const ext = activeTabButton.getAttribute('data-extension');
    const mimeType = ext === '.wav' ? 'audio/wav' : 'audio/mpeg';
    return new Blob([combinedBlob], { type: mimeType });
}