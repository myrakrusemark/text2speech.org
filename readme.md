# txt2speech.org - Unlimited TTS Converter

![txt2speech.org Screenshot](screenshot.png)

txt2speech.org is a web-based tool that converts long-form text into audio files. It provides a simple solution for making text content more accessible to those who cannot read visually or for other reasons.

## Features

- Powered by [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) via [kokoro-js](https://www.npmjs.com/package/kokoro-js): free, unlimited, and private — synthesis runs entirely in your browser (WebGPU with WASM fallback). The ~90–330 MB voice model downloads once and is cached. 28 English voices (US/UK), selectable in Settings.
- Input methods: paste text, type directly, or upload a .txt file
- Bottom player bar: listen while the conversion is still running, then play/seek the finished file
- Highlighted Download button when the conversion is done, plus WAV export
- Long texts are processed in chunks with progress tracking; interrupted conversions can be resumed after a page reload
- Screen-reader friendly: live progress announcements, keyboard operable (Ctrl+Enter converts, P toggles playback)

## Usage

1. Paste, type, or upload your text.
2. (Optional) Open Settings to pick a voice.
3. Click **Convert**. The first run downloads the model — later runs start instantly.
4. Press the player's play button to listen while it converts, or hit Download when it finishes.

## Running Locally

1. Clone the repository.
2. Run `python serve.py` in the project directory.
3. Open `http://localhost:8081`.

## Disclaimer

Please read the following disclaimer carefully before using txt2speech.org:

- **Use of Text:** Users are responsible for ensuring they have the appropriate rights to convert any text files uploaded using this tool. This service should not be used to infringe on the copyright of any texts.

- **Accuracy and Liability:** While we strive to provide a high-quality service, we do not guarantee that the text-to-speech conversion will be error-free or uninterrupted. We shall not be held liable for any damages arising out of the use of this tool.

- **No Warranties:** This service is provided "as is" without any representations or warranties, express or implied.

- **Data Handling:** All processing is performed locally in the user's browser; no text or audio leaves the device. We do not store any personal data or text files used with this tool.

- **Kokoro Licensing:** The Kokoro-82M model and kokoro-js library are released under the Apache 2.0 license.

By using txt2speech.org, you accept this disclaimer in full. If you disagree with any part of this disclaimer, do not use our website.
