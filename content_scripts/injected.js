// injected.js — Duo Tools
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
(document.body || document.documentElement).appendChild(frame);

if (DEBUG) {
    window.log = frame.contentWindow.console.log
} else {
    window.log = () => {}
}

window.log("[Duo Tools] injected.js carregado!");

// Rastreia mudanças de idioma, URL e re-renders da árvore do mapa (ex: troca de curso)
let previous_url = null;
let currentObservedSkillPath = null;
setInterval(() => {
    if (!isAutomationEnabled || !the_extension_id || !tier_img_url || !legendary_img_url) return;

    const current_url = document.location.href;
    const currentSkillPath = document.querySelector('[data-test="skill-path"]');
    
    // Se mudou de URL ou se o elemento do skill path mudou (ex: o usuário trocou de idioma/curso)
    if (previous_url !== current_url || (currentSkillPath && currentSkillPath !== currentObservedSkillPath) || (currentObservedSkillPath && !document.contains(currentObservedSkillPath))) {
        previous_url = current_url;
        currentObservedSkillPath = currentSkillPath;
        window.log("[Duo Tools] Mudança de curso, URL ou re-render do mapa detectado. Reinjetando botões!");
        inject_skill_buttons();
        return;
    }

    // Auto-recuperação: se por qualquer re-render silencioso do React os botões desaparecerem
    if (currentSkillPath && isSkillButtonsInjected) {
        const anyActiveButton = currentSkillPath.querySelector('.skill-btn-container');
        if (!anyActiveButton) {
            const anyUnlockedUnit = Array.from(currentSkillPath.querySelectorAll('[data-test*="skill-path-unit"]')).some(unit => {
                const level = window.ru?.ReactFiber(unit)?.child?.memoizedProps?.level;
                return level && level.state !== "locked" && level.type !== "chest";
            });
            if (anyUnlockedUnit) {
                window.log("[Duo Tools] Botões foram limpos da tela após transição de idioma. Reinjetando automaticamente!");
                inject_skill_buttons();
            }
        }
    }
}, 400);

let stylesheet_loaded = false;
let the_extension_id = null;
// No Duo Tools: isPaidOrTrial é sempre true (sem paywall)
let isPaidOrTrial = true;
let isAutomationEnabled = false;
let isSkillButtonsInjected = false;
let currentObserver = null;
let pendingInjectionInterval = null;
let tier_img_url = null;
let legendary_img_url = null;

window.auto_seq_config = { enabled: false, target: 3, legendary: false };
window.auto_seq_state = { isRunning: false, current: 0, target: 3, legendary: false, statusText: "" };

function updateAutoSeqState(updates) {
    Object.assign(window.auto_seq_state, updates);
    window.postMessage({ source: 'duo-tools-seq-progress', autoSeqState: window.auto_seq_state, autoSeqConfig: window.auto_seq_config }, '*');
}

// Loop contínuo da Sequência Automática quando o usuário entra ou está em uma lição
setInterval(() => {
    const currentUrl = document.location.href;
    const isLessonUrl = currentUrl.includes('/lesson') || currentUrl.includes('/practice') || currentUrl.includes('/story') || currentUrl.includes('/legendary') || currentUrl.includes('/unit-test') || currentUrl.includes('/checkpoint') || currentUrl.includes('/placement');
    
    if (isLessonUrl && window.auto_seq_config.enabled) {
        if (!window.auto_seq_state.isRunning) {
            let initialCurrent = window.auto_seq_state.current || 0;
            const currentTarget = window.auto_seq_config.target || window.auto_seq_state.target || 3;
            if (window.auto_seq_state.completed || (!window.auto_seq_config.finishSection && initialCurrent >= currentTarget)) {
                initialCurrent = 0;
            }
            const stText = window.auto_seq_config.finishSection ? `⚡ Solucionando até o fim da seção (${initialCurrent + 1}ª)...` : `⚡ Solucionando lição ${initialCurrent + 1}/${currentTarget}...`;
            const stKey = window.auto_seq_config.finishSection ? "seq_stat_solving_section" : "seq_stat_solving";
            const stArgs = window.auto_seq_config.finishSection ? [initialCurrent + 1] : [initialCurrent + 1, currentTarget];
            updateAutoSeqState({ isRunning: true, current: initialCurrent, target: currentTarget, legendary: !!window.auto_seq_config.legendary, finishSection: !!window.auto_seq_config.finishSection, completed: false, statusText: stText, statusKey: stKey, statusArgs: stArgs, statusType: "" });
        }
        
        if (window.autolingo?.solving || window.autolingo?.active_click_next) return;
        const challenge = new DuolingoChallenge();
        if (challenge.proactive_speech_skip()) {
            challenge.click_next();
            return;
        }
        if (challenge.solve_story()) return;
        if (!challenge.challenge_internals) {
            challenge.click_next();
            return;
        }
        // Pula exercícios de fala pelo tipo do challenge (quando o botão ainda não apareceu no DOM)
        const ct = window.autolingo?.challenge_type || '';
        if (ct && (ct.toLowerCase().includes('speak') || ct.toLowerCase().includes('speech'))) {
            challenge.skip_speak();
            challenge.click_next();
            return;
        }
        challenge.solve().then(() => {
            challenge.click_next();
            window.autolingo.solving = false;
        }).catch(() => {
            if (window.autolingo) window.autolingo.solving = false;
        });
    }
}, 600);

