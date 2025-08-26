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
    let transcriber = null, summarizer = null;
    let isRecording = false;
    const SUMMARIZE_THRESHOLD = 1500;
    
    // --- ARQUITECTURA DE AUDIO PROFESIONAL ---
    let audioContext;
    let workletNode;
    let microphoneStream;

    async function setupAudioWorklet() {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        if (!workletNode) {
            try {
                await audioContext.audioWorklet.addModule('audio-recorder-worklet.js');
                workletNode = new AudioWorkletNode(audioContext, 'audio-recorder-processor');
                
                // El worklet nos enviará el audio grabado cuando se lo pidamos
                workletNode.port.onmessage = async (event) => {
                    statusText.textContent = 'Recording complete. Processing full audio...';
                    const audioData = event.data.buffer;
                    if (audioData.length === 0) {
                        statusText.textContent = 'Recording was empty. Nothing to process.';
                        return;
                    }
                    const result = await transcribeAudio(audioData);
                    outputText.value = result;
                    processAndSaveTranscription(result);
                };

            } catch (error) {
                console.error("Error setting up AudioWorklet:", error);
                statusText.textContent = "ERROR: Audio Worklet setup failed.";
            }
        }
    }

    // --- Carga de Modelos y Lógica Principal ---
    async function loadModels() {
        statusText.textContent = `SYSTEM BOOT: Loading Transcriber Core...`;
        transcriber = await window.pipeline('automatic-speech-recognition', 'Xenova/whisper-small', {
            progress_callback: data => {
                if(data.status !== 'progress') return;
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
                if(data.status !== 'progress') return;
                statusText.textContent = `LOADING SUMMARIZER CORE... ${data.progress.toFixed(1)}%`;
            }
        });
    }

    loadModels();
    loadHistory();

    // --- Lógica de Transcripción ---
    recordBtn.addEventListener('click', () => isRecording ? stopRecording() : startRecording());
    
    async function startRecording() {
        await setupAudioWorklet();
        
        try {
            microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000 } });
            const source = audioContext.createMediaStreamSource(microphoneStream);
            source.connect(workletNode);
            workletNode.port.postMessage({ command: 'start' });

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
        if (isRecording && workletNode) {
            workletNode.port.postMessage({ command: 'stop' });
            microphoneStream.getTracks().forEach(track => track.stop());
        }
        isRecording = false;
        recordBtn.classList.remove('recording');
        statusText.textContent = 'STATUS: STANDBY.';
        uploadLabel.classList.remove('disabled');
    }

    audioUpload.addEventListener('change', async (event) => {
        await setupAudioWorklet();
        const file = event.target.files[0];
        if (!file || isRecording) return;
        recordBtn.disabled = true;
        statusText.textContent = `TRANSCRIBING FILE: "${file.name}"...`;
        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            const result = await transcribeAudio(audioBuffer.getChannelData(0));
            outputText.value = result;
            statusText.textContent = `FILE TRANSCRIPTION COMPLETE: "${file.name}"`;
            processAndSaveTranscription(result);
        } catch (error) {
            console.error('Error processing audio file:', error);
            statusText.textContent = `ERROR: Could not process file "${file.name}"`;
        } finally {
            recordBtn.disabled = false;
            audioUpload.value = '';
        }
    });

    async function transcribeAudio(audioData) {
        if (!transcriber) return 'ERROR: AI CORE NOT LOADED.';
        try {
            const output = await transcriber(audioData, { 
                chunk_length_s: 30, 
                stride_length_s: 5 
            });
            return output.text;
        } catch (error) { 
            console.error('Transcription error:', error); 
            return `// TRANSCRIPTION ERROR: ${error.message} //`; 
        }
    }

    // --- Lógica de Procesado, Resumen y Guardado ---
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

    // --- Lógica del Historial ---
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
    
    function deleteFromHistory(id) {
        let history = JSON.parse(localStorage.getItem('codiceSonicoHistory')) || [];
        history = history.filter(entry => entry.id !== id);
        localStorage.setItem('codiceSonicoHistory', JSON.stringify(history));
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
                <button class="delete-btn" title="Eliminar entrada">
                    <svg viewBox="0 0 448 512"><path d="M135.2 17.7L128 32H32C14.3 32 0 46.3 0 64S14.3 96 32 96H416c17.7 0 32-14.3 32-32s-14.3-32-32-32H320l-7.2-14.3C307.4 6.8 296.3 0 284.2 0H163.8c-12.1 0-23.2 6.8-28.6 17.7zM416 128H32L53.2 467c1.6 25.3 22.6 45 47.9 45H346.9c25.3 0 46.3-19.7 47.9-45L416 128z"/></svg>
                </button>
            `;
            item.addEventListener('click', () => {
                outputText.value = entry.summary ? `--- RESUMEN ---\n${entry.summary}\n\n--- TRANSCRIPCIÓN COMPLETA ---\n${entry.transcription}` : entry.transcription;
                historyModal.classList.add('hidden');
            });
            const deleteBtn = item.querySelector('.delete-btn');
            deleteBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                deleteFromHistory(entry.id);
            });
            historyList.appendChild(item);
        });
    }

    // --- Lógica de la Ventana Modal ---
    historyBtn.addEventListener('click', () => historyModal.classList.remove('hidden'));
    closeModalBtn.addEventListener('click', () => historyModal.classList.add('hidden'));
    window.addEventListener('click', (event) => { 
        if (event.target === historyModal) { 
            historyModal.classList.add('hidden'); 
        } 
    });

    // --- Botones de Utilidad ---
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
