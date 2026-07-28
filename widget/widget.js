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
const skillPathToggle = document.getElementById('skillPathToggle');

// Sequência Automática
const seqSectionToggle = document.getElementById('seqSectionToggle');
const seqDesejado = document.getElementById('seqDesejado');
const seqDesejadoWrap = document.getElementById('seqDesejadoWrap');
const seqLegendaryToggle = document.getElementById('seqLegendaryToggle');
const seqStartBtn = document.getElementById('seqStartBtn');
const seqStopBtn = document.getElementById('seqStopBtn');
const seqProgress = document.getElementById('seqProgress');
const seqProgressBar = document.getElementById('seqProgressBar');
const seqProgressLabel = document.getElementById('seqProgressLabel');
const seqStatus = document.getElementById('seqStatus');

const btnCafeWidget = document.getElementById('btnCafeWidget');
if (btnCafeWidget) {
  btnCafeWidget.addEventListener('click', () => {
    window.open('https://donate.asterdev.me/', '_blank');
  });
}

function reloadDuolingoPage() {
  window.parent?.postMessage({ type: 'RELOAD_PAGE' }, '*');
  try {
    if (typeof chrome !== 'undefined' && chrome?.tabs && typeof chrome.tabs.query === 'function') {
      chrome.tabs.query({ url: ['*://*.duolingo.com/*', '*://duolingo.com/*'] }, (tabs) => {
        tabs?.forEach(tab => chrome.tabs.reload(tab.id, { bypassCache: true }));
      });
    } else if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
      try {
        chrome.runtime.sendMessage({ action: 'reload_duolingo' }).catch(() => {});
      } catch (e) {
        // Ignora erro quando contexto da extensão é revalidado
      }
    }
  } catch (err) {
    // Ignora erros ao tentar acessar APIs do chrome num contexto recarregado
  }
}

const btnRefreshWidget = document.getElementById('btnRefreshWidget');
if (btnRefreshWidget) {
  btnRefreshWidget.addEventListener('click', () => {
    reloadDuolingoPage();
  });
}

// Status
const statusLine = document.getElementById('statusLine');

// ─── Carrega configurações salvas ────────────────────────────

async function load() {
  try {
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

    // Verifica se o farm está rodando
    const ls = await chrome.storage.local.get(['xpFarmState', 'skillPathEnabled']);
    if (ls.xpFarmState?.isRunning) {
      setFarmRunningUI(true);
      showProgress(ls.xpFarmState.currentXP || 0, ls.xpFarmState.targetXP || parseInt(xpDesejado.value));
    }

    if (skillPathToggle) skillPathToggle.checked = !!ls.skillPathEnabled;

    // Verifica última atualização de progresso
    const lp = await chrome.storage.local.get(['lastProgressUpdate']);
    if (lp.lastProgressUpdate && Date.now() - lp.lastProgressUpdate.timestamp < 30000) {
      handleProgressUpdate(lp.lastProgressUpdate);
    }

    // Carrega configurações e estado da Sequência Automática prioritariamente do storage local
    const sSeq = await chrome.storage.sync.get(['seqFinishSection', 'seqDesired', 'seqLegendary']);
    const lsSeq = await chrome.storage.local.get(['autoSeqState', 'autoSeqConfig']);
    
    const finishSec = lsSeq.autoSeqConfig?.finishSection !== undefined ? !!lsSeq.autoSeqConfig.finishSection : !!sSeq.seqFinishSection;
    const desTarget = lsSeq.autoSeqConfig?.target || lsSeq.autoSeqState?.target || sSeq.seqDesired || 3;
    const isLeg = lsSeq.autoSeqConfig?.legendary !== undefined ? !!lsSeq.autoSeqConfig.legendary : !!sSeq.seqLegendary;
    
    if (seqSectionToggle) seqSectionToggle.checked = !!finishSec;
    if (seqDesejado && desTarget !== 999) seqDesejado.value = desTarget;
    if (seqLegendaryToggle) seqLegendaryToggle.checked = !!isLeg;
    updateSeqSectionUI();

    if (lsSeq.autoSeqState?.isRunning) {
      window.seqIsRunning = true;
      setSeqRunningUI(true);
      showSeqProgress(lsSeq.autoSeqState.current || 0, lsSeq.autoSeqState.target || desTarget);
      if (lsSeq.autoSeqState.statusText) {
        setSeqStatus(lsSeq.autoSeqState.statusText, lsSeq.autoSeqState.statusType || '');
      }
    } else {
      window.seqIsRunning = false;
      setSeqRunningUI(false);
      if (lsSeq.autoSeqState?.statusText) {
        setSeqStatus(lsSeq.autoSeqState.statusText, lsSeq.autoSeqState.statusType || '');
      }
    }

    updateStatusLine();
  } catch (err) {
    console.log("[Duo Tools] Aviso no carregamento (extensão atualizada ou recarregada):", err.message);
  }
}

