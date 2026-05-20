import { ref } from 'vue';

function getToken() { return localStorage.getItem('aramis_token') || ''; }

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/ogg;codecs=opus',
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return null;
}

/**
 * Voice input via MediaRecorder → server Whisper transcription.
 * Whisper auto-detects the spoken language; no per-locale setup required.
 */
export function useVoiceInput() {
  const recording = ref(false);
  const transcribing = ref(false);
  const duration = ref(0);
  const error = ref('');

  let recorder = null;
  let stream = null;
  let chunks = [];
  let timer = null;
  let startedAt = 0;

  function isSupported() {
    return typeof navigator !== 'undefined'
      && !!navigator.mediaDevices?.getUserMedia
      && typeof MediaRecorder !== 'undefined';
  }

  function _stopTracks() {
    if (timer) { clearInterval(timer); timer = null; }
    if (stream) {
      try { stream.getTracks().forEach((t) => t.stop()); } catch {}
      stream = null;
    }
  }

  async function start() {
    error.value = '';
    if (!isSupported()) { error.value = 'unsupported'; return false; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      error.value = e.name === 'NotAllowedError' ? 'denied' : 'mic_error';
      return false;
    }
    chunks = [];
    const mimeType = pickMimeType();
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      _stopTracks();
      error.value = 'mic_error';
      return false;
    }
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    recorder.start(250); // collect data every 250ms so dataavailable fires steadily
    startedAt = Date.now();
    duration.value = 0;
    timer = setInterval(() => { duration.value = Math.floor((Date.now() - startedAt) / 1000); }, 250);
    recording.value = true;
    return true;
  }

  async function stopAndTranscribe() {
    if (!recorder || recorder.state === 'inactive') return null;
    const stoppedPromise = new Promise((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
    });
    recorder.stop();
    await stoppedPromise;
    recording.value = false;
    const mimeType = recorder.mimeType || 'audio/webm';
    _stopTracks();
    const blob = new Blob(chunks, { type: mimeType });
    chunks = [];
    if (!blob || blob.size < 500) { error.value = 'too_short'; return null; }

    transcribing.value = true;
    try {
      const fd = new FormData();
      const ext = mimeType.includes('mp4') ? 'mp4' : (mimeType.includes('ogg') ? 'ogg' : 'webm');
      fd.append('audio', blob, `voice.${ext}`);
      const headers = {};
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch('/api/transcribe', { method: 'POST', body: fd, headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data.text || '';
    } catch (e) {
      error.value = e.message || 'transcribe_failed';
      return null;
    } finally {
      transcribing.value = false;
    }
  }

  function cancel() {
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch {}
    }
    chunks = [];
    recording.value = false;
    transcribing.value = false;
    _stopTracks();
  }

  return { recording, transcribing, duration, error, isSupported, start, stopAndTranscribe, cancel };
}
