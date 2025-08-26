# Códice Sónico  Decoding Audio Streams...

## Abstract

Códice Sónico es una interfaz neuronal web para la decodificación de flujos de audio a texto. Operando enteramente en el `edge` (el navegador del cliente), utiliza un núcleo de IA `offline` para transmutar la palabra hablada en texto digital, garantizando una privacidad absoluta de los datos.

## System Architecture

* **Core Logic Unit:** El sistema se articula sobre `Transformers.js`, ejecutando una versión cuantizada del `neural net` **Whisper (OpenAI)**. Este modelo de `Automatic Speech Recognition` (ASR) es el responsable de la transmutación audio-a-texto.
* **Input Stream Interface:** La captura de audio se gestiona a través de la Web Audio API (`MediaRecorder`), un protocolo estándar para la interacción con los periféricos de audio del `host`.
* **Zero-Server Footprint:** Toda la computación se realiza en la máquina cliente. No hay `data packets` de audio enviados a servidores externos. La privacidad no es una opción, es el protocolo.

## Operational Protocols

1.  **Initialization:** Al establecer la conexión, el sistema carga en la caché local el `neural net`. El progreso de la inyección de datos es visible en la `status line`.
2.  **Real-time Protocol (Mic Input):**
    * Activar el `mic-node` (icono del micrófono). Se requerirá autorización de acceso al `hardware`.
    * El `node` entrará en modo `active-listening`, indicado por una pulsación lumínica.
    * El `stream` de datos de audio se procesa en `chunks` y la data textualizada aparece en el `output buffer`.
    * Desactivar el `mic-node` para finalizar la transmisión.
3.  **Batch Protocol (File Input):**
    * Seleccionar un `audio file` local (`.mp3`, `.wav`, etc.).
    * El sistema procesará el archivo en su totalidad. El `output` se mostrará al finalizar el `batch process`.

## Deployment

Como `static web application`, el despliegue es trivial en cualquier `CDN` o `static host` (GitHub Pages, Netlify, Vercel). No requiere `backend infrastructure`.
