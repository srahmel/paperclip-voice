import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Optional existing Paperclip dev dependencies; never installs browsers/packages.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hostRoot = process.argv[2];
if (!hostRoot) throw new Error('Usage: node tests/browser/voice-state.browser.mjs <paperclip-checkout> [msedge|chrome]');
const host = createRequire(path.resolve(hostRoot, 'package.json'));
const ui = createRequire(path.resolve(hostRoot, 'ui/package.json'));
const { chromium } = host('@playwright/test');
const bundle = await build({
  absWorkingDir: root, entryPoints: ['tests/browser/fixture.tsx'], bundle: true, write: false, format: 'iife', jsx: 'automatic',
  alias: { react: path.dirname(ui.resolve('react/package.json')), 'react-dom': path.dirname(ui.resolve('react-dom/package.json')) },
  plugins: [{ name:'fake-host-location', setup(build) {
    build.onResolve({filter:/^@paperclipai\/plugin-sdk\/ui$/}, () => ({path:'host', namespace:'fixture'}));
    build.onLoad({filter:/.*/, namespace:'fixture'}, () => ({loader:'js', resolveDir:root, contents:`
      import {useSyncExternalStore} from 'react';
      const subscribe = fn => { window.addEventListener('fixture-navigation', fn); return () => window.removeEventListener('fixture-navigation', fn); };
      export function useHostLocation() { const pathname = useSyncExternalStore(subscribe, () => location.pathname); return {pathname}; }
    `}));
  } }],
});

function wav(seconds = 3) {
  const rate = 24000, samples = Math.round(rate * seconds), buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16,16); buffer.writeUInt16LE(1,20); buffer.writeUInt16LE(1,22);
  buffer.writeUInt32LE(rate,24); buffer.writeUInt32LE(rate*2,28); buffer.writeUInt16LE(2,32); buffer.writeUInt16LE(16,34);
  buffer.write('data',36); buffer.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++) buffer.writeInt16LE(Math.round(Math.sin(i/rate*440*2*Math.PI)*6000),44+i*2);
  return buffer;
}
let posted = false, speechFailure = false, holdReply = false, releaseReply, replyRequested = false;
const calls = [];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    calls.push({method:req.method, path:url.pathname});
    const json = data => { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(data)); };
    if (url.pathname === '/fixture.js') { res.setHeader('Content-Type','text/javascript'); res.end(bundle.outputFiles[0].contents); return; }
    if (url.pathname === '/api/instance/settings/experimental') {
      assert.equal(req.method, 'GET'); json({enableAgentChat:true}); return;
    }
    if (/^\/api\/companies\/[^/]+\/chats\/[^/]+$/.test(url.pathname)) {
      assert.equal(req.method, 'GET'); const companyId=url.pathname.split('/')[3];
      json({id:`issue-${companyId}`, companyId, conversationAgentId:'agent-a'}); return;
    }
    if (url.pathname === '/api/issues/TEST-2') { json({id:'issue-2', companyId:'company-a', assigneeAgentId:'agent-b'}); return; }
    if (url.pathname.endsWith('/comments')) {
      if (req.method === 'POST') { posted = true; json({id:'user-1'}); return; }
      json([...(posted ? [{id:'reply-1',authorAgentId:'agent-a',body:'Synthetic reply.'}] : []), {id:'historic',authorAgentId:'agent-a',body:'Old reply must stay silent.'}]); return;
    }
    if (url.pathname.endsWith('/local-dictation')) { json({text:'Synthetic request.'}); return; }
    if (url.pathname.endsWith('/local-speech')) {
      const text = JSON.parse(body).text;
      assert.notEqual(text, 'Old reply must stay silent.');
      if (text === 'Synthetic reply.') {
        replyRequested = true;
        if (holdReply) await new Promise(resolve => { releaseReply = resolve; });
      }
      if (speechFailure) { res.statusCode = 503; json({error:'synthetic failure'}); return; }
      res.setHeader('Content-Type','audio/wav'); res.end(wav(text === 'Synthetic reply.' ? 4 : 0.15)); return;
    }
    if (url.pathname.startsWith('/api/')) { res.statusCode=404; json({error:'unexpected synthetic endpoint'}); return; }
    res.setHeader('Content-Type','text/html'); res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="--border:#ddd;--popover:#fff;--popover-foreground:#111;--muted-foreground:#555;--primary:#222;--primary-foreground:#fff;--secondary:#eee;--secondary-foreground:#111;--background:#fff;--foreground:#111;font-family:Arial"><div data-testid="task-chat-composer-actions"><span data-testid="local-dictation">Synthetic composer</span></div><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  } catch (error) { res.statusCode=500; res.end('Synthetic fixture assertion failed'); console.error(error); }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const failures = [];
