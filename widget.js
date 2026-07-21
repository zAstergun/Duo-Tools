// ============================================================
// widget.js — Duo Tools
//
// Gerencia a UI do popup e conecta os controles ao background.js
// e ao chrome.storage.sync.
// ============================================================

// O dicionário i18n agora é carregado do i18n.js

let currentLang = 'pt-BR';

function applyLanguage(lang, saveToStorage = true) {
  currentLang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (i18n[lang] && i18n[lang][key]) {
      el.textContent = i18n[lang][key];
    }
  });
  
  // Atualiza as flags no cabeçalho
  document.querySelectorAll('.lang-flag').forEach(flag => {
    if (flag.getAttribute('data-lang') === lang) {
      flag.classList.add('active');
    } else {
      flag.classList.remove('active');
    }
  });

  // Salva no storage para lembrar a escolha
  if (saveToStorage) {
    chrome.storage.sync.set({ widgetLang: lang });
  }

  // Se o botão de resolver ou de parar estiver com estado modificado, 
  // precisamos atualizar o texto também, pois eles não são apenas o default
  if (solveLoopActive) {
    solveBtn.textContent = i18n[lang]['btn_stop_loop'];
  } else if (solveBtn.disabled) {
    solveBtn.textContent = i18n[lang]['btn_solving'];
  }

  // Atualiza a linha de status também, caso já tenha carregado os elementos
  if (typeof updateStatusLine === 'function' && statusLine) {
    updateStatusLine();
  }
}

document.querySelectorAll('.lang-flag').forEach(flag => {
  flag.addEventListener('click', () => {
    applyLanguage(flag.getAttribute('data-lang'));
  });
});
// ─── Referências aos elementos do DOM ───────────────────────

// Farm de XP
const xpDesejado = document.getElementById('xpDesejado');
const bonusToggle = document.getElementById('bonusToggle');
const xpStartBtn = document.getElementById('xpStartBtn');
const xpStopBtn = document.getElementById('xpStopBtn');
const xpProgress = document.getElementById('xpProgress');
const xpProgressBar = document.getElementById('xpProgressBar');
const xpProgressLabel = document.getElementById('xpProgressLabel');
const xpStatus = document.getElementById('xpStatus');

// Modo Super
const superToggle = document.getElementById('superToggle');

// Resolver exercício
const solveSkipToggle = document.getElementById('solveSkipToggle');
const solveDelay = document.getElementById('solveDelay');
const solveBtn = document.getElementById('solveBtn');

const btnCafeWidget = document.getElementById('btnCafeWidget');
if (btnCafeWidget) {
  btnCafeWidget.addEventListener('click', () => {
    alert('Obrigado por querer apoiar! Em breve o link estará disponível.');
  });
}

// Status
const statusLine = document.getElementById('statusLine');

// ─── Carrega configurações salvas ────────────────────────────

async function load() {
  const s = await chrome.storage.sync.get([
    'superModeEnabled',
    'solveDelay',
    'solveSkipEnabled',
    'xpDesejado',
    'xpBonus',
    'widgetLang'
  ]);

  if (s.widgetLang) {
    applyLanguage(s.widgetLang);
  } else {
    applyLanguage('pt-BR');
  }

  // Ativa por padrão o Modo Super se não houver configuração salva
  superToggle.checked = s.superModeEnabled !== undefined ? !!s.superModeEnabled : true;
  solveDelay.value = typeof s.solveDelay === 'number' ? s.solveDelay : 500;
  solveSkipToggle.checked = !!s.solveSkipEnabled;
  if (s.xpDesejado) xpDesejado.value = s.xpDesejado;
  bonusToggle.checked = !!s.xpBonus;

  updateStatusLine();

  // Verifica se o farm está rodando
  const ls = await chrome.storage.local.get(['xpFarmState']);
  if (ls.xpFarmState?.isRunning) {
    setFarmRunningUI(true);
    showProgress(ls.xpFarmState.currentXP || 0, ls.xpFarmState.targetXP || parseInt(xpDesejado.value));
  }

  // Verifica última atualização de progresso
  const lp = await chrome.storage.local.get(['lastProgressUpdate']);
  if (lp.lastProgressUpdate && Date.now() - lp.lastProgressUpdate.timestamp < 30000) {
    handleProgressUpdate(lp.lastProgressUpdate);
  }
}

