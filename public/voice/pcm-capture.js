// AudioWorklet for the voice agent (src/voice/elevenlabs.ts): hands the microphone's samples to the
// page in blocks, which converts them to 16 kHz PCM and sends them to the ElevenLabs agent. Served
// from the page's own origin so the strict CSP (script-src 'self') allows it.
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length > 0) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
