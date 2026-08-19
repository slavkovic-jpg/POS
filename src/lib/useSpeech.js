import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Speech input and output via the Web Speech API.
 *
 * Deliberately not the Gemini TTS path the Canvas prototype used: that needs
 * an API key, costs per character, adds a network round trip before the first
 * word, and returns raw PCM you have to wrap in a WAV header by hand. The
 * browser's own synthesiser is free, offline, and starts instantly — which
 * matters far more than voice quality when you are holding a conversation.
 *
 * Four browser bugs are worked around here. Naive implementations hit all of
 * them:
 *
 * 1. `continuous` does not mean continuous. Chrome ends the session after a
 *    stretch of silence regardless. We restart on `onend` while the user still
 *    wants to listen, tracked by a ref because the event handler closes over
 *    stale state.
 * 2. Chrome's synthesiser cuts off around 15 seconds. We split into sentences
 *    and queue them.
 * 3. `getVoices()` is empty on first call in Chrome — the list arrives later
 *    via `voiceschanged`.
 * 4. Recognition picks up the synthesiser's own output through the speakers.
 *    We stop listening while speaking, then resume.
 */

const SpeechRecognition =
  typeof window !== 'undefined' &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

export const speechSupport = {
  stt: !!SpeechRecognition,
  tts: typeof window !== 'undefined' && 'speechSynthesis' in window,
};

