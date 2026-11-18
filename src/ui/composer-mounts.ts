import { useEffect, useState } from 'react';

export type DraftBinding = {
  id: number;
  editor: HTMLElement;
  root: HTMLElement;
  anchor: HTMLElement;
  mount: HTMLElement;
};

function usable(node: HTMLElement): boolean {
  return node.isConnected && node.getClientRects().length > 0 && !node.closest('[inert], [aria-hidden="true"]');
}

/** A deliberately narrow host-DOM adapter. Never inspect React/Lexical internals. */
function composerFor(anchor: HTMLElement): { root: HTMLElement; editor: HTMLElement } | null {
  if (!usable(anchor)) return null;
  let root = anchor.parentElement;
  for (let depth = 0; root && depth < 6; depth++, root = root.parentElement) {
    const inputs = root.querySelectorAll<HTMLElement>('[data-testid="task-chat-composer-input"]');
    const actions = root.querySelectorAll('[data-testid="task-chat-composer-actions"]');
    if (inputs.length > 1 || actions.length > 1) return null;
    if (inputs.length !== 1 || actions.length !== 1) continue;
    const editors = [...inputs[0].querySelectorAll<HTMLElement>('.paperclip-mdxeditor-content[contenteditable="true"], textarea:not([readonly]):not([disabled])')].filter(usable);
    return editors.length === 1 ? { root, editor: editors[0] } : null;
  }
  return null;
}

export function useVoiceMounts(companyId: string, pathname: string) {
  const [drafts, setDrafts] = useState<DraftBinding[]>([]);
  const [navigation, setNavigation] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setDrafts([]); setNavigation(null);
    if (!companyId) return;
    let sequence = 0;
    const mounted = new Map<HTMLElement, DraftBinding>();
    let nav: { anchor: HTMLElement; mount: HTMLElement } | null = null;
    let frame: number | null = null;
    const sync = () => {
      frame = null;
      let changed = false;
      for (const [anchor, binding] of mounted) {
        const candidate = composerFor(anchor);
        if (!candidate || candidate.editor !== binding.editor || !binding.mount.isConnected || anchor.nextElementSibling !== binding.mount) {
          binding.mount.remove(); mounted.delete(anchor); changed = true;
        }
      }
      for (const anchor of document.querySelectorAll<HTMLElement>('[data-testid="task-chat-composer-actions"] [data-testid="task-chat-composer-add"]')) {
        if (mounted.has(anchor)) continue;
        const candidate = composerFor(anchor);
        if (!candidate) continue;
        const mount = document.createElement('span');
        mount.dataset.paperclipVoiceComposer = 'true';
        mount.style.cssText = 'display:inline-flex;align-items:center;gap:2px;flex-shrink:0';
        anchor.insertAdjacentElement('afterend', mount);
        mounted.set(anchor, { ...candidate, anchor, mount, id: ++sequence }); changed = true;
      }
      if (changed) setDrafts([...mounted.values()]);
      document.documentElement.toggleAttribute('data-paperclip-voice-composers', mounted.size > 0);
      const prefix = pathname.match(/^\/([a-zA-Z0-9_-]+)(?:\/|$)/)?.[1];
      const links = prefix ? [...document.querySelectorAll<HTMLElement>(`a[href="/${prefix}/chats"]`)].filter(node => node.getClientRects().length > 0) : [];
      const anchor = links.length === 1 ? links[0] : null;
      if (nav && (nav.anchor !== anchor || !nav.mount.isConnected || nav.anchor.nextElementSibling !== nav.mount)) {
        nav.mount.remove(); nav = null; setNavigation(null);
      }
      if (!nav && anchor) {
        const mount = document.createElement('div'); mount.dataset.paperclipVoiceNavigation = 'true';
        anchor.insertAdjacentElement('afterend', mount); nav = { anchor, mount }; setNavigation(mount);
      }
      document.documentElement.toggleAttribute('data-paperclip-voice-navigation', Boolean(nav));
    };
    // Streaming task messages mutate frequently; scan at most eight times/sec.
    const schedule = () => { if (frame === null) frame = window.setTimeout(sync, 125); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-hidden', 'inert', 'contenteditable', 'disabled'] });
    sync();
    return () => {
      observer.disconnect(); if (frame !== null) window.clearTimeout(frame);
      for (const binding of mounted.values()) binding.mount.remove();
      nav?.mount.remove();
      document.documentElement.removeAttribute('data-paperclip-voice-composers');
      document.documentElement.removeAttribute('data-paperclip-voice-navigation');
    };
  }, [companyId, pathname]);
  return { drafts, navigation };
}

/** Append plain text only, through the browser editing path so the host sees input. */
export function appendDictation(binding: DraftBinding, text: string): void {
  const { editor, anchor } = binding;
  if (!text.trim() || !usable(editor) || composerFor(anchor)?.editor !== editor) throw new Error('Die ursprüngliche Eingabe ist nicht mehr verfügbar. Das Transkript bleibt hier erhalten.');
  editor.focus();
  if (editor instanceof HTMLTextAreaElement) {
    const before = editor.value;
    const value = before + (before && !/\s$/.test(before) ? ' ' : '') + text.trim();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!setter) throw new Error('Die Eingabe unterstützt kein Diktat. Bitte den Text aus der Vorschau übernehmen.');
    setter.call(editor, value);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.setSelectionRange(value.length, value.length);
    return;
  }
  const before = editor.innerText;
  const selection = window.getSelection();
  if (!selection || typeof document.execCommand !== 'function') throw new Error('Der Browser unterstützt das Einfügen hier nicht. Das Transkript bleibt in der Vorschau.');
  const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
  selection.removeAllRanges(); selection.addRange(range);
  const insertion = (before.trim() && !/\s$/.test(before) ? ' ' : '') + text.trim();
  const inserted = document.execCommand('insertText', false, insertion);
  if (!inserted && editor.innerText === before) throw new Error('Einfügen wurde nicht bestätigt. Bitte den Text aus der Vorschau übernehmen.');
}