function updateStatusLine() {
  const lang = i18n[currentLang] ? i18n[currentLang] : i18n['pt-BR'];
  const tags = [];

  if (superToggle && superToggle.checked) tags.push(lang['tag_super'] || 'Super');
  if (skillPathToggle && skillPathToggle.checked) tags.push(lang['tag_map'] || 'Botões no Mapa');
  if (bonusToggle && bonusToggle.checked) tags.push(lang['tag_bonus'] || 'Bônus XP');
  if (seqSectionToggle && seqSectionToggle.checked) tags.push(lang['tag_finish_section'] || 'Finalizar seção');
  if (window.seqIsRunning) tags.push(lang['tag_seq'] || 'Sequência');
  
  if (typeof solveLoopActive !== 'undefined' && solveLoopActive) {
    tags.push(lang['tag_loop_running'] || '⚡ Loop ativo');
  } else if (solveSkipToggle && solveSkipToggle.checked) {
    tags.push(lang['tag_loop'] || 'Resolver em loop');
  }

  if (tags.length === 0) {
    statusLine.textContent = lang['status_off'] || 'Tudo desligado';
  } else {
    statusLine.textContent = tags.join(' · ');
  }
}

// ─── Botões no Mapa e Bônus ──────────────────────────────────

if (skillPathToggle) {
  skillPathToggle.addEventListener('change', async () => {
    try {
      await chrome.storage.local.set({ skillPathEnabled: skillPathToggle.checked });
    } catch (err) {
      console.warn("[Duo Tools] Não foi possível salvar configuração:", err.message);
    }
    updateStatusLine();
  });
}

if (bonusToggle) {
  bonusToggle.addEventListener('change', async () => {
    try {
      await chrome.storage.sync.set({ xpBonus: bonusToggle.checked });
    } catch (err) {
      console.warn("[Duo Tools] Não foi possível salvar bônus:", err.message);
    }
    updateStatusLine();
  });
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
  if (area === 'local' && changes.autoSeqState) {
    const st = changes.autoSeqState.newValue;
    if (st) {
      window.seqIsRunning = st.isRunning;
      updateStatusLine();
      setSeqRunningUI(st.isRunning);
      // Use target from state, fallback to the current input value (never show 0 / 3 if user set 4)
      const displayTarget = (st.target && st.target > 0) ? st.target : parseInt(seqDesejado?.value || 3, 10);
      showSeqProgress(st.current || 0, displayTarget);
      if (st.statusText !== undefined) {
        setSeqStatus(st.statusText, st.statusType || '');
      }
    }
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
  try {
    await chrome.storage.sync.set({ superModeEnabled: superToggle.checked });
  } catch (err) {
    console.warn("[Duo Tools] Erro ao salvar Super Mode:", err.message);
  }
  updateStatusLine();
  
  // Recarrega a página de forma segura tanto de popups quanto do iframe
  reloadDuolingoPage();
});

// ─── Resolver exercício ───────────────────────────────────────

solveSkipToggle.addEventListener('change', async () => {
  try {
    await chrome.storage.sync.set({ solveSkipEnabled: solveSkipToggle.checked });
  } catch (err) {
    console.warn("[Duo Tools] Erro ao salvar Solve Skip:", err.message);
  }
  updateStatusLine();
});

solveDelay.addEventListener('change', async () => {
  const delay = parseInt(solveDelay.value, 10);
  try {
    await chrome.storage.sync.set({ solveDelay: delay });
    // Propaga delay para o content script
    await chrome.runtime.sendMessage({ action: 'set_delay', delay });
    // Também atualiza o storage local que o injected.js lê
    await chrome.storage.local.set({ solver_delay: delay });
  } catch (err) {
    console.warn("[Duo Tools] Erro ao salvar delay:", err.message);
  }
});

let solveLoopActive = false;
let solveLoopInterval = null;

function stopSolveLoop(sendRuntimeMessage = true) {
  if (!solveLoopActive && !solveLoopInterval) return;
  console.log("[Duo Tools] Parando resolução em loop no widget.");
  if (solveLoopInterval) clearInterval(solveLoopInterval);
  solveLoopInterval = null;
  solveLoopActive = false;
  solveBtn.textContent = i18n[currentLang]['btn_solve'];
  solveBtn.style.borderColor = '';
  solveBtn.style.color = '';
  updateStatusLine();
  if (sendRuntimeMessage) {
    chrome.runtime.sendMessage({ action: 'stop_solve_skip_challenge' }).catch(() => {});
  }
}

