document.addEventListener('DOMContentLoaded', () => {
    // --- Referencias a Elementos del DOM ---
    const recordBtn = document.getElementById('record-btn');
    const audioUpload = document.getElementById('audio-upload');
    const uploadLabel = document.getElementById('upload-label');
    const statusText = document.getElementById('status-text');
    const outputText = document.getElementById('output-text');
    const copyBtn = document.getElementById('copy-btn');
    const clearBtn = document.getElementById('clear-btn');
    const historyBtn = document.getElementById('history-btn');
    const historyModal = document.getElementById('history-modal');
    const closeModalBtn = document.querySelector('.close-button');
    const historyList = document.getElementById('history-list');

    // --- Estado de la Aplicación ---
    let transcriber = null;
    let summarizer = null;
    let mediaRecorder = null;
    let isRecording = false;
    const SUMMARIZE_THRESHOLD = 1500;

    // --- 1. Carga de Modelos y Lógica Principal ---
    async function loadModels() {
        statusText.textContent = `SYSTEM BOOT: Loading Transcriber Core...`;
        transcriber = await window.pipeline('automatic-speech-recognition', 'Xenova/whisper-small', {
            progress_callback: data => {
                if (data.status !== 'progress') return;
                statusText.textContent = `LOADING TRANSCRIBER CORE... ${data.progress.toFixed(1)}%`;
            }
        });
        statusText.textContent = 'SYSTEM READY.';
        recordBtn.disabled = false;
        uploadLabel.classList.remove('disabled');
    }

    async function loadSummarizer() {
        if (summarizer) return;
        statusText.textContent = `LOADING SUMMARIZER CORE...`;
        summarizer = await window.pipeline('summarization', 'Xenova/distilbart-cnn-6-6', {
            progress_callback: data => {
                if (data.status !== 'progress') return;
                statusText.textContent = `LOADING SUMMARIZER CORE... ${data.progress.toFixed(1)}%`;
            }
        });
    }

    loadModels();
    loadHistory();

    // --- 2. Lógica de Transcripción (Micrófono y Archivo) ---
    recordBtn.addEventListener('click', () => isRecording ? stopRecording() : startRecording());

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
            mediaRecorder.start(5000);
            isRecording = true;
            recordBtn.classList.add('recording');
            statusText.textContent = 'STATUS: ACTIVE LISTENING...';
            uploadLabel.classList.add('disabled');
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
        uploadLabel.classList.remove('disabled');
        processAndSaveTranscription(outputText.value);
    }

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
        processAndSaveTranscription(result);
    });

    async function transcribeAudio(audioUrl) {
        if (!transcriber) return 'ERROR: AI CORE NOT LOADED.';
        try {
            const output = await transcriber(audioUrl, {
                chunk_length_s: 30,
                stride_length_s: 5
            });
            return output.text;
        } catch (error) {
            console.error('Transcription error:', error);
            return `// TRANSCRIPTION ERROR: ${error.message} //`;
        }
    }

    // --- 3. Lógica de Procesado, Resumen y Guardado ---
    async function processAndSaveTranscription(text) {
        if (!text || text.trim().length < 20) return;
        let summaryText = null;
        if (text.length > SUMMARIZE_THRESHOLD) {
            statusText.textContent = `Transcription long. Generating summary...`;
            await loadSummarizer();
            try {
                const summary = await summarizer(text, { max_length: 150, min_length: 30 });
                summaryText = summary[0].summary_text;
                statusText.textContent = 'Transcription and summary saved to history.';
            } catch (error) {
                console.error('Summarization error:', error);
                statusText.textContent = 'Transcription saved. Summary failed.';
            }
        } else {
            statusText.textContent = 'Transcription saved to history.';
        }
        saveToHistory(text, summaryText);
    }

    // --- 4. Lógica del Historial ---
    function saveToHistory(transcription, summary) {
        const history = JSON.parse(localStorage.getItem('codiceSonicoHistory')) || [];
        const newEntry = {
            id: Date.now(),
            date: new Date().toLocaleString('es-ES'),
            transcription: transcription,
            summary: summary,
        };
        history.unshift(newEntry);
        localStorage.setItem('codiceSonicoHistory', JSON.stringify(history));
        renderHistory();
    }

    function loadHistory() {
        renderHistory();
    }

    function renderHistory() {
        const history = JSON.parse(localStorage.getItem('codiceSonicoHistory')) || [];
        historyList.innerHTML = '';
        if (history.length === 0) {
            historyList.innerHTML = '<p>No hay transcripciones guardadas.</p>';
            return;
        }
        history.forEach(entry => {
            const item = document.createElement('div');
            item.className = 'history-item';
            item.innerHTML = `
                <div class="history-item-date">
                    ${entry.date}
                    ${entry.summary ? '<span class="history-item-summary-tag">RESUMEN</span>' : ''}
                </div>
                <p class="history-item-preview">${entry.transcription}</p>
            `;
            item.addEventListener('click', () => {
                outputText.value = entry.summary ? `--- RESUMEN ---\n${entry.summary}\n\n--- TRANSCRIPCIÓN COMPLETA ---\n${entry.transcription}` : entry.transcription;
                historyModal.classList.add('hidden');
            });
            historyList.appendChild(item);
        });
    }

    // --- 5. Lógica de la Ventana Modal ---
    historyBtn.addEventListener('click', () => historyModal.classList.remove('hidden'));
    closeModalBtn.addEventListener('click', () => historyModal.classList.add('hidden'));
    window.addEventListener('click', (event) => {
        if (event.target === historyModal) {
            historyModal.classList.add('hidden');
        }
    });

    // --- 6. Botones de Utilidad ---
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