// Injeta stylesheet, registra event listeners de resolve
const inject = (extension_id) => {
    the_extension_id = extension_id;

    let stylesheet = document.createElement("LINK");
    stylesheet.setAttribute("rel", "stylesheet")
    stylesheet.setAttribute("type", "text/css")
    stylesheet.setAttribute("href", `${the_extension_id}/content_scripts/main.css`)
    ;(document.head || document.documentElement).appendChild(stylesheet);
    stylesheet.onload = () => {
        stylesheet_loaded = true;
    }

    // Listener: resolver exercício (acionado pelo popup via "Resolver")
    document.addEventListener("solve_challenge", () => {
        if (window.autolingo?.solving || window.autolingo?.active_click_next) return;
        const challenge = new DuolingoChallenge();
        
        if (challenge.solve_story()) return;

        // Verifica se é exercício de fala antes de tentar resolver
        if (challenge.proactive_speech_skip()) {
            // Exercício de fala pulado: não tenta resolver, não avança (ação manual)
            return;
        }

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

        if (challenge.solve_story()) return;

        if (!challenge.challenge_internals) {
            // Provavelmente estamos em uma tela de intervalo/splash (ex: tela de titãs) ou final de história
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

const inject_skill_buttons = () => {
    // No Duo Tools: sempre liberado (isPaidOrTrial = true)
    if (!isAutomationEnabled) return;
    if (!the_extension_id) return;
    if (!tier_img_url || !legendary_img_url) return; // aguarda os ícones chegarem
    
    remove_skill_buttons();
    
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
                    const isPassed = skill_metadata.state === "passed" || skill_metadata.state === "legendary";
                    // Exibe exatamente UM botão: se já foi concluído, exibe o lendário; senão, exibe o normal.
                    const shouldShowStartButton = unlocked && !isPassed;
                    const shouldShowLegendaryButton = unlocked && isPassed;
                    const desiredButtonState = !unlocked || skill_metadata.type === "chest"
                        ? "hidden"
                        : `${shouldShowStartButton ? "start" : ""}${shouldShowLegendaryButton ? "legendary" : ""}`;
                    const existingContainer = skill_node.querySelector(".skill-btn-container");

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
                        autolingo_skill_container.className = "skill-btn-container";
                        autolingo_skill_container.dataset.buttonState = desiredButtonState;
                        skill_node.appendChild(autolingo_skill_container);

                        const lessonType = skill_metadata.type === "story" ? "story" : "lesson";

                        if (shouldShowStartButton) {
                            let start_autolingo_skill_tooltip = document.createElement("DIV");
                            start_autolingo_skill_tooltip.className = "tooltip";
                            let start_autolingo_skill = document.createElement("IMG");
                            if (tier_img_url) start_autolingo_skill.src = tier_img_url;
                            start_autolingo_skill.className = "start-skill-btn";
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
                            final_autolingo_skill.className = "final-skill-btn";
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
            currentObservedSkillPath = targetNode;
            isSkillButtonsInjected = true;
        }
    }, 100)
}

const remove_skill_buttons = () => {
    if (currentObserver) { currentObserver.disconnect(); currentObserver = null; }
    if (pendingInjectionInterval) { clearInterval(pendingInjectionInterval); pendingInjectionInterval = null; }
    document.querySelectorAll('.skill-btn-container').forEach(el => el.remove());
    currentObservedSkillPath = null;
    isSkillButtonsInjected = false;
}

let hotkeysSet = false;
const set_hotkeys = () => {
    if (hotkeysSet) return;
    hotkeysSet = true;
    document.addEventListener("keydown", e => {
        // Ctrl+Enter: resolver e pular
        if (e.key === "Enter" && e.ctrlKey) {
            const challenge = new DuolingoChallenge();
            if (challenge.solve_story()) return;
            challenge.solve().then(() => {
                challenge.click_next();
                window.autolingo.solving = false;
            }).catch(error => console.error(error));
        }
        // Alt+Enter: apenas resolver
        if (e.key === "Enter" && e.altKey) {
            const challenge = new DuolingoChallenge();
            if (challenge.solve_story()) return;
            challenge.solve().then(() => {
                window.autolingo.solving = false;
            }).catch(error => console.error(error));
        }
        // Alt+S: pular exercício de fala
        if (e.key === "s" && e.altKey) {
            const challenge = new DuolingoChallenge();
            challenge.skip_speak();
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
    if (isAutomationEnabled) { inject_skill_buttons(); }
});

document.addEventListener("set_initial_state", e => {
    const { isPaid, isTrialActive, isEnabled, delay, autoSeqConfig, autoSeqState } = e.detail.data;
    window.log("[Duo Tools] Estado inicial:", { isPaid, isTrialActive, isEnabled, delay });
    if (autoSeqConfig) window.auto_seq_config = autoSeqConfig;
    if (autoSeqState) window.auto_seq_state = autoSeqState;
    // No Duo Tools: isPaidOrTrial sempre true
    isPaidOrTrial = true;
    isAutomationEnabled = isEnabled;
    window.solver_delay = delay || 500;
    set_hotkeys();
    if (isAutomationEnabled) { inject_skill_buttons(); }
});

document.addEventListener("enable_automation", () => {
    window.log("[Duo Tools] Habilitando automação de lições");
    isAutomationEnabled = true;
    if (!isSkillButtonsInjected) { inject_skill_buttons(); }
});

document.addEventListener("disable_automation", () => {
    window.log("[Duo Tools] Desabilitando automação de lições");
    isAutomationEnabled = false;
    if (isSkillButtonsInjected) { remove_skill_buttons(); }
});

document.addEventListener("set_delay", (e) => {
    window.solver_delay = e.detail.data;
    window.log("[Duo Tools] Delay atualizado:", window.solver_delay);
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

// ─── Sequência Automática (Auto Sequence) ────────────────────

function scheduleNextLessonInSequence() {
    let attempts = 0;
    const findNextInterval = setInterval(() => {
        if (!window.auto_seq_state.isRunning) {
            clearInterval(findNextInterval);
            return;
        }
        attempts++;
        
        // 1. Fechar eventuais modais de recompensas, continuar ou não obrigado do pós-lição
        const claimBtn = document.querySelector('[data-test="claim-button"], [data-test="continue-button"], [data-test="no-thanks-button"]');
        if (claimBtn && !document.querySelector('[data-test="skill-path"]')) {
            claimBtn.click();
            return;
        }

        // 2. Localizar a seção atual do mapa
        const targetNode = document.querySelector('[data-test="skill-path"]');
        if (!targetNode) {
            if (attempts > 25) {
                clearInterval(findNextInterval);
                updateAutoSeqState({ isRunning: false, completed: true, statusText: "🛑 Mapa da seção não encontrado.", statusKey: "seq_stat_err_map", statusArgs: [], statusType: "error" });
                window.auto_seq_config.enabled = false;
            }
            return;
        }

        clearInterval(findNextInterval);

        // 3. Selecionar todos os nós destravados na seção atual (exceto baús)
        const unitElements = Array.from(targetNode.querySelectorAll('[data-test*="skill-path-unit"]'));
        let validNodes = [];
        
        unitElements.forEach(unit => {
            const skillNodes = [...unit?.querySelector("div")?.children || []];
            skillNodes.forEach(skill_node => {
                const skill_metadata = window.ru?.ReactFiber(skill_node)?.child?.memoizedProps?.level;
                if (!skill_metadata) return;
                const unlocked = skill_metadata.state !== "locked";
                if (unlocked && skill_metadata.type !== "chest") {
                    validNodes.push({ node: skill_node, meta: skill_metadata });
                }
            });
        });

        if (validNodes.length === 0) {
            window.auto_seq_config.enabled = false;
            updateAutoSeqState({ isRunning: false, completed: true, statusText: "🛑 Nenhuma lição disponível na seção.", statusKey: "seq_stat_err_empty", statusArgs: [], statusType: "error" });
            return;
        }

        // 4. Decidir qual o próximo exercício pela preferência (Normal vs Lendário/Titã)
        const preferLegendary = !!(window.auto_seq_config.legendary || window.auto_seq_state.legendary);
        let targetLesson = null;
        let isLegendaryAttempt = false;

        if (preferLegendary) {
            // Primeiro tenta lições elegíveis para Titã (passed, gold, completed)
            targetLesson = validNodes.find(item => item.meta.state === "passed" || item.meta.state === "gold" || item.meta.state === "completed");
            if (targetLesson) {
                isLegendaryAttempt = true;
            } else {
                // Fallback: faz lições normais ainda não concluídas (para destravar Titã depois)
                targetLesson = validNodes.find(item => item.meta.state !== "legendary" && item.meta.state !== "locked" && item.meta.state !== "passed" && item.meta.state !== "gold" && item.meta.state !== "completed");
                isLegendaryAttempt = false;
                if (!targetLesson) {
                    // Todas já são legendary ou não há mais nada
                    targetLesson = validNodes.find(item => item.meta.state !== "locked");
                }
            }
        } else {
            targetLesson = validNodes.find(item => item.meta.state !== "passed" && item.meta.state !== "legendary" && item.meta.state !== "gold" && item.meta.state !== "completed" && item.meta.state !== "locked");
        }

        // 5. Parar se alcançou a última lição possível da seção atual
        if (!targetLesson) {
            window.log("[Duo Tools] Última lição da seção alcançada. Não há mais lições disponíveis na seção atual.");
            const finishMsg = window.auto_seq_config.finishSection ? "🏆 Toda a seção foi concluída com sucesso!" : "🛑 Fim da seção alcançado! Sequência encerrada.";
            const finishKey = window.auto_seq_config.finishSection ? "seq_stat_section_finished" : "seq_stat_section_end";
            window.auto_seq_config.enabled = false;
            updateAutoSeqState({ isRunning: false, completed: true, statusText: finishMsg, statusKey: finishKey, statusArgs: [], statusType: "success" });
            return;
        }

        // 6. Clicar e iniciar a próxima lição
        window.log(`[Duo Tools] Abrindo lição em sequência (${isLegendaryAttempt ? "Titã" : "Normal"})...`);
        const progressText = window.auto_seq_config.finishSection ? `⚡ Abrindo próxima lição (Até o fim da seção)...` : `⚡ Abrindo lição ${window.auto_seq_state.current + 1} de ${window.auto_seq_state.target}...`;
        const progKey = window.auto_seq_config.finishSection ? "seq_stat_opening_section" : "seq_stat_opening";
        const progArgs = window.auto_seq_config.finishSection ? [] : [window.auto_seq_state.current + 1, window.auto_seq_state.target];
        updateAutoSeqState({ isRunning: true, statusText: progressText, statusKey: progKey, statusArgs: progArgs, statusType: "" });
        
        const lessonType = targetLesson.meta.type === "story" ? "story" : "lesson";
        const ds = new DuolingoSkill(targetLesson.node, lessonType);
        if (isLegendaryAttempt) {
            ds.start('[data-test="legendary-node-button"]', true);
        } else {
            ds.start('[data-test*="skill-path-state"]', false);
        }
    }, 1000);
}

document.addEventListener("start_auto_sequence", (e) => {
    const data = e.detail?.data || {};
    const finishSection = !!data.finishSection;
    const target = finishSection ? 999 : parseInt(data.target || window.auto_seq_config.target || 3, 10);
    const legendary = data.legendary !== undefined ? !!data.legendary : !!window.auto_seq_config.legendary;
    window.auto_seq_config = { enabled: true, target, legendary, finishSection };
    updateAutoSeqState({ isRunning: true, current: 0, target, legendary, finishSection, completed: false, statusText: finishSection ? "⚡ Buscando até o fim da seção..." : "⚡ Buscando próxima lição...", statusKey: finishSection ? "seq_stat_searching_section" : "seq_stat_searching", statusArgs: [], statusType: "" });
    window.log("[Duo Tools] Sequência automática iniciada via comando! Meta:", target, "Titã:", legendary, "Finalizar Seção:", finishSection);
    
    const currentUrl = document.location.href;
    const isLessonUrl = currentUrl.includes('/lesson') || currentUrl.includes('/practice') || currentUrl.includes('/story') || currentUrl.includes('/legendary') || currentUrl.includes('/unit-test') || currentUrl.includes('/checkpoint') || currentUrl.includes('/placement');
    if (!isLessonUrl) {
        scheduleNextLessonInSequence();
    }
});

document.addEventListener("stop_auto_sequence", () => {
    window.auto_seq_config.enabled = false;
    updateAutoSeqState({ isRunning: false, current: 0, completed: false, statusText: "🛑 Sequência parada pelo usuário.", statusKey: "seq_stat_stopped", statusArgs: [], statusType: "" });
    window.log("[Duo Tools] Sequência automática cancelada.");
});

document.addEventListener("update_auto_seq_config", (e) => {
    const cfg = e.detail?.data || e.detail || {};
    if (cfg && Object.keys(cfg).length > 0) {
        window.auto_seq_config = { ...window.auto_seq_config, ...cfg };
        if (cfg.finishSection !== undefined) window.auto_seq_state.finishSection = !!cfg.finishSection;
        if (cfg.target !== undefined) {
            const newTarget = parseInt(cfg.target, 10) || 3;
            window.auto_seq_state.target = newTarget;
            if (window.auto_seq_state.completed || !window.auto_seq_state.isRunning || (!window.auto_seq_config.finishSection && (window.auto_seq_state.current || 0) >= newTarget)) {
                window.auto_seq_state.current = 0;
                window.auto_seq_state.completed = false;
            }
        }
        if (cfg.legendary !== undefined) window.auto_seq_state.legendary = !!cfg.legendary;
    }
});

document.addEventListener("update_auto_seq_state", (e) => {
    const st = e.detail?.data || e.detail || {};
    if (st && Object.keys(st).length > 0) {
        Object.assign(window.auto_seq_state, st);
    }
});

document.addEventListener("lesson_completed_transition", () => {
    if (!window.auto_seq_state.isRunning || !window.auto_seq_config.enabled) return;
    window.log("[Duo Tools] Conclusão de exercício detectada! Verificando progresso da sequência automática...");
    
    window.auto_seq_state.current = (window.auto_seq_state.current || 0) + 1;
    const currentTarget = window.auto_seq_config.target || window.auto_seq_state.target || 3;
    
    if (!window.auto_seq_config.finishSection && window.auto_seq_state.current >= currentTarget) {
        window.log(`[Duo Tools] Sequência concluída com sucesso! (${window.auto_seq_state.current}/${currentTarget})`);
        window.auto_seq_config.enabled = false;
        updateAutoSeqState({ isRunning: false, completed: true, statusText: `✅ Sequência de ${currentTarget} lições finalizada!`, statusKey: "seq_stat_finished", statusArgs: [currentTarget], statusType: "success" });
        return;
    }

    const nextStatus = window.auto_seq_config.finishSection ? `⚡ Concluído ${window.auto_seq_state.current} lições! Buscando próxima na seção...` : `⚡ Concluído ${window.auto_seq_state.current}/${currentTarget}! Preparando próxima lição...`;
    const nextKey = window.auto_seq_config.finishSection ? "seq_stat_next_section" : "seq_stat_next";
    const nextArgs = window.auto_seq_config.finishSection ? [window.auto_seq_state.current] : [window.auto_seq_state.current, currentTarget];
    updateAutoSeqState({ isRunning: true, statusText: nextStatus, statusKey: nextKey, statusArgs: nextArgs, statusType: "" });
    scheduleNextLessonInSequence();
});

// Inicia: pede o extension_id para o content-script.js
window.dispatchEvent(new CustomEvent("get_extension_id", { detail: null }));
