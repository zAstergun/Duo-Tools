// injected.js — Duo Tools (portado do Autolingo)
// Removidos: verificações de isPaid/isTrialActive — tudo liberado no Duo Tools
// Mantidos: toda a lógica de resolução de desafios, HUDs de skill, hotkeys
//
// Este arquivo roda no MUNDO DA PÁGINA (injetado como <script type="module">
// pelo content-script.js), por isso tem acesso aos internals do React do Duolingo.

import ReactUtils from "./ReactUtils.js"
import DuolingoSkill from "./DuolingoSkill.js"
import DuolingoChallenge from "./DuolingoChallenge.js"

const DEBUG = false;

window.ru = new ReactUtils();

// Re-habilita console.log via iframe
const frame = document.createElement('iframe');
frame.style.display = "none";
document.body.appendChild(frame);

if (DEBUG) {
    window.log = frame.contentWindow.console.log
} else {
    window.log = () => {}
}

window.log("[Duo Tools] injected.js carregado!");

// Rastreia mudanças de idioma e URL para re-injetar quando necessário
let previous_language = null;
let previous_url = null;
setInterval(() => {
    const page_data = window.ru.ReactFiber(document.querySelector("._3BJQ_"))?.return?.stateNode?.props;
    const current_language = page_data?.courses?.find(e => e.isCurrent)?.learningLanguageId;
    const current_url = document.location.href;

    if (previous_language !== current_language || previous_url !== current_url) {
        inject_autolingo();
        previous_language = current_language;
        previous_url = current_url;
    }
}, 100);

let stylesheet_loaded = false;
let the_extension_id = null;
// No Duo Tools: isPaidOrTrial é sempre true (sem paywall)
let isPaidOrTrial = true;
let isAutomationEnabled = false;
let isAutolingoInjected = false;
let currentObserver = null;
let pendingInjectionInterval = null;
let tier_img_url = null;
let legendary_img_url = null;

// Injeta stylesheet, registra event listeners de resolve
const inject = (extension_id) => {
    the_extension_id = extension_id;

    let stylesheet = document.createElement("LINK");
    stylesheet.setAttribute("rel", "stylesheet")
    stylesheet.setAttribute("type", "text/css")
    stylesheet.setAttribute("href", `${the_extension_id}/content_scripts/main.css`)
    document.body.appendChild(stylesheet)
    stylesheet.onload = () => {
        stylesheet_loaded = true;
    }

    // Listener: resolver exercício (acionado pelo popup via "Resolver")
    document.addEventListener("solve_challenge", () => {
        if (window.autolingo?.solving || window.autolingo?.active_click_next) return;
        const challenge = new DuolingoChallenge();
        if (!challenge.challenge_internals) return; // Aguarda carregar
        
        challenge.solve().then(() => {
            window.autolingo.solving = false;
        }).catch(error => {
            console.error(error);
            if (window.autolingo) window.autolingo.solving = false;
        });
    });

    // Listener: resolver e pular (acionado pelo popup via "Resolver e pular")
    document.addEventListener("solve_skip_challenge", () => {
        if (window.autolingo?.solving || window.autolingo?.active_click_next) return;
        const challenge = new DuolingoChallenge();
        if (!challenge.challenge_internals) {
            // Provavelmente estamos em uma tela de intervalo/splash (ex: tela de titãs)
            challenge.click_next();
            return;
        }
        
        challenge.solve().then(() => {
            challenge.click_next();
            window.autolingo.solving = false;
        }).catch(error => {
            console.error(error);
            if (window.autolingo) window.autolingo.solving = false;
        });
    });
}