window.addEventListener('message', (event) => {
  if (event.data && (event.data.type === 'STOP_SOLVE_LOOP' || event.data.action === 'stop_solve_skip_challenge')) {
    stopSolveLoop(false);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message && (message.action === 'stop_solve_skip_challenge' || message.type === 'STOP_SOLVE_LOOP')) {
    stopSolveLoop(false);
  }
});

solveBtn.addEventListener('click', async () => {
  const useSkip = solveSkipToggle.checked;

  try {
    if (useSkip) {
      // Toggle de loop: resolve+pula em loop contínuo via mensagens periódicas
      if (!solveLoopActive) {
        solveLoopActive = true;
        solveBtn.textContent = i18n[currentLang]['btn_stop_loop'];
        solveBtn.style.borderColor = 'var(--rose)';
        solveBtn.style.color = 'var(--rose)';
        updateStatusLine();

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
            stopSolveLoop(false);
          }
        }, Math.max(delayMs * 3, 1000));
      } else {
        stopSolveLoop(true);
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

// ─── Sequência Automática ────────────────────────────────────

function updateSeqSectionUI() {
  if (!seqSectionToggle) return;
  const finishSection = !!seqSectionToggle.checked;
  if (seqDesejado) {
    seqDesejado.disabled = finishSection;
  }
  if (seqDesejadoWrap) {
    seqDesejadoWrap.style.opacity = finishSection ? '0.4' : '1';
    seqDesejadoWrap.style.pointerEvents = finishSection ? 'none' : '';
  }
}

function setSeqRunningUI(running) {
  if (running) {
    if (seqStartBtn) seqStartBtn.style.display = 'none';
    if (seqStopBtn) seqStopBtn.style.display = '';
    if (seqDesejado) seqDesejado.disabled = true;
    if (seqLegendaryToggle) seqLegendaryToggle.disabled = true;
    if (seqSectionToggle) seqSectionToggle.disabled = true;
    if (seqProgress) seqProgress.style.display = 'flex';
  } else {
    if (seqStartBtn) seqStartBtn.style.display = '';
    if (seqStopBtn) seqStopBtn.style.display = 'none';
    if (seqLegendaryToggle) seqLegendaryToggle.disabled = false;
    if (seqSectionToggle) seqSectionToggle.disabled = false;
    updateSeqSectionUI();
  }
}

function showSeqProgress(current, total) {
  if (!seqProgress) return;
  if (total >= 999 || (seqSectionToggle && seqSectionToggle.checked)) {
    if (seqProgressBar) seqProgressBar.style.width = '100%';
    if (seqProgressLabel) seqProgressLabel.textContent = `${current} lições (Até o fim da seção)`;
  } else {
    const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
    if (seqProgressBar) seqProgressBar.style.width = pct + '%';
    if (seqProgressLabel) seqProgressLabel.textContent = `${current} / ${total} Lições`;
  }
  seqProgress.style.display = 'flex';
}

function setSeqStatus(text, type = '') {
  if (!seqStatus) return;
  seqStatus.textContent = text;
  seqStatus.className = 'xp-status' + (type ? ' xp-status--' + type : '');
  seqStatus.style.display = text ? '' : 'none';
}

if (seqSectionToggle) {
  seqSectionToggle.addEventListener('change', async () => {
    updateSeqSectionUI();
    updateStatusLine();
    const finishSection = !!seqSectionToggle.checked;
    const target = finishSection ? 999 : parseInt(seqDesejado?.value || 3, 10);
    const cfg = {
      enabled: false,
      target: target,
      finishSection: finishSection,
      legendary: !!seqLegendaryToggle?.checked
    };
    window.parent?.postMessage({ type: 'UPDATE_AUTO_SEQ_CONFIG', config: cfg }, '*');
    chrome.storage.sync.set({ seqFinishSection: finishSection }).catch(() => {});
    try {
      const currentConfig = (await chrome.storage.local.get(['autoSeqConfig'])).autoSeqConfig || {};
      const currentState = (await chrome.storage.local.get(['autoSeqState'])).autoSeqState || {};
      await chrome.storage.local.set({ 
        autoSeqConfig: { ...currentConfig, ...cfg },
        autoSeqState: { ...currentState, target: target, finishSection, legendary: !!seqLegendaryToggle?.checked }
      });
    } catch (err) {}
  });
}

if (seqDesejado) {
  const handleTargetChange = async () => {
    const val = parseInt(seqDesejado.value, 10);
    if (isNaN(val) || val < 1) return; // Aguarda valor válido
    const finishSection = !!seqSectionToggle?.checked;
    const target = finishSection ? 999 : val;
    const legendary = !!seqLegendaryToggle?.checked;
    const cfg = { enabled: false, target, finishSection, legendary };

    // Salvar no local storage imediatamente (sem await no sync que pode falhar)
    chrome.storage.local.get(['autoSeqConfig', 'autoSeqState'], (data) => {
      const currentConfig = data.autoSeqConfig || {};
      const currentState = data.autoSeqState || {};
      const newCurrent = (currentState.completed || !currentState.isRunning || (currentState.current || 0) >= target) ? 0 : (currentState.current || 0);
      chrome.storage.local.set({
        autoSeqConfig: { ...currentConfig, ...cfg },
        autoSeqState: { ...currentState, target, finishSection, legendary, current: newCurrent, completed: newCurrent === 0 ? false : currentState.completed }
      });
    });
    // Sync em background, não bloqueia
    chrome.storage.sync.set({ seqDesired: val }).catch(() => {});
    // Propaga config para injected.js
    window.parent?.postMessage({ type: 'UPDATE_AUTO_SEQ_CONFIG', config: cfg }, '*');
    showSeqProgress(0, target);
  };
  seqDesejado.addEventListener('input', handleTargetChange);
  seqDesejado.addEventListener('change', handleTargetChange);
}

if (seqLegendaryToggle) {
  const handleLegendaryChange = async () => {
    const leg = !!seqLegendaryToggle.checked;
    const finishSection = !!seqSectionToggle?.checked;
    const target = finishSection ? 999 : parseInt(seqDesejado?.value || 3, 10);
    const cfg = {
      enabled: false,
      target: target,
      finishSection: finishSection,
      legendary: leg
    };
    window.parent?.postMessage({ type: 'UPDATE_AUTO_SEQ_CONFIG', config: cfg }, '*');
    chrome.storage.sync.set({ seqLegendary: leg }).catch(() => {});
    try {
      const currentConfig = (await chrome.storage.local.get(['autoSeqConfig'])).autoSeqConfig || {};
      const currentState = (await chrome.storage.local.get(['autoSeqState'])).autoSeqState || {};
      await chrome.storage.local.set({ 
        autoSeqConfig: { ...currentConfig, ...cfg },
        autoSeqState: { ...currentState, target: target, legendary: leg, finishSection }
      });
    } catch (err) {}
  };
  seqLegendaryToggle.addEventListener('change', handleLegendaryChange);
}

if (seqStartBtn) {
  seqStartBtn.addEventListener('click', async () => {
    const finishSection = !!seqSectionToggle?.checked;
    // Always read directly from the input field at click time
    const rawVal = seqDesejado ? parseInt(seqDesejado.value, 10) : 3;
    const target = finishSection ? 999 : (rawVal >= 1 ? rawVal : 3);
    const legendary = !!seqLegendaryToggle?.checked;

    if (!finishSection) chrome.storage.sync.set({ seqDesired: target }).catch(() => {});
    chrome.storage.sync.set({ seqFinishSection: finishSection, seqLegendary: legendary }).catch(() => {});
    try {
      await chrome.storage.local.set({
        autoSeqConfig: { enabled: true, target, legendary, finishSection },
        autoSeqState: { isRunning: true, current: 0, target, legendary, finishSection, completed: false, statusText: finishSection ? "⚡ Buscando até o fim da seção..." : "⚡ Buscando próxima lição...", statusType: "" }
      });
    } catch (e) {}

    window.seqIsRunning = true;
    updateStatusLine();
    setSeqRunningUI(true);
    showSeqProgress(0, target);
    setSeqStatus(finishSection ? "⚡ Buscando até o fim da seção..." : "⚡ Buscando próxima lição...", "");

    window.parent?.postMessage({ type: 'START_AUTO_SEQUENCE', target, legendary, finishSection }, '*');
    chrome.runtime.sendMessage({ action: 'start_auto_sequence', target, legendary, finishSection }).catch(() => {});
  });
}

if (seqStopBtn) {
  seqStopBtn.addEventListener('click', async () => {
    window.seqIsRunning = false;
    updateStatusLine();
    const finishSection = !!seqSectionToggle?.checked;
    const target = finishSection ? 999 : parseInt(seqDesejado?.value || 3, 10);
    try {
      await chrome.storage.local.set({
        autoSeqConfig: { enabled: false, target, finishSection, legendary: !!seqLegendaryToggle.checked },
        autoSeqState: { isRunning: false, current: 0, target, finishSection, legendary: !!seqLegendaryToggle.checked, statusText: "🛑 Sequência parada pelo usuário.", statusType: "" }
      });
      updateStatusLine();
    } catch (e) {}

    setSeqRunningUI(false);
    setSeqStatus("🛑 Sequência parada pelo usuário.", "");
    window.parent?.postMessage({ type: 'STOP_AUTO_SEQUENCE' }, '*');
    chrome.runtime.sendMessage({ action: 'stop_auto_sequence' }).catch(() => {});
  });
}

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
