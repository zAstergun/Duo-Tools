const widgetToggle = document.getElementById('widgetToggle');
const btnCafe = document.getElementById('btnCafe');

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
}

document.querySelectorAll('.lang-flag').forEach(flag => {
  flag.addEventListener('click', () => {
    applyLanguage(flag.getAttribute('data-lang'));
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.widgetLang) {
    if (changes.widgetLang.newValue !== currentLang) {
      applyLanguage(changes.widgetLang.newValue, false);
    }
  }
});

async function init() {
  const s = await chrome.storage.sync.get(['widgetEnabled', 'widgetLang']);
  
  if (s.widgetLang) {
    applyLanguage(s.widgetLang, false);
  } else {
    applyLanguage('pt-BR', false);
  }

  widgetToggle.checked = s.widgetEnabled !== undefined ? s.widgetEnabled : true;
}

widgetToggle.addEventListener('change', async () => {
  const enabled = widgetToggle.checked;
  await chrome.storage.sync.set({ widgetEnabled: enabled });
  
  // Informa a aba ativa para atualizar a visibilidade do widget
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'toggle_widget_visibility', enabled });
    }
  });
});

btnCafe.addEventListener('click', () => {
  // TODO: adicionar link do pix / buy me a coffee
  alert('Obrigado por querer apoiar! Em breve o link estará disponível.');
});

const btnRefresh = document.getElementById('btnRefresh');
if (btnRefresh) {
  btnRefresh.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) chrome.tabs.reload(tabs[0].id);
    });
  });
}

init();
