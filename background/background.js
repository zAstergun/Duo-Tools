// ============================================================
// background.js — Duo Tools Service Worker
//
// Integra:
//   • Farm de XP (lógica de sessions POST/PUT)
//   • Modo Super (patch de JS via fetch+regex no background)
//   • Mensageria com content-script.js para resolver exercícios
// ============================================================

// ─── Estado global ───────────────────────────────────────────
let jwtToken = null;
let isXPFarmRunning = false;
let xpFarmStopped = false;

// ─── JWT ─────────────────────────────────────────────

// Carrega JWT salvo ao iniciar
chrome.storage.local.get(['storedJWT'], (result) => {
  if (result.storedJWT) {
    jwtToken = result.storedJWT;
    console.log('[Duo Tools] JWT carregado do storage');
  }
});

async function isJWTValid(jwt) {
  if (!jwt) return false;
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1]));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < (now + 300)) {
      console.log('[Duo Tools] JWT expirado ou expirando em breve');
      return false;
    }
    const testResult = await duolingoFetchViaContentScript(
      `https://www.duolingo.com/2017-06-30/users/${payload.sub}?fields=id`,
      'GET',
      { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      undefined
    );
    return testResult && testResult.ok;
  } catch (e) {
    console.log('[Duo Tools] JWT validation failed:', e);
    return false;
  }
}

async function getValidJWT(forceRefresh = false) {
  if (!forceRefresh && jwtToken) {
    const valid = await isJWTValid(jwtToken);
    if (valid) return jwtToken;
    jwtToken = null;
    chrome.storage.local.remove('storedJWT');
  }

  // 1. Busca confiável e abrangente via chrome.cookies (múltiplas tentativas sem depender de injeção em abas)
  if (chrome.cookies && chrome.cookies.getAll) {
    try {
      let cookies = await chrome.cookies.getAll({ url: "https://www.duolingo.com" });
      if (!cookies || !cookies.length) {
        cookies = await chrome.cookies.getAll({ domain: "duolingo.com" });
      }
      if (cookies && cookies.length > 0) {
        const cookie = cookies.find(c => (c.name === 'jwt_token' || c.name.includes('jwt')) && c.value && c.value.includes('.')) || 
                       cookies.find(c => c.name === 'jwt_token');
        if (cookie && cookie.value) {
          jwtToken = cookie.value;
          chrome.storage.local.set({ storedJWT: jwtToken });
          return jwtToken;
        }
      }
    } catch (err) {
      console.warn('[Duo Tools] Falha na leitura via chrome.cookies:', err);
    }
  }

  // 2. Fallback robusto executando na aba ativa (tratando runtime.lastError obrigatoriamente)
  return new Promise((resolve) => {
    chrome.tabs.query({ url: ['*://*.duolingo.com/*', '*://duolingo.com/*'] }, async (tabs) => {
      if (!tabs || !tabs.length) { resolve(null); return; }
      
      // Ordena abas: prioriza a aba que estiver ativa e acessível
      const sortedTabs = tabs.filter(t => t.id && t.url && !t.url.startsWith('chrome://')).sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));

      for (const tab of sortedTabs) {
        const result = await new Promise(resCb => {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              try {
                // Regex para conservar eventual padding == de base64 no token
                const match = document.cookie.match(/(?:^|;\s*)jwt_token=([^;]+)/);
                if (match && match[1]) return decodeURIComponent(match[1].trim());
                const localJwt = localStorage.getItem('jwt_token') || localStorage.getItem('token');
                if (localJwt) return localJwt.replace(/^"|"$/g, '');
                return null;
              } catch { return null; }
            }
          }, (results) => {
            // ESSENCIAL: Tratar chrome.runtime.lastError para evitar mensagem vermelha de Unchecked runtime.lastError
            if (chrome.runtime.lastError || !results || !results[0]?.result) {
              if (chrome.runtime.lastError) {
                console.warn('[Duo Tools] Ignorado erro de injeção na aba ' + tab.id + ':', chrome.runtime.lastError.message);
              }
              resCb(null);
            } else {
              resCb(results[0].result);
            }
          });
        });

        if (result) {
          jwtToken = result;
          chrome.storage.local.set({ storedJWT: jwtToken });
          resolve(jwtToken);
          return;
        }
      }

      resolve(null);
    });
  });
}

