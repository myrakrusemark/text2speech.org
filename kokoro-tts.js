import { getCookie } from './utils.js';

// kokoro-js (Apache 2.0) — Kokoro-82M in the browser via transformers.js.
// WebGPU is used when available (fp32; fp16/q8 have artifacts on WebGPU),
// otherwise WASM with q8 quantization (~92 MB download, cached by the browser).
const KOKORO_CDN = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm';
const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

let ttsPromise = null;
let forceWasm = false;

async function detectDevice() {
    if (forceWasm) return 'wasm';
    if (navigator.gpu) {
        try {
            if (await navigator.gpu.requestAdapter()) return 'webgpu';
        } catch (e) {
            console.warn('WebGPU adapter request failed, falling back to WASM:', e);
        }
    }
    return 'wasm';
}

function reportModelProgress(info) {
    const label = document.getElementById('conversion-label');
    if (!label) return;
    if (info.status === 'progress' && info.file && info.file.endsWith('.onnx')) {
        const pct = info.total ? Math.round((info.loaded / info.total) * 100) : 0;
        label.textContent = `Downloading Kokoro model… ${pct}%`;
    }
}

// Load the library and model once; every chunk reuses the same session.
function getTTS() {
    if (!ttsPromise) {
        ttsPromise = (async () => {
            const { KokoroTTS } = await import(KOKORO_CDN);
            const device = await detectDevice();
            const dtype = device === 'webgpu' ? 'fp32' : 'q8';
            console.log(`Loading Kokoro (device: ${device}, dtype: ${dtype})...`);
            const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
                dtype,
                device,
                progress_callback: reportModelProgress,
            });
            // Model is loaded — hand the label back to conversion progress
            const label = document.getElementById('conversion-label');
            if (label) label.textContent = 'Converting...';
            return { tts, device };
        })().catch(err => {
            ttsPromise = null; // allow retry on next attempt
            throw err;
        });
    }
    return ttsPromise;
}

// Kokoro's context window is ~510 phoneme tokens, so a 2048-char chunk must be
// split into sentences and the audio concatenated. Output is 16-bit PCM WAV so
// it combines cleanly with the other engines in audioChunks.js.
export async function requestKokoroTTS(text, voice, onSegment) {
    // Track segments already handed to the preview so a retry after a
    // mid-chunk failure doesn't replay them.
    let emitted = 0;
    const emit = (blob, index, total) => {
        if (onSegment && index >= emitted) {
            emitted = index + 1;
            onSegment(blob, index, total);
        }
    };
    try {
        return await synthesize(text, voice, emit);
    } catch (error) {
        // A failed inference corrupts the ONNX session, so reload the model
        // before retrying. If it failed on WebGPU, retry on WASM.
        const current = await ttsPromise?.catch(() => null);
        ttsPromise = null;
        if (current?.device === 'webgpu') {
            console.warn('Kokoro failed on WebGPU, retrying with WASM:', error);
            forceWasm = true;
        } else {
            console.warn('Kokoro failed, retrying with a fresh session:', error);
        }
        try {
            return await synthesize(text, voice, emit);
        } catch (retryError) {
            console.error('Kokoro TTS error (retry):', retryError);
            return null;
        }
    }
}

// Segments must stay small: on some GPUs (observed on Intel iGPU) inference
// crashes on inputs beyond roughly 150-200 characters, and one crash corrupts
// the ONNX session for all subsequent calls. ~100 chars is reliably safe and
// still sentence-sized, splitting at sentence → clause → word boundaries.
const MAX_SEGMENT_CHARS = 100;

// Port of the chunker from the local `kokoro-say` tool, which handles
// arbitrary clipboard text well: collapse whitespace within sentences,
// split on sentence enders, greedily pack sentences up to the limit, and
// slice anything oversized (at word boundaries, so cuts aren't audible).
function splitForKokoro(text, limit = MAX_SEGMENT_CHARS) {
    const sentences = text.split(/(?<=[.!?])\s+/)
        .map(s => s.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

    const pieces = [];
    let buf = '';
    for (const s of sentences) {
        if (s.length > limit) {
            if (buf) { pieces.push(buf); buf = ''; }
            let rest = s;
            while (rest.length > limit) {
                let cut = rest.lastIndexOf(' ', limit);
                if (cut <= 0) cut = limit;
                pieces.push(rest.slice(0, cut));
                rest = rest.slice(cut).trim();
            }
            if (rest) pieces.push(rest);
            continue;
        }
        if (buf && buf.length + 1 + s.length > limit) {
            pieces.push(buf);
            buf = s;
        } else {
            buf = buf ? `${buf} ${s}` : s;
        }
    }
    if (buf) pieces.push(buf);
    return pieces;
}

async function synthesize(text, voice, onSegment) {
    const { tts } = await getTTS();

    const segments = [];
    let sampleRate = 24000;
    const pieces = splitForKokoro(text);
    for (let i = 0; i < pieces.length; i++) {
        const audio = await tts.generate(pieces[i], { voice });
        segments.push(audio.audio);
        sampleRate = audio.sampling_rate;
        if (onSegment) onSegment(float32ToWavBlob(audio.audio, sampleRate), i, pieces.length);
    }

    if (segments.length === 0) return null;

    const totalLength = segments.reduce((sum, s) => sum + s.length, 0);
    const samples = new Float32Array(totalLength);
    let offset = 0;
    for (const s of segments) {
        samples.set(s, offset);
        offset += s.length;
    }

    return float32ToWavBlob(samples, sampleRate);
}

function float32ToWavBlob(samples, sampleRate) {
    const headerLength = 44;
    const view = new DataView(new ArrayBuffer(headerLength + samples.length * 2));

    view.setUint32(0, 0x46464952, true);  // "RIFF"
    view.setUint32(4, 36 + samples.length * 2, true);
    view.setUint32(8, 0x45564157, true);  // "WAVE"
    view.setUint32(12, 0x20746d66, true); // "fmt "
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);          // PCM
    view.setUint16(22, 1, true);          // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    view.setUint32(36, 0x61746164, true); // "data"
    view.setUint32(40, samples.length * 2, true);

    let p = headerLength;
    for (let i = 0; i < samples.length; i++) {
        const v = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(p, v < 0 ? v * 0x8000 : v * 0x7fff, true);
        p += 2;
    }
    return new Blob([view.buffer], { type: 'audio/wav' });
}

/**
 * Populates the select element with the voices kokoro-js can phonemize
 * (English only — the phonemizer package does not support other languages).
 */
export function populateKokoroVoiceSelect(selectElement) {
    const voices = {
        'English (US) — Female': ['af_heart', 'af_alloy', 'af_aoede', 'af_bella', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky'],
        'English (US) — Male': ['am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa'],
        'English (UK) — Female': ['bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily'],
        'English (UK) — Male': ['bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis'],
    };

    selectElement.innerHTML = '';

    for (const [category, voiceList] of Object.entries(voices)) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = category;
        voiceList.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice;
            option.textContent = voice;
            optgroup.appendChild(option);
        });
        selectElement.appendChild(optgroup);
    }

    const saved = getCookie('kokoro-voice-select');
    selectElement.value = saved && selectElement.querySelector(`option[value="${saved}"]`) ? saved : 'af_heart';
}