export function useSpeech({
  onFinalTranscript,
  silenceMs = 3500,
  lang = 'en-US',
} = {}) {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState(null);
  const [voices, setVoices] = useState([]);
  const [voiceURI, setVoiceURI] = useState(
    () => localStorage.getItem('pos_voice_uri') || ''
  );

  const recognitionRef = useRef(null);
  const wantListeningRef = useRef(false);   // intent, vs. the engine's actual state
  const bufferRef = useRef('');             // final text awaiting the silence flush
  const silenceTimerRef = useRef(null);
  const speakingRef = useRef(false);
  const onFinalRef = useRef(onFinalTranscript);

  useEffect(() => { onFinalRef.current = onFinalTranscript; }, [onFinalTranscript]);

  // --- Voice list (arrives asynchronously in Chrome) -----------------------
  useEffect(() => {
    if (!speechSupport.tts) return;
    const load = () => {
      const v = window.speechSynthesis.getVoices();
      if (v.length) setVoices(v);
    };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  useEffect(() => {
    if (voiceURI) localStorage.setItem('pos_voice_uri', voiceURI);
  }, [voiceURI]);

  // --- Flush the buffer once the user has stopped talking ------------------
  const flush = useCallback(() => {
    clearTimeout(silenceTimerRef.current);
    const text = bufferRef.current.trim();
    bufferRef.current = '';
    setInterim('');
    if (text) onFinalRef.current?.(text);
  }, []);

  const armSilenceTimer = useCallback(() => {
    clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(flush, silenceMs);
  }, [flush, silenceMs]);

  // --- Recognition ---------------------------------------------------------
  const startListening = useCallback(() => {
    if (!SpeechRecognition) {
      setError('Speech input needs Chrome or Edge. Firefox and Safari do not support it.');
      return;
    }
    if (recognitionRef.current) return;

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;

    rec.onresult = (event) => {
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) bufferRef.current += result[0].transcript + ' ';
        else interimText += result[0].transcript;
      }
      setInterim(interimText);
      // Any speech at all resets the countdown — a pause mid-thought should
      // not send half a sentence.
      if (bufferRef.current.trim() || interimText.trim()) armSilenceTimer();
    };

    rec.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return; // routine
      if (event.error === 'not-allowed') {
        setError('Microphone permission denied. Allow it in the browser address bar.');
        wantListeningRef.current = false;
        setListening(false);
        return;
      }
      setError(`Speech recognition error: ${event.error}`);
    };

    // Chrome ends the session on its own; restart if the user still wants it.
    rec.onend = () => {
      recognitionRef.current = null;
      if (wantListeningRef.current && !speakingRef.current) {
        try {
          startListening();
        } catch {
          wantListeningRef.current = false;
          setListening(false);
        }
      } else if (!wantListeningRef.current) {
        setListening(false);
      }
    };

    try {
      rec.start();
      recognitionRef.current = rec;
      wantListeningRef.current = true;
      setListening(true);
      setError(null);
    } catch (err) {
      setError(`Could not start microphone: ${err.message}`);
    }
  }, [armSilenceTimer, lang]);

  const stopListening = useCallback(({ flushPending = true } = {}) => {
    wantListeningRef.current = false;
    clearTimeout(silenceTimerRef.current);
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) { try { rec.stop(); } catch { /* already stopped */ } }
    setListening(false);
    if (flushPending) flush();
    else { bufferRef.current = ''; setInterim(''); }
  }, [flush]);

  // --- Synthesis -----------------------------------------------------------
  const cancelSpeech = useCallback(() => {
    if (!speechSupport.tts) return;
    window.speechSynthesis.cancel();
    speakingRef.current = false;
    setSpeaking(false);
  }, []);

  const speak = useCallback((text) => {
    if (!speechSupport.tts || !text?.trim()) return;
    window.speechSynthesis.cancel();

    // Work around the ~15s cutoff by queueing sentence-sized utterances.
    const chunks = chunkForSpeech(text);
    if (!chunks.length) return;

    const wasListening = wantListeningRef.current;
    // Stop listening first, or the microphone transcribes the speakers.
    if (wasListening) {
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      if (rec) { try { rec.stop(); } catch { /* noop */ } }
      setListening(false);
    }

    speakingRef.current = true;
    setSpeaking(true);

    const chosen = voices.find((v) => v.voiceURI === voiceURI);
    let remaining = chunks.length;

    const finish = () => {
      speakingRef.current = false;
      setSpeaking(false);
      // Hand the microphone back if it was on when we started.
      if (wasListening) {
        wantListeningRef.current = true;
        startListening();
      }
    };

    chunks.forEach((chunk) => {
      const utter = new SpeechSynthesisUtterance(chunk);
      if (chosen) utter.voice = chosen;
      utter.rate = 1.02;
      utter.pitch = 1;
      utter.onend = () => { if (--remaining <= 0) finish(); };
      utter.onerror = () => { if (--remaining <= 0) finish(); };
      window.speechSynthesis.speak(utter);
    });
  }, [voices, voiceURI, startListening]);

  // --- Cleanup -------------------------------------------------------------
  useEffect(() => () => {
    wantListeningRef.current = false;
    clearTimeout(silenceTimerRef.current);
    const rec = recognitionRef.current;
    if (rec) { try { rec.stop(); } catch { /* noop */ } }
    if (speechSupport.tts) window.speechSynthesis.cancel();
  }, []);

  return {
    listening, speaking, interim, error,
    voices, voiceURI, setVoiceURI,
    startListening, stopListening, speak, cancelSpeech,
    supported: speechSupport,
    clearError: () => setError(null),
  };
}

/**
 * Split into utterances the synthesiser will not truncate. Sentence
 * boundaries first; any sentence still too long is broken at a comma or,
 * failing that, at a word boundary.
 */
function chunkForSpeech(text, maxLen = 180) {
  const clean = stripForSpeech(text);
  const sentences = clean.match(/[^.!?]+[.!?]*/g) || [clean];
  const out = [];

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (sentence.length <= maxLen) { out.push(sentence); continue; }

    let rest = sentence;
    while (rest.length > maxLen) {
      const window = rest.slice(0, maxLen);
      const cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf(' '));
      const at = cut > 40 ? cut : maxLen;
      out.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) out.push(rest);
  }
  return out.filter(Boolean);
}

/** Markdown read aloud is noise. Strip it before speaking. */
function stripForSpeech(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' code block omitted. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