// Tenta reinjetar o content script na aba (caso a extensão tenha sido recarregada)
async function ensureContentScriptReady(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
      if (!chrome.runtime.lastError && response) {
        resolve(true);
        return;
      }
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-script.js']
      }, () => {
        if (chrome.runtime.lastError) {
          console.warn('[Duo Tools] Não foi possível reinjetar content script:', chrome.runtime.lastError.message);
          resolve(false);
        } else {
          console.log('[Duo Tools] Content script reinjetado com sucesso.');
          setTimeout(() => resolve(true), 500);
        }
      });
    });
  });
}

// Faz chamada HTTP (primeiro via background worker autenticado, depois via content script se necessário)
async function duolingoFetchViaContentScript(url, method, headers, body) {
  // 1. Tenta requisição direta em background (muito mais rápida, tira proveito das novas permissões host e cookies)
  try {
    const directResp = await fetch(url, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include'
    });
    if (directResp.ok || [400, 401, 403, 404, 429, 500].includes(directResp.status)) {
      const text = await directResp.text();
      return { ok: directResp.ok, status: directResp.status, body: text };
    }
  } catch (err) {
    console.log('[Duo Tools] Requisição direta no background falhou, tentando fallback via content script...', err);
  }

  // 2. Fallback via content script enviando mensagem para a aba
  return new Promise((resolve) => {
    chrome.tabs.query({ url: ['*://*.duolingo.com/*', '*://duolingo.com/*'] }, async (tabs) => {
      if (!tabs || !tabs.length) {
        resolve({ ok: false, error: 'Nenhuma aba do Duolingo encontrada. Abra o Duolingo no navegador.' });
        return;
      }
      const validTabs = tabs.filter(t => t.id && t.url && !t.url.startsWith('chrome://')).sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));
      if (!validTabs.length) {
        resolve({ ok: false, error: 'Nenhuma aba válida do Duolingo ativa e acessível no momento.' });
        return;
      }
      const tabId = validTabs[0].id;

      await ensureContentScriptReady(tabId);

      const timeout = setTimeout(() => resolve({ ok: false, error: 'Timeout: content script não respondeu. Recarregue a página do Duolingo.' }), 15000);
      chrome.tabs.sendMessage(tabId, { action: 'duolingo_api', url, method, headers, body }, (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          const errMsg = chrome.runtime.lastError.message || '';
          if (errMsg.includes('Receiving end does not exist') || errMsg.includes('Could not establish connection')) {
            resolve({ ok: false, error: 'Content script não encontrado. Recarregue a página do Duolingo (F5) e tente novamente.' });
          } else {
            resolve({ ok: false, error: errMsg });
          }
          return;
        }
        if (!response) {
          resolve({ ok: false, error: 'Sem resposta do content script. Recarregue a página do Duolingo.' });
        } else {
          resolve(response);
        }
      });
    });
  });
}

// ─── Farm de XP ────────────────────────────────────────────