function updateStatusLine() {
  const superOn = superToggle.checked;
  const skipOn = solveSkipToggle.checked;
  if (superOn && skipOn) statusLine.textContent = i18n[currentLang]['status_super_skip'];
  else if (superOn) statusLine.textContent = i18n[currentLang]['status_super'];
  else if (skipOn) statusLine.textContent = i18n[currentLang]['status_skip'];
  else statusLine.textContent = i18n[currentLang]['status_off'];
}

// ─── Farm de XP ──────────────────────────────────────────────

function setFarmRunningUI(running) {
  if (running) {
    xpStartBtn.style.display = 'none';
    xpStopBtn.style.display = '';
    xpDesejado.disabled = true;
    bonusToggle.disabled = true;
    xpProgress.style.display = 'flex';
  } else {
    xpStartBtn.style.display = '';
    xpStopBtn.style.display = 'none';
    xpDesejado.disabled = false;
    bonusToggle.disabled = false;
  }
}

function showProgress(current, total) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  xpProgressBar.style.width = pct + '%';
  xpProgressLabel.textContent = `${current} / ${total} XP`;
  xpProgress.style.display = 'flex';
}

function setXPStatus(text, type = '') {
  xpStatus.textContent = text;
  xpStatus.className = 'xp-status' + (type ? ' xp-status--' + type : '');
  xpStatus.style.display = text ? '' : 'none';
}

xpStartBtn.addEventListener('click', async () => {
  const targetXP = parseInt(xpDesejado.value, 10);
  if (!targetXP || targetXP < 10) {
    setXPStatus(i18n[currentLang]['err_min_xp'], 'error');
    return;
  }

  // Salva preferências
  await chrome.storage.sync.set({ xpDesejado: targetXP, xpBonus: bonusToggle.checked });

  setFarmRunningUI(true);
  showProgress(0, targetXP);
  setXPStatus(i18n[currentLang]['status_farming']);

  const response = await chrome.runtime.sendMessage({
    action: 'start_xp_farm',
    targetXP,
    enableBonus: bonusToggle.checked
  });

  if (response?.error) {
    setFarmRunningUI(false);
    setXPStatus(response.error, 'error');
  }
});

xpStopBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'stop_xp_farm' });
  setFarmRunningUI(false);
  setXPStatus(i18n[currentLang]['status_stopped'], '');
});

// Ouve atualizações de progresso vindas do background via mensagens
chrome.runtime.onMessage.addListener((message) => {
  handleProgressUpdate({ type: message.type, data: message });
});

// Ouve atualizações de progresso via storage (garante funcionamento no iframe) e mudança de idioma
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.lastProgressUpdate) {
    handleProgressUpdate(changes.lastProgressUpdate.newValue);
  }
  if (area === 'sync' && changes.widgetLang) {
    // Se o idioma for alterado em outra aba ou no popup, aplica aqui sem salvar de novo
    if (changes.widgetLang.newValue !== currentLang) {
      applyLanguage(changes.widgetLang.newValue, false);
    }
  }
});

function handleProgressUpdate(update) {
  if (!update) return;
  const { type, data } = update;

  switch (type) {
    case 'xp_progress':
      showProgress(data.currentXP || 0, data.targetXP || parseInt(xpDesejado.value));
      setXPStatus(i18n[currentLang]['status_progress'].replace('{0}', data.completed).replace('{1}', data.total));
      break;

    case 'xp_completed':
      setFarmRunningUI(false);
      showProgress(data.totalXP || 0, data.totalXP || 0);
      setXPStatus(i18n[currentLang]['status_completed'].replace('{0}', data.totalXP), 'success');
      break;

    case 'xp_error':
      setFarmRunningUI(false);
      setXPStatus(i18n[currentLang]['status_error'].replace('{0}', data.errorText), 'error');
      break;

    case 'xp_stopped':
      setFarmRunningUI(false);
      break;
  }
}