const inject_autolingo = () => {
    // No Duo Tools: sempre liberado (isPaidOrTrial = true)
    if (!isAutomationEnabled) return;
    if (!the_extension_id) return;
    
    remove_autolingo();
    
    if (pendingInjectionInterval) {
        clearInterval(pendingInjectionInterval);
        pendingInjectionInterval = null;
    }
    
    pendingInjectionInterval = setInterval(() => {
        if (stylesheet_loaded && the_extension_id) {
            const targetNode = document.querySelector('[data-test="skill-path"]');
            if (!targetNode) return;

            clearInterval(pendingInjectionInterval);
            pendingInjectionInterval = null;

            set_hotkeys();

            function processSkillNode(skillNode) {
                const skillNodes = [...skillNode?.querySelector("div")?.children || []];
                
                skillNodes.forEach(skill_node => {
                    const skill_metadata = window.ru.ReactFiber(skill_node)?.child?.memoizedProps?.level;
                    if (!skill_metadata) return;

                    const unlocked = skill_metadata.state !== "locked";
                    const legendary_level_unlocked = skill_metadata.state === "passed";
                    const shouldShowStartButton = (
                        skill_metadata.type === "story"
                        || !legendary_level_unlocked
                        || (legendary_level_unlocked && skill_metadata.hasLevelReview)
                    );
                    const shouldShowLegendaryButton = legendary_level_unlocked;
                    const desiredButtonState = !unlocked || skill_metadata.type === "chest"
                        ? "hidden"
                        : `${shouldShowStartButton ? "start" : ""}${shouldShowStartButton && shouldShowLegendaryButton ? "+" : ""}${shouldShowLegendaryButton ? "legendary" : ""}`;
                    const existingContainer = skill_node.querySelector(".start-autolingo-skill-container");

                    if (desiredButtonState === "hidden") {
                        existingContainer?.remove();
                        return;
                    }

                    if (existingContainer?.dataset.buttonState === desiredButtonState) {
                        return;
                    }

                    existingContainer?.remove();

                    if (unlocked && skill_metadata.type !== "chest") {
                        let autolingo_skill_container = document.createElement("DIV");
                        autolingo_skill_container.className = "start-autolingo-skill-container";
                        autolingo_skill_container.dataset.buttonState = desiredButtonState;
                        skill_node.appendChild(autolingo_skill_container);

                        const lessonType = skill_metadata.type === "story" ? "story" : "lesson";

                        if (shouldShowStartButton) {
                            let start_autolingo_skill_tooltip = document.createElement("DIV");
                            start_autolingo_skill_tooltip.className = "tooltip";
                            let start_autolingo_skill = document.createElement("IMG");
                            if (tier_img_url) start_autolingo_skill.src = tier_img_url;
                            start_autolingo_skill.className = "start-autolingo-skill";
                            start_autolingo_skill.onclick = () => {
                                let ds = new DuolingoSkill(skill_node, lessonType);
                                ds.start('[data-test*="skill-path-state"]', false);
                            };
                            let start_autolingo_tooltip_text = document.createElement("SPAN");
                            start_autolingo_tooltip_text.innerHTML = `Completar <strong>${skill_metadata.type}</strong> com Duo Tools.`;
                            start_autolingo_tooltip_text.className = "tooltip-text";
                            start_autolingo_skill_tooltip.appendChild(start_autolingo_tooltip_text);
                            start_autolingo_skill_tooltip.appendChild(start_autolingo_skill);
                            autolingo_skill_container.appendChild(start_autolingo_skill_tooltip);
                        }

                        if (shouldShowLegendaryButton) {
                            let final_autolingo_skill_tooltip = document.createElement("DIV");
                            final_autolingo_skill_tooltip.className = "tooltip";
                            let final_autolingo_skill = document.createElement("IMG");
                            if (legendary_img_url) final_autolingo_skill.src = legendary_img_url;
                            final_autolingo_skill.className = "final-autolingo-skill";
                            final_autolingo_skill.onclick = () => {
                                let ds = new DuolingoSkill(skill_node, lessonType);
                                ds.start('[data-test="legendary-node-button"]', true);
                            };
                            let final_autolingo_tooltip_text = document.createElement("SPAN");
                            final_autolingo_tooltip_text.innerHTML = `Completar <strong>lendário ${skill_metadata.type}</strong> com Duo Tools.`;
                            final_autolingo_tooltip_text.className = "tooltip-text";
                            final_autolingo_skill_tooltip.appendChild(final_autolingo_tooltip_text);
                            final_autolingo_skill_tooltip.appendChild(final_autolingo_skill);
                            autolingo_skill_container.appendChild(final_autolingo_skill_tooltip);
                        }
                    }
                });
            }

            Array.from(targetNode.querySelectorAll('[data-test*="skill-path-unit"]')).forEach(e => {
                processSkillNode(e);
            });

            const processAffectedSkillUnits = (node) => {
                if (!(node instanceof Element)) return;
                const skillPathUnit = node.matches('[data-test*="skill-path-unit"]')
                    ? node
                    : node.closest('[data-test*="skill-path-unit"]');
                if (skillPathUnit) { processSkillNode(skillPathUnit); }
                node.querySelectorAll?.('[data-test*="skill-path-unit"]').forEach(processSkillNode);
            };

            currentObserver = new MutationObserver((mutationsList) => {
                for (const mutation of mutationsList) {
                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach(node => {
                            processAffectedSkillUnits(node);
                        });
                    }
                }
            });

            currentObserver.observe(targetNode, { childList: true, subtree: true });
            isAutolingoInjected = true;
        }
    }, 100)
}

