const CHUNK_FRAMES = 2400;

class PCM16Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Int16Array(CHUNK_FRAMES);
    this._offset = 0;
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this._buf[this._offset++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this._offset >= CHUNK_FRAMES) {
        this.port.postMessage({ pcm16: this._buf.slice() }, [this._buf.buffer]);
        this._buf = new Int16Array(CHUNK_FRAMES);
        this._offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm16-processor', PCM16Processor);
