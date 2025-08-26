document.addEventListener('DOMContentLoaded', () => {
    // --- Referencias a Elementos del DOM ---
    const modeSelectionView = document.getElementById('mode-selection-view');
    const transcriptionView = document.getElementById('transcription-view');
    const modeFastBtn = document.getElementById('mode-fast-dictation');
    const modeDeepBtn = document.getElementById('mode-deep-transcription');
    const backToModesBtn = document.getElementById('back-to-modes');

    const recordBtn = document.getElementById('record-btn');
    const audioUpload = document.getElementById('audio-upload');
    const uploadLabel = document.getElementById('upload-label');
    const statusText = document.getElementById('status-text');
    const outputText = document.getElementById('output-text');
    const transcriptionTitle = document.getElementById('transcription-title');
    const transcriptionSubtitle = document.getElementById('transcription-subtitle');
    
    const copyBtn = document.getElementById('copy-btn');
    const clearBtn = document.getElementById('clear-btn');
    const historyBtn = document.getElementById('history-btn');
    const historyModal = document.getElementById('history-modal');
    const closeModalBtn = document.querySelector('.close-button');
    const historyList = document.getElementById('history-list');

    // --- Estado Global de la Aplicación ---
    let activeMode = null; // 'fast' o 'deep'
    let isRecording = false;

    // --- Lógica y Estado para MODO RÁPIDO (Web Speech API) ---
    let recognition;
    let final_transcript = '';
    if ('webkitSpeechRecognition' in window) {
        recognition = new webkitSpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'es-ES';

        recognition.onresult = (event) => {
            let interim_transcript = '';
            final_transcript = ''; // Reset final transcript to rebuild it
            for (let i = 0; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    final_transcript += event.results[i][0].transcript;
                } else {
                    interim_transcript += event.results[i][0].transcript;
                }
            }
            outputText.value = final_transcript + interim_transcript;
        };

        recognition.onstart = () => {
            statusText.textContent = 'STATUS: ACTIVE LISTENING (FAST MODE)...';
            recordBtn.classList.add('recording');
        };

        recognition.onend = () => {
            statusText.textContent = 'STATUS: STANDBY (FAST MODE).';
            recordBtn.classList.remove('recording');
            isRecording = false;
            // Guardamos la transcripción final al historial
            processAndSaveTranscription(outputText.value, false); // false = no resumir
        };

         recognition.onerror = (event) => {
            console.error("Speech Recognition Error", event.error);
            statusText.textContent = `ERROR: ${event.error}`;
            isRecording = false;
            recordBtn.classList.remove('recording');
        };
    } else {
        modeFastBtn.disabled = true;
        modeFastBtn.querySelector('.mode-desc').textContent = 'Modo no disponible en este navegador. Prueba con Chrome o Edge.';
    }

    // --- Lógica y Estado para MODO PROFUNDO (Whisper AI) ---
    let transcriber = null, summarizer = null;
    const SUMMARIZE_THRESHOLD = 1500;
    const TARGET_SAMPLE_RATE = 16000;
    let audioContext;
    let workletNode;
    let microphoneStream;

    function resampleBuffer(inputBuffer, inputSampleRate) {
        if (inputSampleRate === TARGET_SAMPLE_RATE) {
            return inputBuffer;
        }
        const ratio = TARGET_SAMPLE_RATE / inputSampleRate;
        const outputLength = Math.round(inputBuffer.length * ratio);
        const outputBuffer = new Float32Array(outputLength);
        for (let i = 0; i < outputLength; i++) {
            const theoreticalIndex = i / ratio;
            const index1 = Math.floor(theoreticalIndex);
            const index2 = Math.ceil(theoreticalIndex);
            const t = theoreticalIndex - index1;
            if (index2 < inputBuffer.length) {
                outputBuffer[i] = (1 - t) * inputBuffer[index1] + t * inputBuffer[index2];
            } else {
                outputBuffer[i] = inputBuffer[index1];
            }
        }
        return outputBuffer;
    }

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
                workletNode.port.onmessage = async (event) => {
                    statusText.textContent = 'Recording complete. Processing full audio...';
                    let audioData = event.data.buffer;
                    if (audioData.length === 0) {
                        statusText.textContent = 'Recording was empty. Nothing to process.';
                        return;
                    }
                    const resampledAudio = resampleBuffer(audioData, audioContext.sampleRate);
                    const result = await transcribeAudio(resampledAudio);
                    outputText.value = result;
                    processAndSaveTranscription(result, true); // true = puede resumir
                };
            } catch (error) {
                console.error("Error setting up AudioWorklet:", error);
                statusText.textContent = "ERROR: Audio Worklet setup failed.";
            }
        }
    }

    async function loadModels() {
        if (transcriber) return;
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

    async function startRecordingDeep() {
        await setupAudioWorklet();
        try {
            microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = audioContext.createMediaStreamSource(microphoneStream);
            source.connect(workletNode);
            workletNode.port.postMessage({ command: 'start' });
            recordBtn.classList.add('recording');
            statusText.textContent = 'STATUS: ACTIVE LISTENING (DEEP MODE)...';
            uploadLabel.classList.add('disabled');
        } catch (error) { console.error('Mic access error:', error); statusText.textContent = 'ERROR: MIC ACCESS DENIED.'; }
    }

    function stopRecordingDeep() {
        if (workletNode && microphoneStream) {
            workletNode.port.postMessage({ command: 'stop' });
            microphoneStream.getTracks().forEach(track => track.stop());
        }
        recordBtn.classList.remove('recording');
        statusText.textContent = 'STATUS: STANDBY (DEEP MODE).';
        uploadLabel.classList.remove('disabled');
    }

    // --- GESTIÓN DE LA INTERFAZ Y MODOS ---

    function switchToTranscriptionView(mode) {
        modeSelectionView.classList.add('hidden');
        transcriptionView.classList.remove('hidden');
        activeMode = mode;
        clearBtn.click(); // Limpiar el texto anterior
        
        if (mode === 'fast') {
            transcriptionTitle.textContent = "Dictado Rápido";
            transcriptionSubtitle.textContent = "// WEB SPEECH API (ONLINE) //";
            statusText.textContent = 'Listo para dictado rápido. Pulsa el micro para empezar.';
            recordBtn.disabled = false;
            uploadLabel.style.display = 'none'; // Ocultar subida de archivos
            historyBtn.style.display = 'none'; // Ocultar historial
        } else if (mode === 'deep') {
            transcriptionTitle.textContent = "Códice Sónico";
            transcriptionSubtitle.textContent = "// WHISPER AI (OFFLINE & PRIVATE) //";
            recordBtn.disabled = true; // Deshabilitado hasta que cargue el modelo
            uploadLabel.style.display = 'inline-block';
            historyBtn.style.display = 'inline-block';
            loadModels(); // Cargar modelos de IA solo si se elige este modo
        }
    }
    
    backToModesBtn.addEventListener('click', () => {
        if (isRecording) {
            if (activeMode === 'fast') recognition.stop();
            if (activeMode === 'deep') stopRecordingDeep();
        }
        activeMode = null;
        isRecording = false;
        transcriptionView.classList.add('hidden');
        modeSelectionView.classList.remove('hidden');
    });

    modeFastBtn.addEventListener('click', () => switchToTranscriptionView('fast'));
    modeDeepBtn.addEventListener('click', () => switchToTranscriptionView('deep'));

    recordBtn.addEventListener('click', () => {
        if (isRecording) {
            if (activeMode === 'fast') recognition.stop();
            if (activeMode === 'deep') stopRecordingDeep();
            isRecording = false;
        } else {
            if (activeMode === 'fast') {
                final_transcript = outputText.value;
                recognition.start();
            }
            if (activeMode === 'deep') startRecordingDeep();
            isRecording = true;
        }
    });

    // --- FUNCIONES COMPARTIDAS (HISTORIAL, RESUMEN, ETC.) ---

    audioUpload.addEventListener('change', async (event) => {
        await setupAudioWorklet();
        const file = event.target.files[0];
        if (!file || isRecording) return;
        recordBtn.disabled = true;
        statusText.textContent = `TRANSCRIBING FILE: "${file.name}"...`;
        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            const audioData = audioBuffer.getChannelData(0);
            const resampledAudio = resampleBuffer(audioData, audioBuffer.sampleRate);
            const result = await transcribeAudio(resampledAudio);
            outputText.value = result;
            statusText.textContent = `FILE TRANSCRIPTION COMPLETE: "${file.name}"`;
            processAndSaveTranscription(result, true);
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
            const output = await transcriber(audioData, { chunk_length_s: 30, stride_length_s: 5 });
            return output.text;
        } catch (error) { 
            console.error('Transcription error:', error); 
            return `// TRANSCRIPTION ERROR: ${error.message} //`; 
        }
    }

    async function processAndSaveTranscription(text, canSummarize) {
        if (!text || text.trim().length < 20) return;
        let summaryText = null;
        if (canSummarize && text.length > SUMMARIZE_THRESHOLD) {
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
        if (activeMode === 'deep') { // Solo guardar en historial para el modo profundo
            saveToHistory(text, summaryText);
        }
    }
    
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

    function loadHistory() { renderHistory(); }
    
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

    historyBtn.addEventListener('click', () => historyModal.classList.remove('hidden'));
    closeModalBtn.addEventListener('click', () => historyModal.classList.add('hidden'));
    window.addEventListener('click', (event) => { 
        if (event.target === historyModal) { 
            historyModal.classList.add('hidden'); 
        } 
    });

    copyBtn.addEventListener('click', () => {
        outputText.select();
        document.execCommand('copy');
        statusText.textContent = 'OUTPUT BUFFER COPIED TO CLIPBOARD.';
    });

    clearBtn.addEventListener('click', () => {
        outputText.value = '';
        if(activeMode === 'fast') {
            final_transcript = '';
        }
        statusText.textContent = 'OUTPUT BUFFER CLEARED.';
    });
});
