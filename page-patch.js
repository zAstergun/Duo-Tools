// ============================================================
// page-patch.js — Duo Tools (mundo MAIN / página)
//
// Roda no MAIN world ("world": "MAIN" no manifest).
// NÃO tem acesso ao chrome.* — usa window.postMessage para se
// comunicar com o content-script.js (mundo isolado).
//
// Integra:
//   • Modo Super (Unlimited-Hearts): intercepta scripts de chunk,
//     pede ao content-script para buscar versão patchada via background,
//     e executa o código patchado em vez do original.
//   • page_hook.js (Unlimited-Hearts): bloqueia scripts de chunk antes
//     de serem adicionados ao DOM.
// ============================================================

(function () {
  'use strict';

  // ─── Estado ──────────────────────────────────────────────────
  let superModeEnabled = false;  // controlado via postMessage do content-script
  const CHUNK_RE = /(^|\/)(app|\d{3,5})[^/]*\.js(\?.*)?$/i;
  const processed = new Set();
  const executed = new Set();
  const codeMap = new Map();
  const queue = [];
  let appReady = false;
  const APP_RE = /^app([.-].*|)\.js(\?.*|)?$/i;

  // ─── 1. Recebe estado e patches do content-script.js ─────────

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d) return;

    // Atualiza estado do Modo Super (vindo do content-script.js)
    if (d.source === 'duo-tools' && d.type === 'SETTINGS') {
      superModeEnabled = !!d.settings.superModeEnabled;
      return;
    }

    // Recebe código patchado do content-script.js
    if (d.source === 'duo-tools-patched' && d.url) {
      if (d.patched) {
        codeMap.set(d.url, d.patched);
        if (isAppUrl(d.url)) {
          execPatched(d.url, d.patched);
        } else {
          flushQueue();
        }
      } else {
        // Patch falhou: injeta original sem patch
        codeMap.set(d.url, '/* patch failed */');
        if (isAppUrl(d.url)) {
          injectOriginal(d.url);
        } else {
          flushQueue();
        }
      }
      return;
    }
  });

  // ─── 2. Page hook (Unlimited-Hearts: page_hook.js) ───────────
  // Intercepta adição de scripts de chunk ao DOM.

  if (!window.__DUO_TOOLS_PAGE_HOOK__) {
    window.__DUO_TOOLS_PAGE_HOOK__ = true;

    const origAppend = Element.prototype.appendChild;
    const origInsertBefore = Element.prototype.insertBefore;

    function maybeBlock(node) {
      try {
        if (node?.tagName === 'SCRIPT' && node.src && CHUNK_RE.test(node.src)) {
          if (!superModeEnabled) return false; // se Super desligado, não bloqueia
          handleUrl(node.src);
          return true; // bloqueia o script original
        }
      } catch {}
      return false;
    }

    Element.prototype.appendChild = function (child) {
      if (maybeBlock(child)) return child;
      return origAppend.call(this, child);
    };

    Element.prototype.insertBefore = function (child, ref) {
      if (maybeBlock(child)) return child;
      return origInsertBefore.call(this, child, ref);
    };
  }

  // ─── 3. Injection engine (Unlimited-Hearts: injection.js) ────

  function isAppUrl(url) {
    return APP_RE.test((url || '').split('/').pop() || '');
  }

  function injectOriginal(url) {
    if (executed.has(url)) return;
    const s = document.createElement('script');
    s.src = url;
    s.async = false;
    s.onload = () => {
      if (isAppUrl(url) && !appReady) {
        appReady = true;
        window.dispatchEvent(new Event('ext-app-ready'));
        flushQueue();
      }
    };
    (document.head || document.documentElement).appendChild(s);
    executed.add(url);
  }

  function execPatched(url, code) {
    if (executed.has(url)) return true;
    try {
      const blob = new Blob([code], { type: 'application/javascript' });
      const s = document.createElement('script');
      s.src = URL.createObjectURL(blob);
      s.async = false;
      s.onload = () => {
        if (isAppUrl(url) && !appReady) {
          appReady = true;
          window.dispatchEvent(new Event('ext-app-ready'));
          flushQueue();
        }
      };
      (document.head || document.documentElement).appendChild(s);
      executed.add(url);
      return true;
    } catch {
      try {
        (new Function(code + '\n//# sourceURL=patched-' + (url.split('/').pop() || 'chunk')))();
        executed.add(url);
        if (isAppUrl(url) && !appReady) {
          appReady = true;
          window.dispatchEvent(new Event('ext-app-ready'));
          flushQueue();
        }
        return true;
      } catch (e) {
        console.warn('[Duo Tools] exec patched failed', url, e);
        return false;
      }
    }
  }

  function flushQueue() {
    if (!appReady) return;
    for (const url of queue) {
      if (executed.has(url)) continue;
      const code = codeMap.get(url);
      if (code) execPatched(url, code);
    }
    for (let i = queue.length - 1; i >= 0; i--) {
      if (executed.has(queue[i])) queue.splice(i, 1);
    }
  }

  function handleUrl(url) {
    if (!url || processed.has(url) || !CHUNK_RE.test(url)) return;
    if (!superModeEnabled) {
      // Modo Super desligado: injeta original
      injectOriginal(url);
      return;
    }

    processed.add(url);
    if (!queue.includes(url)) queue.push(url);

    // Pede ao content-script.js (mundo isolado) para buscar o patch via background
    window.postMessage({
      source: 'duo-tools-request-patch',
      url: url
    }, '*');
  }

  window.addEventListener('ext-app-ready', flushQueue);

  // ─── 4. Scan de scripts já no DOM ───────────────────────────

  function scan() {
    if (!superModeEnabled) return;
    for (const sc of document.getElementsByTagName('script')) {
      if (sc.src && CHUNK_RE.test(sc.src) && !processed.has(sc.src)) {
        sc.remove();
        handleUrl(sc.src);
      }
    }
  }

  if (document.readyState === 'loading') {
    scan();
    document.addEventListener('DOMContentLoaded', scan, { once: true });
  } else {
    scan();
  }

  const mo = new MutationObserver(muts => {
    for (const m of muts) {
      for (const n of (m.addedNodes || [])) {
        if (n && n.tagName === 'SCRIPT' && n.src && CHUNK_RE.test(n.src) && superModeEnabled) {
          n.remove();
          handleUrl(n.src);
        }
      }
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

})();
