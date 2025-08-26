document.addEventListener('DOMContentLoaded', () => {
    // --- Referencias a Elementos del DOM ---
    const recordBtn = document.getElementById('record-btn');
    const audioUpload = document.getElementById('audio-upload');
    const uploadLabel = document.getElementById('upload-label');
    const statusText = document.getElementById('status-text');
    const outputText = document.getElementById('output-text');
    const copyBtn = document.getElementById('copy-btn');
    const clearBtn = document.getElementById('clear-btn');

    // --- Estado de la Aplicación ---
    let transcriber = null;
    let mediaRecorder = null;
    let isRecording = false;

    // --- 1. Carga del Modelo de IA ---
    async function loadModel() {
        transcriber = await window.pipeline('automatic-speech-recognition', 'Xenova/whisper-small', {
            progress_callback: data => {
                if (data.status === 'progress') {
                    const progress = (data.progress).toFixed(1);
                    statusText.textContent = `LOADING AI CORE... ${progress}%`;
                }
            }
        });
        statusText.textContent = 'SYSTEM READY.';
        recordBtn.disabled = false;
        uploadLabel.classList.remove('disabled');
    }
    loadModel();

    // --- 2. Transcripción en Tiempo Real (Micrófono) ---
    recordBtn.addEventListener('click', async () => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });

    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            
            mediaRecorder.addEventListener('dataavailable', async (event) => {
                statusText.textContent = 'PROCESSING AUDIO CHUNK...';
                const audioBlob = new Blob([event.data], { type: 'audio/webm' });
                const audioUrl = URL.createObjectURL(audioBlob);
                const result = await transcribeAudio(audioUrl);
                outputText.value += result + ' ';
                statusText.textContent = 'STATUS: ACTIVE LISTENING...';
            });

            mediaRecorder.start(5000); // Procesa el audio cada 5 segundos
            isRecording = true;
            recordBtn.classList.add('recording');
            statusText.textContent = 'STATUS: ACTIVE LISTENING...';
            uploadLabel.classList.add('disabled'); // Deshabilitar subida mientras graba
        } catch (error) {
            console.error('Mic access error:', error);
            statusText.textContent = 'ERROR: MIC ACCESS DENIED.';
        }
    }

    function stopRecording() {
        if (mediaRecorder) {
            mediaRecorder.stop();
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
        isRecording = false;
        recordBtn.classList.remove('recording');
        statusText.textContent = 'STATUS: STANDBY.';
        uploadLabel.classList.remove('disabled'); // Habilitar subida de nuevo
    }

    // --- 3. Transcripción de Archivo de Audio ---
    audioUpload.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file || isRecording) return;

        recordBtn.disabled = true;
        statusText.textContent = `TRANSCRIBING FILE: "${file.name}"...`;
        
        const audioUrl = URL.createObjectURL(file);
        const result = await transcribeAudio(audioUrl);
        outputText.value = result;

        statusText.textContent = `FILE TRANSCRIPTION COMPLETE: "${file.name}"`;
        recordBtn.disabled = false;
        audioUpload.value = '';
    });

    // --- 4. Función Principal de Transcripción ---
    async function transcribeAudio(audioUrl) {
        if (!transcriber) {
            return 'ERROR: AI CORE NOT LOADED.';
        }
        try {
            const output = await transcriber(audioUrl, { chunk_length_s: 30, stride_length_s: 5 });
            return output.text;
        } catch (error) {
            console.error('Transcription error:', error);
            return `// TRANSCRIPTION ERROR: ${error.message} //`;
        }
    }

    // --- 5. Botones de Utilidad ---
    copyBtn.addEventListener('click', () => {
        outputText.select();
        document.execCommand('copy');
        statusText.textContent = 'OUTPUT BUFFER COPIED TO CLIPBOARD.';
    });

    clearBtn.addEventListener('click', () => {
        outputText.value = '';
        statusText.textContent = 'OUTPUT BUFFER CLEARED. STATUS: STANDBY.';
    });
});
