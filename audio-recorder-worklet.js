class AudioRecorderProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._buffer = [];
        this._recording = false;
        this.port.onmessage = (event) => {
            if (event.data.command === 'start') {
                this._recording = true;
            } else if (event.data.command === 'stop') {
                this._recording = false;
                // Al detener, enviamos el buffer completo al script principal
                this.port.postMessage({ buffer: this.getBuffer() });
                this._buffer = []; // Limpiamos para la siguiente grabación
            }
        };
    }

    process(inputs) {
        if (!this._recording) {
            return true;
        }
        // `inputs[0][0]` es un Float32Array con los datos de audio crudos
        if (inputs[0] && inputs[0][0]) {
            this._buffer.push(new Float32Array(inputs[0][0]));
        }
        return true;
    }

    getBuffer() {
        const bufferLength = this._buffer.reduce((acc, val) => acc + val.length, 0);
        const concatenatedBuffer = new Float32Array(bufferLength);
        let offset = 0;
        for (const buffer of this._buffer) {
            concatenatedBuffer.set(buffer, offset);
            offset += buffer.length;
        }
        return concatenatedBuffer;
    }
}

registerProcessor('audio-recorder-processor', AudioRecorderProcessor);
