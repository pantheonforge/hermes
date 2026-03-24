const path = require('path');
const { ipcMain } = require('electron');
const { IPC } = require('../shared/constants');

function setup({ app }) {
  let whisperPipelinePromise = null;

  function getWhisperPipeline() {
    if (!whisperPipelinePromise) {
      whisperPipelinePromise = import('@xenova/transformers').then(({ pipeline, env }) => {
        env.cacheDir = path.join(app.getPath('userData'), 'whisper-models');
        env.allowLocalModels = false;
        return pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en');
      });
    }
    return whisperPipelinePromise;
  }

  ipcMain.handle(IPC.VOICE_TRANSCRIBE, async (_e, audioBuffer) => {
    try {
      const pipe = await getWhisperPipeline();
      // IPC delivers ArrayBuffer as a Node.js Buffer — extract the underlying ArrayBuffer correctly
      const buf = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);
      const float32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      // Pass Float32Array directly; pipeline assumes 16 kHz (matches what we send)
      const result = await pipe(float32);
      return (result?.text ?? '').trim();
    } catch (err) {
      console.error('[voice] transcription error:', err);
      return '';
    }
  });
}

module.exports = { setup };