const remove_autolingo = () => {
    if (currentObserver) { currentObserver.disconnect(); currentObserver = null; }
    if (pendingInjectionInterval) { clearInterval(pendingInjectionInterval); pendingInjectionInterval = null; }
    document.querySelectorAll('.start-autolingo-skill-container').forEach(el => el.remove());
    isAutolingoInjected = false;
}

let hotkeysSet = false;
const set_hotkeys = () => {
    if (hotkeysSet) return;
    hotkeysSet = true;
    document.addEventListener("keydown", e => {
        // Ctrl+Enter: resolver e pular
        if (e.key === "Enter" && e.ctrlKey) {
            const challenge = new DuolingoChallenge();
            challenge.solve().then(() => {
                challenge.click_next();
                window.autolingo.solving = false;
            }).catch(error => console.error(error));
        }
        // Alt+Enter: apenas resolver
        if (e.key === "Enter" && e.altKey) {
            const challenge = new DuolingoChallenge();
            challenge.solve().then(() => {
                window.autolingo.solving = false;
            }).catch(error => console.error(error));
        }
        // Alt+S: pular exercício de fala
        if (e.key === "s" && e.altKey) {
            document.querySelector("[data-test='player-skip']")?.click();
        }
    });
}

// ─── Event Listeners ─────────────────────────────────────────

document.addEventListener("extension_id", e => {
    const extension_id = `chrome-extension://${e.detail.data}`;
    inject(extension_id);
});

document.addEventListener("set_icon_assets", e => {
    tier_img_url = e.detail.data.tierIconUrl;
    legendary_img_url = e.detail.data.legendaryIconUrl;
    if (isAutomationEnabled) { inject_autolingo(); }
});

document.addEventListener("set_initial_state", e => {
    const { isPaid, isTrialActive, isEnabled, delay } = e.detail.data;
    window.log("[Duo Tools] Estado inicial:", { isPaid, isTrialActive, isEnabled, delay });
    // No Duo Tools: isPaidOrTrial sempre true
    isPaidOrTrial = true;
    isAutomationEnabled = isEnabled;
    window.autolingo_delay = delay || 500;
    set_hotkeys();
    if (isAutomationEnabled) { inject_autolingo(); }
});

document.addEventListener("enable_automation", () => {
    window.log("[Duo Tools] Habilitando automação de lições");
    isAutomationEnabled = true;
    if (!isAutolingoInjected) { inject_autolingo(); }
});

document.addEventListener("disable_automation", () => {
    window.log("[Duo Tools] Desabilitando automação de lições");
    isAutomationEnabled = false;
    if (isAutolingoInjected) { remove_autolingo(); }
});

document.addEventListener("set_delay", (e) => {
    window.autolingo_delay = e.detail.data;
    window.log("[Duo Tools] Delay atualizado:", window.autolingo_delay);
});

document.addEventListener("stop_solve_skip_challenge", () => {
    if (window.autolingo) {
        if (window.autolingo.click_next_interval) {
            clearInterval(window.autolingo.click_next_interval);
            window.autolingo.click_next_interval = null;
        }
        window.autolingo.click_next_count = 0;
        window.autolingo.active_click_next = false;
        window.autolingo.solving = false;
        window.log("[Duo Tools] Solver loop cancelado internamente.");
    }
    if (window.ds) {
        window.ds.end();
        window.ds = null;
        window.log("[Duo Tools] Robô do skill path cancelado.");
    }
});

// Inicia: pede o extension_id para o content-script.js
window.dispatchEvent(new CustomEvent("get_extension_id", { detail: null }));
