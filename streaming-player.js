// Gapless preview playback of audio segments as they are synthesized,
// using Web Audio scheduling. Segments are decoded to AudioBuffers and
// scheduled back-to-back; playback can start while later segments are
// still being generated.
export class StreamingPlayer {
    constructor(onStateChange = () => {}) {
        this.onStateChange = onStateChange;
        this.ctx = null;
        this.buffers = [];
        this.sources = new Set();
        this.playing = false;
        this.complete = false;      // no more segments will arrive
        this.position = 0;          // seconds into the stream when paused
        this.startPosition = 0;
        this.startCtxTime = 0;
        this.nextStartTime = 0;     // ctx time the next scheduled buffer starts
        this.scheduledUpto = 0;     // index of the next unscheduled buffer
        this.cumStart = 0;          // stream-time start of buffers[scheduledUpto]
    }

    get totalDuration() {
        return this.buffers.reduce((sum, b) => sum + b.duration, 0);
    }

    // Must be called from a user gesture at least once (autoplay policy).
    unlock() {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    async enqueue(blob) {
        this.unlock();
        const buffer = await this.ctx.decodeAudioData(await blob.arrayBuffer());
        this.buffers.push(buffer);
        if (this.playing) this.#schedulePending();
        this.onStateChange(this);
    }

    play() {
        if (this.buffers.length === 0) return;
        this.unlock();
        if (this.position >= this.totalDuration - 0.01) this.position = 0;
        this.playing = true;
        this.startPosition = this.position;
        this.startCtxTime = this.ctx.currentTime + 0.05;
        this.nextStartTime = this.startCtxTime;
        this.scheduledUpto = 0;
        this.cumStart = 0;
        this.#schedulePending();
        this.onStateChange(this);
    }

    pause() {
        if (!this.playing) return;
        this.position = this.getPosition();
        this.playing = false;
        this.#stopSources();
        this.onStateChange(this);
    }

    // Current playback position in stream seconds.
    getPosition() {
        if (!this.playing) return this.position;
        return Math.min(
            this.startPosition + Math.max(0, this.ctx.currentTime - this.startCtxTime),
            this.totalDuration
        );
    }

    seek(seconds) {
        const target = Math.max(0, Math.min(seconds, this.totalDuration));
        if (this.playing) {
            this.#stopSources();
            this.position = target;
            this.playing = false;
            this.play();
        } else {
            this.position = target;
            this.onStateChange(this);
        }
    }

    markComplete() {
        this.complete = true;
    }

    reset() {
        this.playing = false;
        this.#stopSources();
        this.buffers = [];
        this.position = 0;
        this.complete = false;
        this.onStateChange(this);
    }

    #stopSources() {
        for (const source of this.sources) {
            source.onended = null;
            try { source.stop(); } catch (e) { /* already stopped */ }
        }
        this.sources.clear();
    }

    #schedulePending() {
        while (this.scheduledUpto < this.buffers.length) {
            const buffer = this.buffers[this.scheduledUpto];
            const bufEnd = this.cumStart + buffer.duration;
            if (bufEnd <= this.startPosition) {
                // entirely before the resume position — skip
                this.cumStart = bufEnd;
                this.scheduledUpto++;
                continue;
            }
            const offset = Math.max(0, this.startPosition - this.cumStart);
            // If synthesis stalled and playback caught up, restart at "now"
            // instead of overlapping with the previous segment.
            const when = Math.max(this.ctx.currentTime + 0.02, this.nextStartTime);
            const source = this.ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(this.ctx.destination);
            source.start(when, offset);
            this.sources.add(source);
            source.onended = () => {
                this.sources.delete(source);
                if (this.playing && this.complete && this.sources.size === 0
                    && this.scheduledUpto >= this.buffers.length) {
                    // reached the end of a finished stream
                    this.playing = false;
                    this.position = 0;
                    this.onStateChange(this);
                }
            };
            this.nextStartTime = when + (buffer.duration - offset);
            this.cumStart = bufEnd;
            this.scheduledUpto++;
        }
    }
}