try {
  browser = await chromium.launch({channel:process.argv[3] || 'msedge', headless:true, args:['--autoplay-policy=no-user-gesture-required','--mute-audio']});
  const page = await browser.newPage({viewport:{width:390,height:844}});
  page.on('pageerror', error => failures.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  const last = () => page.evaluate(() => window.voiceEvents.at(-1));
  const waitPhase = phase => page.waitForFunction(phase => window.voiceEvents.at(-1)?.phase === phase, phase, {timeout:15000});
  const reset = async () => {
    releaseReply?.(); releaseReply=undefined; posted=false; speechFailure=false; holdReply=false; replyRequested=false;
    await page.goto(`${origin}/TEST/chats/friendly-agent`);
    await page.getByRole('button',{name:'Voice mode',exact:true}).click();
    await page.locator('#voice-language').selectOption('en');
  };
  const start = async () => { await page.getByRole('button',{name:'Start voice mode',exact:true}).click(); await waitPhase('listening'); };
  const utterance = async () => {
    await page.evaluate(() => window.inputEnergy(0.2));
    await page.waitForTimeout(700);
    assert.equal((await last()).speechEnergy,0,'microphone energy is never reply energy');
    await page.evaluate(() => window.inputEnergy(0));
  };
  const tracksEnded = () => page.evaluate(() => window.captureTracks.every(track => track.readyState === 'ended'));
  const noLateSpeaking = async () => { await page.waitForTimeout(250); assert.equal((await last()).speechEnergy,0); assert.notEqual((await last()).phase,'speaking'); };

  await reset(); await start();
  await page.getByRole('button',{name:'Close panel',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Voice mode',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'Voice mode',exact:true}).click();
  await waitPhase('listening');
  const listening = await last();
  assert.equal(listening.conversationId,'issue-company-a'); assert.equal(listening.agentId,'agent-a');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('paperclip-companion:voice-state-request:v1',{detail:{version:1,companyId:'company-a',conversationId:'issue-company-a'}})));
  assert.equal((await last()).sequence,listening.sequence+1);
  await utterance();
  await page.waitForFunction(() => window.voiceEvents.at(-1)?.phase === 'speaking' && window.voiceEvents.at(-1)?.speechEnergy > 0.1, null, {timeout:15000});
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  assert.equal((await last()).phase,'off'); assert.equal(await tracksEnded(),true); await noLateSpeaking();
  console.log('PASS: real MediaRecorder/VAD, native fake transport, actual reply analyser, snapshot and stop');

  await reset(); holdReply=true; await start(); await utterance();
  await assert.doesNotReject(async () => { const deadline=Date.now()+15000; while(!replyRequested && Date.now()<deadline) await page.waitForTimeout(50); assert.ok(replyRequested); });
  const oldSession = (await last()).sessionId;
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await start(); const nextSession=(await last()).sessionId; assert.notEqual(nextSession,oldSession);
  releaseReply(); holdReply=false;
  await noLateSpeaking(); assert.equal((await last()).sessionId,nextSession); assert.equal((await last()).phase,'listening');
  console.log('PASS: delayed speech response cannot restart an old session or replace the new one');

  await page.evaluate(() => window.navigateVoiceFixture('/TEST/issues/TEST-2'));
  assert.equal(await tracksEnded(),true); await noLateSpeaking();
  await page.getByRole('button',{name:'Voice mode',exact:true}).click();
  await start(); assert.equal((await last()).conversationId,'issue-2'); assert.equal((await last()).agentId,null);
  await page.evaluate(() => window.navigateVoiceFixture('/OTHER/chats/friendly-agent','company-b'));
  await page.waitForFunction(() => window.captureTracks.every(track => track.readyState==='ended'));
  await noLateSpeaking();
  console.log('PASS: SPA conversation and company navigation release capture and clear the old context');

  await reset(); speechFailure=true; await start(); await utterance(); await waitPhase('error');
  assert.equal((await last()).speechEnergy,0); assert.equal(await tracksEnded(),true); await noLateSpeaking();
  console.log('PASS: output failure releases the microphone and publishes terminal error with zero energy');

  await reset(); await start(); await utterance();
  await page.waitForFunction(() => window.voiceEvents.at(-1)?.phase==='speaking' && window.voiceEvents.at(-1)?.speechEnergy>0.1);
  await page.evaluate(() => window.navigateVoiceFixture('/TEST/issues/TEST-2'));
  await noLateSpeaking(); assert.equal(await tracksEnded(),true);
  console.log('PASS: navigation during real output immediately ends speaking');

  await reset(); await start();
  await page.evaluate(() => document.documentElement.lang='de');
  await page.getByRole('button',{name:'Stoppen',exact:true}).waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await noLateSpeaking(); assert.equal(await tracksEnded(),true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  const events=await page.evaluate(() => window.voiceEvents);
  for (const event of events) assert.deepEqual(Object.keys(event).sort(), ['version','companyId','conversationId','agentId','sessionId','sequence','phase','speechEnergy'].sort());
  for (let i=1;i<events.length;i++) if(events[i].sessionId===events[i-1].sessionId) assert.ok(events[i].sequence>events[i-1].sequence);
  assert.deepEqual(failures,[]);
  assert.equal(calls.some(call => call.path.includes('experimental') && call.method!=='GET'),false);
  assert.equal(calls.some(call => /\/chats\/[^/]+$/.test(call.path) && call.method!=='GET'),false);
  console.log('PASS: pagehide, host language change, 390px layout, event schema, no settings/chat writes');
  console.log(`Browser: ${browser.version()}; all transports and source contents synthetic; no physical-device claim.`);
} finally {
  releaseReply?.();
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
