// ============================================================
// content-script.js — Duo Tools (mundo isolado)
//
// Integra:
//   • Proxy de chamadas de API do Duolingo (para o farm de XP do Lazy)
//   • Bridge de configurações para o page-patch.js (Modo Super)
//   • Relay de patch requests: page-patch.js → background → page-patch.js
//   • Bridge de mensagens popup → injected.js (Resolver exercício do Autolingo)
// ============================================================

(function () {
  'use strict';

  // ─── 1. Proxy de API do Duolingo (Duolingo-Lazy) ─────────
  // O background.js não consegue enviar cookies do Duolingo nas requests.
  // O content-script roda na origem do Duolingo, consegue fazer fetch
  // com cookies incluídos e repassa a resposta de volta ao background.

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    // Ping: responde ao background para confirmar que o content script está ativo
    if (message.action === 'ping') {
      sendResponse({ ok: true });
      return true;
    }

    // Proxy de chamadas à API do Duolingo (pedido pelo background para o farm de XP)
    if (message.action === 'duolingo_api') {
      const { url, method, headers, body } = message;

      fetch(url, {
        method: method,
        headers: headers,
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'include'
      })
        .then(async (response) => {
          const responseBody = await response.text();
          sendResponse({
            ok: response.ok,
            status: response.status,
            body: responseBody
          });
        })
        .catch((error) => {
          sendResponse({ ok: false, error: error.message });
        });

      return true; // resposta assíncrona
    }

    // ─── Resolver exercício (Autolingo) ──────────────────────
    // O background redireciona mensagens do popup para cá; nós as repassamos
    // ao injected.js via CustomEvent (igual ao init.js do Autolingo)

    if (message.action === 'solve_challenge') {
      sendCustomEvent('solve_challenge');
      sendResponse({ ok: true });
      return true;
    }

    if (message.action === 'solve_skip_challenge') {
      sendCustomEvent('solve_skip_challenge');
      sendResponse({ ok: true });
      return true;
    }

    if (message.action === 'stop_solve_skip_challenge') {
      sendCustomEvent('stop_solve_skip_challenge');
      sendResponse({ ok: true });
      return true;
    }

    if (message.action === 'set_delay') {
      sendCustomEvent('set_delay', message.delay);
      sendResponse({ ok: true });
      return true;
    }

    if (message.action === 'toggle_widget_visibility') {
      if (message.enabled) {
        createWidget();
      } else {
        removeWidget();
      }
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });

  // ─── 2. Bridge de configurações para o page-patch.js ─────
  // O page-patch.js roda no mundo da página (MAIN) e não tem acesso ao
  // chrome.storage. Mandamos as configs via postMessage.

  const SETTINGS_KEYS = ['superModeEnabled'];

  function pushSettingsToPageWorld() {
    chrome.storage.sync.get(SETTINGS_KEYS, (settings) => {
      window.postMessage({ source: 'duo-tools', type: 'SETTINGS', settings }, '*');
    });
  }

  pushSettingsToPageWorld();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (SETTINGS_KEYS.some(k => k in changes)) pushSettingsToPageWorld();
  });

  // ─── 3. Relay de patch: page-patch.js → background → page-patch.js ─
  // O page-patch.js (MAIN world) não pode chamar chrome.runtime.sendMessage.
  // Ele manda via postMessage para cá, nós fazemos o fetch/patch no background,
  // e devolvemos o resultado via postMessage de volta para o page-patch.js.

  // Ouve o redimensionamento dinâmico do widget flutuante
  window.addEventListener('message', (event) => {
    if (event.data?.source === 'duo-tools-widget' && event.data?.type === 'resize') {
      if (widgetIframe) {
        const maxH = window.innerHeight - 100;
        const newH = Math.min(event.data.height, maxH);
        widgetIframe.style.height = newH + 'px';
      }
    }
  });

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (event.data?.source !== 'duo-tools-request-patch') return;

    const { url } = event.data;
    if (!url) return;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_AND_PATCH',
        url: url,
        patchMode: 1  // Patch mode 1: gold_subscription + hasPlus
      });

      if (response && response.ok && response.patched) {
        window.postMessage({
          source: 'duo-tools-patched',
          url: url,
          patched: response.patched
        }, '*');
      } else {
        // Devolve null para que o page-patch.js injete o original
        window.postMessage({
          source: 'duo-tools-patched',
          url: url,
          patched: null
        }, '*');
      }
    } catch (error) {
      console.warn('[Duo Tools] Patch relay falhou para:', url, error);
      window.postMessage({
        source: 'duo-tools-patched',
        url: url,
        patched: null
      }, '*');
    }
  });

  // ─── 4. Injeta injected.js no mundo da página (Autolingo) ──
  // O injected.js precisa rodar no mundo da página para acessar os internals
  // do React. Fazemos a injeção da mesma forma que o init.js do Autolingo.

  function injectScript(fileName) {
    const s = document.createElement('script');
    s.setAttribute('type', 'module');
    s.setAttribute('src', chrome.runtime.getURL(fileName));
    (document.head || document.documentElement || document.body).appendChild(s);
  }

  function sendCustomEvent(eventName, data = null) {
    const event = document.createEvent('CustomEvent');
    event.initCustomEvent(eventName, true, true, { data });
    document.dispatchEvent(event);
  }

  async function getAssetDataUrl(fileName) {
    const response = await fetch(chrome.runtime.getURL(fileName));
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Injeta o script no mundo da página (igual ao Autolingo init.js)
  let isScriptInjected = false;
  if (!isScriptInjected) {
    injectScript('content_scripts/injected.js');
    isScriptInjected = true;
  }

  // Responde ao pedido do injected.js por ID da extensão e assets
  window.addEventListener('get_extension_id', async () => {
    const extensionId = chrome.runtime.id;
    sendCustomEvent('extension_id', extensionId);

    try {
      const [tierIconUrl, legendaryIconUrl] = await Promise.all([
        getAssetDataUrl('images/diamond-league.png').catch(() => null),
        getAssetDataUrl('images/legendary.svg').catch(() => null),
      ]);
      if (tierIconUrl && legendaryIconUrl) {
        sendCustomEvent('set_icon_assets', { tierIconUrl, legendaryIconUrl });
      }
    } catch (error) {
      console.warn('[Duo Tools] Não foi possível carregar ícones do Autolingo:', error);
    }

    // Lê estado inicial (sem paywall — tudo liberado)
    chrome.storage.local.get(['autolingoEnabled', 'autolingo_delay'], (response) => {
      const isEnabled = Boolean(response['autolingoEnabled']);
      const delay = typeof response['autolingo_delay'] === 'number' ? response['autolingo_delay'] : 500;

      console.log('[Duo Tools] Estado inicial do solver:', { isEnabled, delay });

      // isPaid = true, isTrialActive = true: sempre liberado, sem paywall
      sendCustomEvent('set_initial_state', {
        isPaid: true,
        isTrialActive: true,
        isEnabled,
        delay
      });
    });
  });

  // Propaga mudanças de storage para o injected.js
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      if (changes.autolingoEnabled) {
        const isEnabled = changes.autolingoEnabled.newValue;
        if (isEnabled) {
          sendCustomEvent('enable_automation');
        } else {
          sendCustomEvent('disable_automation');
        }
      }
      if (changes.autolingo_delay) {
        sendCustomEvent('set_delay', changes.autolingo_delay.newValue);
      }
    }
  });

  // ─── 5. Injeta o Widget Flutuante (Iframe) ────────────────
  let widgetContainer = null;
  let widgetIframe = null;
  let widgetButton = null;

  function initWidget() {
    chrome.storage.sync.get(['widgetEnabled'], (res) => {
      if (res.widgetEnabled !== false) {
        createWidget();
      }
    });
  }

  function createWidget() {
    if (widgetContainer) return;

    widgetContainer = document.createElement('div');
    widgetContainer.id = 'duo-tools-widget-container';
    widgetContainer.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 999999;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 12px;
    `;

    const maxIframeHeight = window.innerHeight - 100;
    const desiredHeight = 635; // Ajustado para caber o footer completo sem scroll
    const isSmallScreen = maxIframeHeight < desiredHeight;
    const iframeWidth = isSmallScreen ? '660px' : '340px';
    const iframeHeight = isSmallScreen ? Math.max(340, maxIframeHeight) + 'px' : desiredHeight + 'px';

    widgetIframe = document.createElement('iframe');
    widgetIframe.src = chrome.runtime.getURL('widget.html');
    widgetIframe.style.cssText = `
      width: ${iframeWidth};
      height: ${iframeHeight};
      border: none;
      border-radius: 16px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      display: none;
      background: #131f24;
      transition: opacity 0.2s, transform 0.2s, height 0.2s ease-out;
      opacity: 0;
      transform: translateY(10px);
    `;

    widgetButton = document.createElement('button');
    widgetButton.style.cssText = `
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: none;
      background: #202f36;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      transition: transform 0.2s;
    `;
    widgetButton.onmouseover = () => widgetButton.style.transform = 'scale(1.05)';
    widgetButton.onmouseout = () => widgetButton.style.transform = 'scale(1)';

    const iconImg = document.createElement('img');
    iconImg.src = chrome.runtime.getURL('icons/icon48.png');
    iconImg.style.width = '100%';
    iconImg.style.height = '100%';
    iconImg.style.objectFit = 'cover';
    iconImg.style.borderRadius = '50%';
    widgetButton.appendChild(iconImg);

    let isWidgetOpen = false;
    widgetButton.addEventListener('click', () => {
      isWidgetOpen = !isWidgetOpen;
      if (isWidgetOpen) {
        widgetIframe.style.display = 'block';
        setTimeout(() => {
          widgetIframe.style.opacity = '1';
          widgetIframe.style.transform = 'translateY(0)';
        }, 10);
      } else {
        widgetIframe.style.opacity = '0';
        widgetIframe.style.transform = 'translateY(10px)';
        setTimeout(() => {
          if (!isWidgetOpen) widgetIframe.style.display = 'none';
        }, 200);
      }
    });

    widgetContainer.appendChild(widgetIframe);
    widgetContainer.appendChild(widgetButton);
    document.body.appendChild(widgetContainer);
  }

  function removeWidget() {
    if (widgetContainer) {
      widgetContainer.remove();
      widgetContainer = null;
      widgetIframe = null;
      widgetButton = null;
    }
  }

  if (document.body) {
    initWidget();
  } else {
    document.addEventListener('DOMContentLoaded', initWidget);
  }

})();