async function runXPFarm(targetXP, enableBonus) {
  const LESSONS = Math.ceil(targetXP / 10);

  // Força atualização do JWT pegando direto dos cookies, para evitar
  // usar token antigo em cache que resulta em 401 (e popup de login).
  jwtToken = await getValidJWT(true);
  
  if (!jwtToken) {
    sendProgressUpdate('xp_error', { errorText: 'JWT não encontrado. Faça login no Duolingo na aba atual e tente novamente.' });
    isXPFarmRunning = false;
    return 0;
  }

  const DUOLINGO_JWT = jwtToken;

  try {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DUOLINGO_JWT}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.duolingo.com/learn',
      'Origin': 'https://www.duolingo.com',
      'DNT': '1',
      'Connection': 'keep-alive'
    };

    // Decodifica JWT para pegar user id
    const jwtPayload = DUOLINGO_JWT.split('.')[1];
    const decoded = JSON.parse(atob(jwtPayload));
    const sub = decoded.sub;

    // Busca idioma do usuário
    const userResult = await duolingoFetchViaContentScript(
      `https://www.duolingo.com/2017-06-30/users/${sub}?fields=fromLanguage,learningLanguage`,
      'GET', headers, undefined
    );

    if (!userResult || !userResult.ok) {
      const errorMsg = userResult?.error || `Falha ao buscar dados do usuário (${userResult?.status || 'desconhecido'})`;
      sendProgressUpdate('xp_error', { errorText: errorMsg });
      isXPFarmRunning = false;
      return 0;
    }

    const { fromLanguage, learningLanguage } = JSON.parse(userResult.body);
    let xp = 0;

    for (let i = 0; i < LESSONS; i++) {
      if (xpFarmStopped) {
        isXPFarmRunning = false;
        return xp;
      }

      try {
        // POST session (cria a lição)
        const sessionBody = {
          challengeTypes: [
            "assist", "characterIntro", "characterMatch", "characterPuzzle", "characterSelect", "characterTrace", "characterWrite", "completeReverseTranslation", "definition", "dialogue", "extendedMatch", "extendedListenMatch", "form", "freeResponse", "gapFill", "judge", "listen", "listenComplete", "listenMatch", "match", "name", "listenComprehension", "listenIsolation", "listenSpeak", "listenTap", "orderTapComplete", "partialListen", "partialReverseTranslate", "patternTapComplete", "radioBinary", "radioImageSelect", "radioListenMatch", "radioListenRecognize", "radioSelect", "readComprehension", "reverseAssist", "sameDifferent", "select", "selectPronunciation", "selectTranscription", "svgPuzzle", "syllableTap", "syllableListenTap", "speak", "tapCloze", "tapClozeTable", "tapComplete", "tapCompleteTable", "tapDescribe", "translate", "transliterate", "transliterationAssist", "typeCloze", "typeClozeTable", "typeComplete", "typeCompleteTable", "writeComprehension"
          ],
          fromLanguage,
          isFinalLevel: false,
          isV2: true,
          juicy: true,
          learningLanguage,
          smartTipsVersion: 2,
          type: 'GLOBAL_PRACTICE',
          enableBonusPoints: enableBonus
        };

        let sessionResult = await duolingoFetchViaContentScript(
          'https://www.duolingo.com/2017-06-30/sessions',
          'POST', headers, sessionBody
        );

        if (sessionResult && sessionResult.status === 401) {
          console.log('[Duo Tools] 401 recebido no POST, atualizando JWT e tentando novamente...');
          const newJwt = await getValidJWT(true);
          if (newJwt) {
            headers['Authorization'] = `Bearer ${newJwt}`;
            sessionResult = await duolingoFetchViaContentScript(
              'https://www.duolingo.com/2017-06-30/sessions',
              'POST', headers, sessionBody
            );
          }
        }

        if (!sessionResult || !sessionResult.ok) {
          const errorMsg = sessionResult?.error || `Falha ao criar sessão (${sessionResult?.status || '?'}): ${sessionResult?.body?.substring(0, 200) || 'sem resposta'}`;
          sendProgressUpdate('xp_error', { errorText: errorMsg });
          isXPFarmRunning = false;
          return xp;
        }

        const session = JSON.parse(sessionResult.body);

        // PUT session (marca como concluída e colhe XP)
        const putBody = {
          ...session,
          heartsLeft: 0,
          startTime: Math.floor(Date.now() / 1000) - 60,
          enableBonusPoints: enableBonus,
          endTime: Math.floor(Date.now() / 1000),
          failed: false,
          maxInLessonStreak: 9,
          shouldLearnThings: true
        };

        let putResult = await duolingoFetchViaContentScript(
          `https://www.duolingo.com/2017-06-30/sessions/${session.id}`,
          'PUT', headers, putBody
        );

        // Se der 401, o token pode ter sido rotacionado no cookie e causou mismatch.
        // Vamos pegar o token mais recente e tentar de novo.
        if (putResult && putResult.status === 401) {
          console.log('[Duo Tools] 401 recebido no PUT, atualizando JWT e tentando novamente...');
          const newJwt = await getValidJWT(true);
          if (newJwt) {
            headers['Authorization'] = `Bearer ${newJwt}`;
            putResult = await duolingoFetchViaContentScript(
              `https://www.duolingo.com/2017-06-30/sessions/${session.id}`,
              'PUT', headers, putBody
            );
          }
        }

        if (!putResult || !putResult.ok) {
          const errorMsg = putResult?.error || `Falha ao atualizar sessão (${putResult?.status || '?'}): ${putResult?.body?.substring(0, 200) || 'sem resposta'}`;
          sendProgressUpdate('xp_error', { errorText: errorMsg });
          isXPFarmRunning = false;
          return xp;
        }

        const sessionResultObj = JSON.parse(putResult.body);
        const gainedXP = sessionResultObj.xpGain;
        xp += gainedXP;

        console.log(`[Duo Tools] Lição ${i + 1}/${LESSONS} concluída. XP ganho: ${gainedXP}. Total: ${xp}`);

        sendProgressUpdate('xp_progress', {
          completed: i + 1,
          total: LESSONS,
          currentXP: xp,
          targetXP: targetXP
        });

        // Delay entre lições para evitar rate limiting
        await new Promise(r => setTimeout(r, 1000));

      } catch (err) {
        sendProgressUpdate('xp_error', { errorText: `Exceção na sessão: ${err.message}` });
        isXPFarmRunning = false;
        return xp;
      }
    }

    console.log(`[Duo Tools] Farm completo! XP total: ${xp}`);
    sendProgressUpdate('xp_completed', { totalXP: xp });
    isXPFarmRunning = false;
    return xp;

  } catch (error) {
    sendProgressUpdate('xp_error', { errorText: error.message });
    isXPFarmRunning = false;
    return 0;
  }
}

