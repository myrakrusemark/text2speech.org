import { getDataFromIndexedDB } from './database.js';

export async function storeAudioChunk(storeDataInIndexedDB, chunk, index, fileId) {
    await storeDataInIndexedDB(`audioChunk_${fileId}_${index}`, chunk);
}

async function getAndCombineAudioChunks(chunkCount, fileId) {
    const chunks = [];

    for (let i = 0; i < chunkCount; i++) {
        const chunkKey = `audioChunk_${fileId}_${i}`;
        const chunk = await getDataFromIndexedDB(chunkKey);
        if (!chunk) {
            throw new Error(`Missing audio chunk ${i + 1}/${chunkCount} in storage`);
        }
        chunks.push(chunk);
    }

    return await combineWAVChunks(chunks);
}

async function combineWAVChunks(chunks) {
    const audioDataChunks = [];
    let totalLength = 0;
    let sampleRate = 0;
    let numChannels = 0;
    let audioFormat = 1;
    let bitsPerSample = 16;

    for (const chunk of chunks) {
        const audioBuffer = await chunk.arrayBuffer();
        const dataView = new DataView(audioBuffer);

        // Read WAV file header information
        const chunkAudioFormat = dataView.getUint16(20, true);
        const chunkNumChannels = dataView.getUint16(22, true);
        const chunkSampleRate = dataView.getUint32(24, true);
        const chunkBitsPerSample = dataView.getUint16(34, true);

        // Ensure all chunks have the same format
        if (sampleRate === 0) {
            sampleRate = chunkSampleRate;
            numChannels = chunkNumChannels;
            audioFormat = chunkAudioFormat;
            bitsPerSample = chunkBitsPerSample;
        } else if (chunkSampleRate !== sampleRate || chunkNumChannels !== numChannels
                || chunkAudioFormat !== audioFormat || chunkBitsPerSample !== bitsPerSample) {
            throw new Error('Incompatible WAV chunk format');
        }

        // Extract the raw audio data (PCM)
        const dataOffset = 44; // WAV header size
        const audioData = audioBuffer.slice(dataOffset);
        audioDataChunks.push(audioData);
        totalLength += audioData.byteLength;
    }

    // Create a new WAV file header matching the source chunks' format
    const bytesPerSample = bitsPerSample / 8;
    const headerBuffer = new ArrayBuffer(44);
    const headerView = new DataView(headerBuffer);

    // Set WAV file header fields
    headerView.setUint32(0, 0x46464952, true); // "RIFF"
    headerView.setUint32(4, 36 + totalLength, true); // File size - 8
    headerView.setUint32(8, 0x45564157, true); // "WAVE"
    headerView.setUint32(12, 0x20746d66, true); // "fmt "
    headerView.setUint32(16, 16, true); // Format chunk size
    headerView.setUint16(20, audioFormat, true); // Audio format (1 = PCM, 3 = IEEE float)
    headerView.setUint16(22, numChannels, true); // Number of channels
    headerView.setUint32(24, sampleRate, true); // Sample rate
    headerView.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // Byte rate
    headerView.setUint16(32, numChannels * bytesPerSample, true); // Block align
    headerView.setUint16(34, bitsPerSample, true); // Bits per sample
    headerView.setUint32(36, 0x61746164, true); // "data"
    headerView.setUint32(40, totalLength, true); // Data chunk size

    // Concatenate the WAV header and audio data
    return new Blob([headerBuffer, ...audioDataChunks], { type: 'audio/wav' });
}

export async function combineGeneratedAudio(fileId) {
    const chunkCount = parseInt(await getDataFromIndexedDB('completedChunks'));
    return await getAndCombineAudioChunks(chunkCount, fileId);
}