// ─── Modo Super ───────────────────────────────────────────────

superToggle.addEventListener('change', async () => {
  await chrome.storage.sync.set({ superModeEnabled: superToggle.checked });
  updateStatusLine();
  
  // Recarrega as abas abertas do Duolingo para aplicar as mudanças
  chrome.tabs.query({ url: '*://www.duolingo.com/*' }, (tabs) => {
    tabs.forEach(tab => chrome.tabs.reload(tab.id));
  });
});

// ─── Resolver exercício ───────────────────────────────────────

solveSkipToggle.addEventListener('change', async () => {
  await chrome.storage.sync.set({ solveSkipEnabled: solveSkipToggle.checked });
  updateStatusLine();
});

solveDelay.addEventListener('change', async () => {
  const delay = parseInt(solveDelay.value, 10);
  await chrome.storage.sync.set({ solveDelay: delay });
  // Propaga delay para o content script
  await chrome.runtime.sendMessage({ action: 'set_delay', delay });
  // Também atualiza o storage local que o injected.js lê
  await chrome.storage.local.set({ autolingo_delay: delay });
});

let solveLoopActive = false;
let solveLoopInterval = null;

solveBtn.addEventListener('click', async () => {
  const useSkip = solveSkipToggle.checked;

  try {
    if (useSkip) {
      // Toggle de loop: resolve+pula em loop contínuo via mensagens periódicas
      solveLoopActive = !solveLoopActive;

      if (solveLoopActive) {
        solveBtn.textContent = i18n[currentLang]['btn_stop_loop'];
        solveBtn.style.borderColor = 'var(--rose)';
        solveBtn.style.color = 'var(--rose)';

        // Lê o delay atual
        const delayMs = parseInt(solveDelay.value, 10) || 500;

        // Dispara imediatamente e depois em loop
        await chrome.runtime.sendMessage({ action: 'solve_skip_challenge' });
        solveLoopInterval = setInterval(async () => {
          if (!solveLoopActive) { clearInterval(solveLoopInterval); return; }
          try {
            await chrome.runtime.sendMessage({ action: 'solve_skip_challenge' });
          } catch (error) {
            console.log("[Duo Tools] Contexto da extensão invalidado. Parando o loop.");
            clearInterval(solveLoopInterval);
            solveLoopActive = false;
            solveBtn.textContent = i18n[currentLang]['btn_solve'];
            solveBtn.style.borderColor = '';
            solveBtn.style.color = '';
          }
        }, Math.max(delayMs * 3, 1000));
      } else {
        clearInterval(solveLoopInterval);
        solveLoopInterval = null;
        solveBtn.textContent = i18n[currentLang]['btn_solve'];
        solveBtn.style.borderColor = '';
        solveBtn.style.color = '';
        await chrome.runtime.sendMessage({ action: 'stop_solve_skip_challenge' });
      }
    } else {
      // Apenas resolver a questão atual, sem avançar
      solveBtn.disabled = true;
      solveBtn.textContent = i18n[currentLang]['btn_solving'];
      await chrome.runtime.sendMessage({ action: 'solve_challenge' });
      setTimeout(() => {
        solveBtn.disabled = false;
        solveBtn.textContent = i18n[currentLang]['btn_solve'];
      }, 1000);
    }
  } catch (error) {
    console.log("[Duo Tools] Contexto da extensão invalidado ao clicar.");
    solveLoopActive = false;
    if (solveLoopInterval) clearInterval(solveLoopInterval);
    solveBtn.disabled = false;
    solveBtn.textContent = i18n[currentLang]['btn_solve'];
    solveBtn.style.borderColor = '';
    solveBtn.style.color = '';
  }
});

// ─── Botão de café ────────────────────────────────────────────
// TODO: adicionar link de pagamento aqui

// ─── Inicialização ────────────────────────────────────────────

load();

// ─── Redimensionamento Dinâmico ───────────────────────────────
const resizeObserver = new ResizeObserver(() => {
  window.parent.postMessage({ 
    source: 'duo-tools-widget', 
    type: 'resize', 
    height: document.body.scrollHeight 
  }, '*');
});
resizeObserver.observe(document.body);