// ─── Modo Super (Unlimited-Hearts) ───────────────────────────
// A lógica de patch reside no page-patch.js (mundo MAIN) e no
// content-script.js (mundo isolado). O background gerencia o estado
// armazenado e responde a mensagens FETCH_AND_PATCH do content-script.js
// (replicando o background.js do Unlimited-Hearts).

// Importar patches inline (não podemos usar ES modules no service worker sem type:module,
// mas o spec mantém o background sem módulos para compatibilidade).
// O applyPatches é chamado diretamente da função abaixo.

// ─── Listener principal de mensagens ─────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── Fetch API proxy (chama API pelo content script)
  if (message.action === 'duolingo_api') {
    // Este handler não será chamado aqui pois a mensagem vai de background → content script.
    // Mas caso venha do content-script (relay): não faz nada, tratado diretamente.
    return false;
  }

  // ── Get JWT
  if (message.action === 'fetch_jwt') {
    getValidJWT().then(jwt => sendResponse({ jwt })).catch(() => sendResponse({ jwt: null }));
    return true;
  }

  // ── Farm de XP: iniciar
  if (message.action === 'start_xp_farm') {
    if (isXPFarmRunning) {
      sendResponse({ error: 'Farm já está rodando' });
      return true;
    }

    const { targetXP, enableBonus } = message;
    isXPFarmRunning = true;
    xpFarmStopped = false;

    chrome.storage.local.set({
      xpFarmState: {
        targetXP,
        isRunning: true,
        currentXP: 0,
        timestamp: Date.now()
      }
    });

    runXPFarm(targetXP, enableBonus)
      .then(totalXP => {
        chrome.storage.local.set({ xpFarmState: { isRunning: false, lastXP: totalXP, timestamp: Date.now() } });
      })
      .catch(err => {
        isXPFarmRunning = false;
        chrome.storage.local.set({ xpFarmState: { isRunning: false, error: err.message } });
      });

    sendResponse({ status: 'started' });
    return true;
  }

  // ── Farm de XP: parar
  if (message.action === 'stop_xp_farm') {
    xpFarmStopped = true;
    isXPFarmRunning = false;
    chrome.storage.local.remove('xpFarmState');
    sendProgressUpdate('xp_stopped', {});
    sendResponse({ status: 'stopped' });
    return true;
  }

  // ── Farm de XP: status
  if (message.action === 'get_xp_farm_status') {
    sendResponse({ isRunning: isXPFarmRunning, isStopped: xpFarmStopped });
    return true;
  }

  // ── Modo Super: fetch e patch de JS (portado do Unlimited-Hearts background.js)
  if (message?.type === 'FETCH_AND_PATCH') {
    const { url, patchMode } = message;
    (async () => {
      const mode = typeof patchMode === 'number' ? Math.min(Math.max(patchMode, 1), 9) : 1;
      try {
        const resp = await fetch(url, { cache: 'default', credentials: 'include' });
        if (!resp.ok) throw new Error('fetch failed ' + resp.status);
        const original = await resp.text();
        const patched = applyPatchesBg(url, original, mode);
        sendResponse({ ok: true, patched });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }

  // ── Flush cache de patches (Unlimited-Hearts)
  if (message?.type === 'FLUSH_PATCH_CACHE') {
    const keepMode = Number(message.keepMode);
    (async () => {
      try {
        const all = await chrome.storage.local.get(null);
        const removeKeys = Object.keys(all).filter(k => {
          const isPatched = k.startsWith('patched:');
          const isTs = k.startsWith('cachedAt:');
          if (!isPatched && !isTs) return false;
          if (Number.isFinite(keepMode)) {
            return !k.startsWith(`patched:${keepMode}:`) && !k.startsWith(`cachedAt:${keepMode}:`);
          }
          return true;
        });
        if (removeKeys.length) await chrome.storage.local.remove(removeKeys);
        sendResponse({ ok: true, removed: removeKeys.length });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  // ── Resolver exercício: comandos do popup → content script
  if (message.action === 'solve_challenge' || message.action === 'solve_skip_challenge' || message.action === 'stop_solve_skip_challenge' || message.action === 'set_delay' || message.action === 'start_auto_sequence' || message.action === 'stop_auto_sequence') {
    chrome.tabs.query({ url: ['*://*.duolingo.com/*', '*://duolingo.com/*'], active: true }, (tabs) => {
      if (!tabs || !tabs.length) {
        // tenta qualquer aba do Duolingo
        chrome.tabs.query({ url: ['*://*.duolingo.com/*', '*://duolingo.com/*'] }, (allTabs) => {
          if (allTabs && allTabs.length) {
            chrome.tabs.sendMessage(allTabs[0].id, message, () => {});
          }
        });
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, message, () => {});
    });
    sendResponse({ status: 'forwarded' });
    return true;
  }

  if (message.action === 'reload_duolingo') {
    chrome.tabs.query({ url: ['*://*.duolingo.com/*', '*://duolingo.com/*'] }, (tabs) => {
      tabs?.forEach(tab => chrome.tabs.reload(tab.id, { bypassCache: true }));
    });
    sendResponse({ status: 'reloading' });
    return true;
  }

  return false;
});

// ─── Patch logic (Unlimited-Hearts patches.js inlined para o background) ─

const APP_RE = /^app([.-].*|)\.js(\?.*|)?$/i;
const CHUNK_REGEX = /(^|\/)(app|\d{3,5})[^/]*\.js(\?.*)?$/i;

function looksLikeChunk7220(code) {
  return code.includes('isDisabled:!0,') && code.includes('.user.hasPlus');
}
function looksLikeChunk6150(code) {
  return code.includes('/mistakes-review');
}
function looksLikeChunk4370(code) {
  return code.includes('/practice-hub/words/practice');
}

function applyPatchesBg(url, code, PATCH_MODE = 1) {
  try {
    const name = (url || '').split('/').pop() || '';
    switch (PATCH_MODE) {
      case 1: {
        if (APP_RE.test(name)) code = patchApp(code);
        if (looksLikeChunk7220(code)) code = patch7220(code);
        if (looksLikeChunk6150(code)) code = patch6150(code);
        if (looksLikeChunk4370(code)) code = patch4370(code);
        return code;
      }
      case 6: {
        if (APP_RE.test(name)) code = patchAppPremium(code);
        if (looksLikeChunk7220(code)) code = patch7220(code);
        if (looksLikeChunk6150(code)) code = patch6150(code);
        if (looksLikeChunk4370(code)) code = patch4370(code);
        return code;
      }
      default:
        return code;
    }
  } catch {
    return code;
  }
}

function patchApp(code, SPEECH_PATCH_ENABLED = true) {
  code = code.replace(
    /([A-Za-z_$][\w$]*)\s*=\s*e\s*=>\s*e\.items(?!\s*[.\[(])\s*(?=[,;)}]|$)/g,
    `$1=e=>({...e.items,inventory:{...e.items.inventory,gold_subscription:{itemName:"gold_subscription",subscriptionInfo:{vendor:"STRIPE",renewing:true,isFamilyPlan:true,expectedExpiration:9999999999000}}}})`
  );
  code = code.replace(
    /([A-Za-z_$][\w$]*)\s*=\s*e\s*=>\s*e\.user(?!\s*[.\[(])\s*(?=[,;)}]|$)/g,
    `$1=(()=>{let lu=null,lpu=null;return e=>{const cu=e.user;if(cu===lu)return lpu;lu=cu;lpu={...cu,hasPlus:true};return lpu;};})()`
  );
  if (SPEECH_PATCH_ENABLED) {
    code = code.replace(
      /([A-Za-z_$][\w$]*)\s*=\s*!!window\.webkitSpeechRecognition\s*&&\s*\(\s*[A-Za-z_$][\w$]*\.Z\.chrome\s*\|\|\s*[A-Za-z_$][\w$]*\.Z\.edgeSupportedSpeaking\s*\)/g,
      (_, v) => `${v} = !!(window.SpeechRecognition || window.webkitSpeechRecognition)`
    );
  }
  return code;
}

function patchAppPremium(code) {
  const before = code;
  code = code.replace(
    /([A-Za-z_$][\w$]*)\s*=\s*e\s*=>\s*e\.items(?!\s*[.\[(])\s*(?=[,;)}]|$)/g,
    `$1=e=>({...e.items,inventory:{...e.items.inventory,premium_subscription:{itemName:"premium_subscription",subscriptionInfo:{vendor:"STRIPE",renewing:true,isFamilyPlan:true,expectedExpiration:9999999999000}}}})`
  );
  if (code === before && !code.includes('premium_subscription')) {
    code = patchApp(code).replace(/"gold_subscription"/g, '"premium_subscription"').replace(/\bgold_subscription\b/g, 'premium_subscription');
  }
  code = code.replace(
    /([A-Za-z_$][\w$]*)\s*=\s*e\s*=>\s*e\.user(?!\s*[.\[(])\s*(?=[,;)}]|$)/g,
    `$1=(()=>{let lu=null,lpu=null;return e=>{const cu=e.user;if(cu===lu)return lpu;lu=cu;lpu={...cu,hasPlus:true};return lpu;};})()`
  );
  return code;
}

function patch7220(code) {
  return code
    .replace(/isDisabled:\s*!0\s*,/g, 'isDisabled: false,')
    .replace(/isDisabled:!0,/g, 'isDisabled: false,')
    .replace(/showSuperBadge:\s*!e\s*,/g, 'showSuperBadge: false,')
    .replace(/showSuperBadge:!e,/g, 'showSuperBadge: false,')
    .replace(/e\s*=>\s*e\.user\.hasPlus/g, 'e => !e.user.hasPlus');
}

function patch6150(code) { return replaceOnButtonClick(code, '/mistakes-review', { removeDisabled: true }); }
function patch4370(code) { return replaceOnButtonClick(code, '/practice-hub/words/practice', { removeDisabled: true }); }

function replaceOnButtonClick(code, targetRoute, opts = {}) {
  let out = code;
  let cursor = 0;
  while (true) {
    const pushIdx = out.indexOf('.push(', cursor);
    if (pushIdx === -1) break;
    let p = pushIdx + '.push('.length;
    while (p < out.length && /\s/.test(out[p])) p++;
    const q = out[p];
    if (!q || (q !== '"' && q !== "'")) { cursor = pushIdx + 1; continue; }
    let q2 = p + 1; let arg = '';
    while (q2 < out.length) {
      if (out[q2] === '\\') { q2 += 2; continue; }
      if (out[q2] === q) break;
      arg += out[q2++];
    }
    if (arg !== targetRoute) { cursor = pushIdx + 1; continue; }
    const routerIdent = identBefore(out, pushIdx);
    if (!routerIdent) { cursor = pushIdx + 1; continue; }
    const keyPos = out.lastIndexOf('onButtonClick', pushIdx);
    if (keyPos === -1) { cursor = pushIdx + 1; continue; }
    const colon = out.indexOf(':', keyPos + 'onButtonClick'.length);
    if (colon === -1 || colon > pushIdx) { cursor = pushIdx + 1; continue; }
    const braceStart = out.indexOf('{', colon);
    if (braceStart === -1 || braceStart > pushIdx) { cursor = pushIdx + 1; continue; }
    const braceEnd = matchBrace(out, braceStart);
    if (braceEnd === -1 || braceEnd < pushIdx) { cursor = pushIdx + 1; continue; }
    let replaceFrom = keyPos;
    let replaceTo = braceEnd;
    let commaAfter = '';
    if (out[replaceTo + 1] === ',') { commaAfter = ','; replaceTo++; }
    if (opts.removeDisabled) {
      const parentInfo = removeDisabled(out, replaceFrom, replaceTo);
      out = parentInfo.out; replaceFrom = parentInfo.replaceFrom; replaceTo = parentInfo.replaceTo;
    }
    const replacement = `onButtonClick:()=>{${routerIdent}.push("${targetRoute}");}${commaAfter}`;
    out = out.slice(0, replaceFrom) + replacement + out.slice(replaceTo + 1);
    cursor = replaceFrom + replacement.length;
  }
  return out.replace(/,\s*,/g, ',').replace(/\{\s*,/g, '{');
}

function identBefore(str, dotPos) {
  let i = dotPos - 1;
  while (i >= 0 && /\s/.test(str[i])) i--;
  if (i < 0 || !/[A-Za-z0-9_$]/.test(str[i])) return null;
  let end = i;
  while (i >= 0 && /[A-Za-z0-9_$]/.test(str[i])) i--;
  return str.slice(i + 1, end + 1);
}

function matchBrace(str, start) {
  let depth = 0;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
    else if (ch === '"' || ch === "'" || ch === '`') {
      const q2 = ch; i++;
      while (i < str.length) {
        if (str[i] === '\\') { i += 2; continue; }
        if (str[i] === q2) break;
        i++;
      }
    }
  }
  return -1;
}

function removeDisabled(out, replaceFrom, replaceTo) {
  const scanLimit = 2000;
  const leftBound = Math.max(0, replaceFrom - scanLimit);
  let objStart = -1;
  for (let j = replaceFrom - 1; j >= leftBound; j--) {
    if (out[j] === '{') {
      const end = matchBrace(out, j);
      if (end !== -1 && end >= replaceTo) { objStart = j; break; }
    }
  }
  if (objStart === -1) return { out, replaceFrom, replaceTo };
  const objEnd = matchBrace(out, objStart);
  const objStr = out.slice(objStart, objEnd + 1);
  const patts = [
    /disabled\s*:\s*!\s*[A-Za-z_$][\w$]*\s*,/,
    /,\s*disabled\s*:\s*!\s*[A-Za-z_$][\w$]*/,
    /^\{\s*disabled\s*:\s*!\s*[A-Za-z_$][\w$]*\s*\}$/
  ];
  for (const r of patts) {
    const m = objStr.match(r);
    if (m) {
      const rel = objStr.indexOf(m[0]);
      const abs = objStart + rel;
      out = out.slice(0, abs) + out.slice(abs + m[0].length);
      const removedLen = m[0].length;
      if (abs < replaceFrom) replaceFrom -= removedLen;
      if (abs <= replaceTo) replaceTo -= removedLen;
      break;
    }
  }
  return { out: out.replace(/,\s*,/g, ','), replaceFrom, replaceTo };
}

// ─── Helper: enviar atualização de progresso ao popup ────────

function sendProgressUpdate(type, data) {
  chrome.runtime.sendMessage({ type, ...data }).catch(() => {});
  chrome.storage.local.set({
    lastProgressUpdate: { type, data, timestamp: Date.now() }
  });
}

// ─── onInstalled ─────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(['superModeEnabled', 'solveDelay', 'superModeForceEnabledV2']);
  
  // Força a ativação do Modo Super por padrão na primeira vez que essa versão rodar
  if (!stored.superModeForceEnabledV2) {
    await chrome.storage.sync.set({ superModeEnabled: true, superModeForceEnabledV2: true });
  }
  
  if (typeof stored.solveDelay === 'undefined') {
    await chrome.storage.sync.set({ solveDelay: 500 });
  }
  console.log('[Duo Tools] Extensão instalada/atualizada.');
});
