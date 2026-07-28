// ============================================================
// content-script.js — Duo Tools (mundo isolado)
//
// Integra:
//   • Proxy de chamadas de API do Duolingo (para o farm de XP)
//   • Bridge de configurações para o page-patch.js (Modo Super)
//   • Relay de patch requests: page-patch.js → background → page-patch.js
//   • Bridge de mensagens popup → injected.js (Resolver exercício)
// ============================================================

(function () {
  'use strict';

  function isExtensionContextValid() {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  // ─── 1. Proxy de API do Duolingo ─────────────────────────
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

    if (message.action === 'start_auto_sequence') {
      sendCustomEvent('start_auto_sequence', { target: message.target, legendary: message.legendary, finishSection: message.finishSection });
      sendResponse({ ok: true });
      return true;
    }

    if (message.action === 'stop_auto_sequence') {
      sendCustomEvent('stop_auto_sequence');
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
    if (!isExtensionContextValid()) return;
    try {
      chrome.storage.sync.get(SETTINGS_KEYS, (settings) => {
        if (chrome.runtime.lastError || !settings) return;
        window.postMessage({ source: 'duo-tools', type: 'SETTINGS', settings }, '*');
      });
    } catch (e) {}
  }

  pushSettingsToPageWorld();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (!isExtensionContextValid() || area !== 'sync') return;
    if (SETTINGS_KEYS.some(k => k in changes)) pushSettingsToPageWorld();
  });

  // ─── 3. Relay de patch: page-patch.js → background → page-patch.js ─
  // O page-patch.js (MAIN world) não pode chamar chrome.runtime.sendMessage.
  // Ele manda via postMessage para cá, nós fazemos o fetch/patch no background,
  // e devolvemos o resultado via postMessage de volta para o page-patch.js.

  // Ouve o redimensionamento dinâmico do widget flutuante
  window.addEventListener('message', (event) => {
    if (!isExtensionContextValid()) return;
    if (event.data?.source === 'duo-tools-widget' && event.data?.type === 'resize') {
      if (widgetIframe) {
        const maxH = window.innerHeight - 100;
        const newH = Math.min(event.data.height, maxH);
        widgetIframe.style.height = newH + 'px';
      }
    }
    if (event.data?.type === 'RELOAD_PAGE') {
      window.location.reload();
    }
    if (event.data?.type === 'START_AUTO_SEQUENCE') {
      sendCustomEvent('start_auto_sequence', { target: event.data.target, legendary: event.data.legendary, finishSection: event.data.finishSection });
    }
    if (event.data?.type === 'STOP_AUTO_SEQUENCE') {
      sendCustomEvent('stop_auto_sequence');
    }
    if (event.data?.type === 'UPDATE_AUTO_SEQ_CONFIG') {
      sendCustomEvent('update_auto_seq_config', event.data.config || {});
    }
    if (event.data?.source === 'duo-tools-seq-progress') {
      const updates = {};
      if (event.data.autoSeqState) updates.autoSeqState = event.data.autoSeqState;
      if (event.data.autoSeqConfig) updates.autoSeqConfig = event.data.autoSeqConfig;
      if (Object.keys(updates).length > 0) {
        try {
          chrome.storage.local.set(updates).catch(() => {});
        } catch (e) {}
      }
    }
  });

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (event.data?.source !== 'duo-tools-request-patch') return;
    if (!isExtensionContextValid()) return;

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
      const errMsg = String(error?.message || error || '');
      if (!isExtensionContextValid() || errMsg.includes('context invalidated') || errMsg.includes('Extension context invalidated')) {
        // Ignora silenciosamente para não gerar alerta vermelho no painel de extensões do Chrome nem corromper o patch relay recarregado
        return;
      }
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
    if (!isExtensionContextValid()) return;
    const extensionId = chrome.runtime.id;
    sendCustomEvent('extension_id', extensionId);

    try {
      const [tierIconUrl, legendaryIconUrl] = await Promise.all([
        getAssetDataUrl('images/skill-btn.svg').catch(() => null),
        getAssetDataUrl('images/skill-btn-legendary.svg').catch(() => null),
      ]);
      if (tierIconUrl && legendaryIconUrl) {
        sendCustomEvent('set_icon_assets', { tierIconUrl, legendaryIconUrl });
      }
    } catch (error) {
      if (!isExtensionContextValid() || String(error).includes('context invalidated')) return;
      console.warn('[Duo Tools] Não foi possível carregar ícones:', error);
    }

    // Lê estado inicial (sem paywall — tudo liberado)
    try {
      chrome.storage.local.get(['skillPathEnabled', 'solver_delay', 'autoSeqConfig', 'autoSeqState'], (response) => {
        if (chrome.runtime.lastError || !response) return;
        const isEnabled = Boolean(response['skillPathEnabled']);
        const delay = typeof response['solver_delay'] === 'number' ? response['solver_delay'] : 500;

        console.log('[Duo Tools] Estado inicial do solver:', { isEnabled, delay });

        // isPaid = true, isTrialActive = true: sempre liberado, sem paywall
        sendCustomEvent('set_initial_state', {
          isPaid: true,
          isTrialActive: true,
          isEnabled,
          delay,
          autoSeqConfig: response['autoSeqConfig'] || {},
          autoSeqState: response['autoSeqState'] || {}
        });
      });
    } catch (e) {}
  });

  // Propaga mudanças de storage para o injected.js
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (!isExtensionContextValid()) return;
    if (namespace === 'local') {
      if (changes.skillPathEnabled) {
        const isEnabled = changes.skillPathEnabled.newValue;
        if (isEnabled) {
          sendCustomEvent('enable_automation');
        } else {
          sendCustomEvent('disable_automation');
        }
      }
      if (changes.solver_delay) {
        sendCustomEvent('set_delay', changes.solver_delay.newValue);
      }
      if (changes.autoSeqConfig) {
        sendCustomEvent('update_auto_seq_config', changes.autoSeqConfig.newValue || {});
      }
      if (changes.autoSeqState && changes.autoSeqState.newValue) {
        sendCustomEvent('update_auto_seq_state', changes.autoSeqState.newValue);
      }
    }
  });

  // ─── 5. Injeta o Widget Flutuante (Iframe) ────────────────
  let widgetContainer = null;
  let widgetIframe = null;
  let widgetButton = null;

  function initWidget() {
    if (!isExtensionContextValid()) return;
    try {
      chrome.storage.sync.get(['widgetEnabled'], (res) => {
        if (chrome.runtime.lastError || !res) return;
        if (res.widgetEnabled !== false) {
          createWidget();
        }
      });
    } catch (e) {}
  }

  function createWidget() {
    if (!isExtensionContextValid()) return;
    if (widgetContainer) return;

    const existingContainer = document.getElementById('duo-tools-widget-container');
    if (existingContainer) {
      existingContainer.remove();
    }

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
    widgetIframe.src = chrome.runtime.getURL('widget/widget.html');
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

  // Monitor de conclusão de exercício: para o modo loop comum assim que sair e avisa sobre transição de lição concluída
  let lastWasLesson = false;
  const monitorInterval = setInterval(() => {
    if (!isExtensionContextValid()) {
      clearInterval(monitorInterval);
      return;
    }
    const currentUrl = document.location.href;
    const isLessonUrl = currentUrl.includes('/lesson') || currentUrl.includes('/practice') || currentUrl.includes('/story') || currentUrl.includes('/legendary') || currentUrl.includes('/unit-test') || currentUrl.includes('/checkpoint') || currentUrl.includes('/placement');
    const isMapOrMenu = !isLessonUrl || currentUrl.includes('/learn') || currentUrl.includes('/leaderboard') || currentUrl.includes('/profile') || currentUrl.includes('/shop') || currentUrl.endsWith('.com/') || currentUrl.endsWith('.com');
    
    if (isLessonUrl) {
      lastWasLesson = true;
    } else if (lastWasLesson && isMapOrMenu) {
      lastWasLesson = false;
      if (widgetIframe && widgetIframe.contentWindow) {
        widgetIframe.contentWindow.postMessage({ type: 'STOP_SOLVE_LOOP' }, '*');
      }
      sendCustomEvent('stop_solve_skip_challenge');
      sendCustomEvent('lesson_completed_transition');
    }
  }, 500);

  if (document.body) {
    initWidget();
  } else {
    document.addEventListener('DOMContentLoaded', initWidget);
  }

})();
