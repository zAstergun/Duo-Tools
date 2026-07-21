# Duo Tools — Extensão Chrome Manifest V3

Farm de XP · Modo Super · Resolver exercícios

## Como instalar

1. Abra o Chrome e navegue para `chrome://extensions`
2. Ative o **Modo desenvolvedor** (toggle no canto superior direito)
3. Clique em **"Carregar sem compactação"**
4. Selecione a pasta: `Duolingo Cheat/Duo-Tools/`
5. A extensão aparecerá com o ícone âmbar/rosa na barra de ferramentas

## Funcionalidades

### ⚡ Farm de XP

- Define quantos XP quer ganhar e clica em **Iniciar**
- Barra de progresso em tempo real
- Checkbox "Pontos bônus" habilita enableBonusPoints na API
- Funciona via chamadas diretas à API do Duolingo (não precisa interagir com a UI)

### ♾️ Modo Super

- Toggle simples On/Off
- Intercepta e patcha os chunks JS do Duolingo para ativar `hasPlus: true` e `gold_subscription`
- Remove limitações de corações e anúncios

### 🤖 Resolver exercício

- **Botão "Resolver"**: resolve a questão atual sem avançar
- **Toggle "Resolver e pular"**: quando ativado, o botão resolve e pula em loop contínuo
- **Campo "Delay (ms)"**: controla o intervalo entre ações
- Hotkeys: `Ctrl+Enter` = resolver+pular, `Alt+Enter` = só resolver, `Alt+S` = pular fala

### 🪟 Widget Flutuante In-Page

- Interface integrada diretamente na página do Duolingo (canto inferior direito)
- Acesso rápido a todas as funções sem precisar abrir o popup da extensão
- Pode ser ocultado/exibido através das configurações
- Suporte completo a múltiplos idiomas (Internacionalização)

## Estrutura do projeto

```
Duo-Tools/
├── manifest.json          # MV3, permissions combinadas dos 3 originais
├── background.js          # Service worker: farm XP + relay de patches
├── content-script.js      # Mundo isolado: proxy API + bridge postMessage
├── page-patch.js          # Mundo MAIN: intercepta chunks JS do Duolingo
├── popup.html             # UI com os 3 cards + botão café
├── popup.css              # Design 100% do duo-tools-extension
├── popup.js               # Lógica dos controles do popup
├── widget.html            # UI do widget flutuante injetado na página
├── widget.css             # Estilos do widget flutuante
├── widget.js              # Lógica do widget flutuante
├── i18n.js                # Sistema de internacionalização (i18n)
├── content_scripts/
│   ├── injected.js        # Autolingo: roda no mundo da página (React internals)
│   ├── DuolingoChallenge.js  # Resolver todos os tipos de desafio
│   ├── DuolingoSkill.js   # State machine para completar lições inteiras
│   ├── ReactUtils.js      # Utilitários para acessar React fiber
│   └── main.css           # CSS dos botões de skill na página do Duolingo
├── icons/                 # icon16/32/48/128.png (do duo-tools-extension)
└── images/                # diamond-league.png + legendary.svg (do Autolingo)
```
