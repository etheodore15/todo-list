// On-device AI worker: Whisper (speech-to-text) + Qwen3 0.6B (summaries).
// Runs in a Web Worker so model loading and inference never block the UI.
// The inference library is vendored locally (vendor/) so the app has no CDN
// dependency; model weights download once from the Hugging Face CDN and are
// cached on-device by transformers.js, so everything works offline after.
import { pipeline, env } from './vendor/transformers.min.js';

env.backends.onnx.wasm.wasmPaths = new URL('./vendor/', self.location.href).href;

const ASR_MODEL = 'onnx-community/whisper-base';
let LLM_MODEL = 'onnx-community/Qwen3-0.6B-ONNX';
let llmDtypeOverride = null; // test hook

let asr = null, llm = null, device = null, gpuHasF16 = false;

async function pickDevice(){
  if (device) return device;
  try {
    const adapter = self.navigator.gpu && await self.navigator.gpu.requestAdapter();
    if (adapter) {
      gpuHasF16 = adapter.features.has('shader-f16');
      device = 'webgpu';
      return device;
    }
  } catch (_) {}
  device = 'wasm';
  return device;
}

function progressCb(kind){
  // Aggregate per-file progress into a rough overall percentage.
  const files = {};
  return (p) => {
    if (p.status === 'progress' && p.total){
      files[p.file] = {loaded: p.loaded, total: p.total};
      let loaded = 0, total = 0;
      for (const f of Object.values(files)){ loaded += f.loaded; total += f.total; }
      self.postMessage({type: 'progress', kind, pct: Math.round(loaded / total * 100)});
    }
  };
}

async function loadASR(){
  if (asr) return;
  const dev = await pickDevice();
  asr = await pipeline('automatic-speech-recognition', ASR_MODEL, {
    device: dev,
    // fp32 encoder is the safe choice across mobile GPUs; q4 decoder keeps it small
    dtype: dev === 'webgpu' ? {encoder_model: 'fp32', decoder_model_merged: 'q4'} : 'q8',
    progress_callback: progressCb('asr'),
  });
}

async function loadLLM(){
  if (llm) return;
  const dev = await pickDevice();
  if (dev !== 'webgpu' && !llmDtypeOverride){
    throw new Error('this device has no GPU acceleration (WebGPU) — on-device summaries need a recent Android Chrome or iOS 26+ Safari');
  }
  llm = await pipeline('text-generation', LLM_MODEL, {
    device: dev,
    // q4f16 (570MB) needs GPU fp16 shader support; fall back to q4 otherwise
    dtype: llmDtypeOverride || (gpuHasF16 ? 'q4f16' : 'q4'),
    progress_callback: progressCb('llm'),
  });
}

async function summarize(text){
  const messages = [
    {role: 'system', content:
`You turn a voice-transcribed idea into a summary and todo tasks. Reply with ONLY a JSON object, no other text:
{"summary": "<one clear sentence, max 14 words>", "tasks": [{"text": "<short imperative task>", "priority": "high"|"medium"|"low", "tags": ["<category>"]}], "priority": "high"|"medium"|"low"}
Rules: extract ONLY actions the person actually intends to take (max 6) — never turn observations, feelings, or background context into tasks; if there is no action, "tasks" is an empty array; judge each task's priority by urgency and importance (high = today/blocking, medium = this week, low = someday/optional); give each task 1-3 short lowercase category tags for sorting (e.g. work, home, family, health, finance, shopping, calls, errands, car, travel, pets, social, tech) — every task needs at least one tag, use "general" if nothing fits; top-level priority = highest task priority. /no_think`},
    {role: 'user', content: text},
  ];
  const out = await llm(messages, {max_new_tokens: 512, do_sample: false, return_full_text: false});
  let reply = out[0].generated_text;
  if (Array.isArray(reply)) reply = reply.at(-1).content;
  reply = String(reply).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const start = reply.indexOf('{'), end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON in model output');
  return JSON.parse(reply.slice(start, end + 1));
}

self.onmessage = async (e) => {
  const {id, type, payload} = e.data;
  try {
    let result;
    switch (type){
      case 'config':
        // test hook: point the model hub somewhere else (e.g. a local server)
        if (payload.remoteHost) env.remoteHost = payload.remoteHost;
        if (payload.device) device = payload.device;
        if (payload.llmModel) LLM_MODEL = payload.llmModel;
        if (payload.llmDtype) llmDtypeOverride = payload.llmDtype;
        result = {};
        break;
      case 'load-asr':
        await loadASR();
        result = {device};
        break;
      case 'load-llm':
        await loadLLM();
        result = {device};
        break;
      case 'transcribe': {
        await loadASR();
        const out = await asr(payload.audio, {language: 'english', task: 'transcribe'});
        result = {text: String(out.text || '').trim()};
        break;
      }
      case 'summarize':
        await loadLLM();
        result = {json: await summarize(payload.text)};
        break;
      default:
        throw new Error('unknown message type: ' + type);
    }
    self.postMessage({id, type: 'done', result});
  } catch (err){
    self.postMessage({id, type: 'error', message: err && err.message || String(err)});
  }
};
