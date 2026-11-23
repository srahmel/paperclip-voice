import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { audioWorkerEnvironment, packageRoot } from './local-python.mjs';

export const MAX_STREAM_CHUNK_BYTES = 32_000;

export function configuredStream(config) {
  return config.backend === 'python' && Boolean(config.moonshinePython && config.moonshineModelDir);
}

export function localStreamReady(config) {
  return configuredStream(config) && existsSync(config.moonshinePython) && existsSync(config.moonshineModelDir);
}

export class LocalSpeechStream {
  constructor(config, { onClose = () => {} } = {}) {
    this.pending = null;
    this.closed = false;
    this.output = '';
    const systemRoot = config.windowsSystemRoot || process.env.SystemRoot || process.env.WINDIR;
    this.child = spawn(config.moonshinePython, [join(packageRoot(), 'dictation', 'stream-transcribe.py')], {
      shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
      env: audioWorkerEnvironment({ PAPERCLIP_MOONSHINE_MODEL: config.moonshineModelDir, ...(systemRoot ? { SystemRoot: systemRoot, WINDIR: systemRoot } : {}) }),
    });
    this.done = new Promise(resolve => this.child.once('close', () => { this.close(); onClose(); resolve(); }));
    this.child.on('error', () => this.close());
    this.child.stdin.on('error', () => this.close());
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.receive(chunk));
  }

  receive(chunk) {
    if (this.closed) return;
    this.output += chunk;
    const newline = this.output.indexOf('\n');
    if (!this.pending || this.output.length > 65_536 || (newline >= 0 && newline !== this.output.length - 1)) {
      this.close();
      return;
    }
    if (newline < 0) return;
    let result;
    try { result = JSON.parse(this.output); }
    catch { this.close(); return; }
    this.output = '';
    const request = this.pending;
    clearTimeout(request.timer);
    this.pending = null;
    request.resolve(result);
  }

  request(command, timeoutMs = 10_000) {
    if (this.closed) return Promise.reject(new Error('Local speech stream is closed'));
    if (this.pending) return Promise.reject(new Error('Local speech stream is busy'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(), timeoutMs);
      this.pending = { timer, resolve, reject };
      this.child.stdin.write(`${JSON.stringify(command)}\n`, error => { if (error) this.close(); });
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error('Local speech stream ended or failed'));
      this.pending = null;
    }
    this.output = '';
    this.child.stdin.destroy();
    this.child.kill();
  }
}
