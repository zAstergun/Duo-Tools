// DuolingoSkill.js — portado do Autolingo sem modificações de lógica
// Remove verificações de paywall (tudo liberado no Duo Tools)

import DuolingoChallenge from "./DuolingoChallenge.js"

export default class DuolingoSkill {
    constructor (skill_node, type) {
        // Para qualquer sessão anterior que ainda esteja rodando
        if (window.ds && window.ds !== this) {
            clearInterval(window.ds.state_machine);
            window.ds.state_machine = null;
        }
        window.ds = this;
        this.skill_node = skill_node;
        this.type = type;
    }

    start = (start_button_selector, is_final_level) => {
        this.is_final_level = is_final_level;

        this.skill_node.children[0]?.click();
        
        const clickStartButtons = () => {
            if (this.is_final_level) {
                const btn = document.querySelector(start_button_selector) 
                         || document.querySelector('[data-test="legendary-node-button"]');
                btn?.click();
                setTimeout(() => {
                    const startConfirm = document.querySelector('[data-test="legendary-start-button"], [data-test="start-button"]') || 
                                         Array.from(document.querySelectorAll('button')).find(b => {
                                             const txt = b.textContent?.trim().toLowerCase() || "";
                                             return txt === "iniciar" || txt === "start" || txt.includes("começar") || txt.includes("praticar");
                                         });
                    startConfirm?.click();
                }, 200);
            } else {
                const btn = document.querySelector(start_button_selector) 
                         || document.querySelector('[data-test="story-review-button"]') 
                         || document.querySelector('[data-test="practice-node-button"]') 
                         || document.querySelector('[data-test*="skill-path-state"]');
                btn?.click();
            }
        };

        clickStartButtons();
        setTimeout(clickStartButtons, 200);
        setTimeout(clickStartButtons, 600);

        if (this.type === "lesson") {
            setTimeout(() => {
                this.state_machine = setInterval(this.complete_challenge, window.solver_delay);
            }, 1000);
        } else if (this.type === "story") {
            setTimeout(() => {
                this.solve_whole_story();
            }, 1000);
        } else {
            console.error(`[Duo Tools] tipo desconhecido: ${this.type}`);
        }
    }

    end () {
        clearInterval(this.state_machine);
        if (this.current_challenge) {
            this.current_challenge.end();
        }
        window.log("[Duo Tools] Lição/história concluída, parando o autocompleter!");
    }

    solve_whole_story () {
        this.state_machine = setInterval(() => {
            // Se voltou para o mapa, a história terminou — para o intervalo
            if (window.location.href.includes("duolingo.com/learn")) {
                clearInterval(this.state_machine);
                this.state_machine = null;
                window.ds = null;
                window.log("[Duo Tools] Voltou ao mapa (história concluída), parando autocompleter.");
                return;
            }

            const challenge = new DuolingoChallenge();
            if (!challenge.solve_story()) {
                // Se continueStory não executou (ex: tela final de pontuação ou intervalo), tenta Continuar
                challenge.click_next();
            }
        }, window.solver_delay);
    }

    complete_challenge = () => {
        if (window?.autolingo?.solving) {
            return; // não tenta resolver a mesma coisa duas vezes
        }

        // Se voltou para a home page, a licão terminou — para o intervalo
        if (window.location.href.includes("duolingo.com/learn")) {
            clearInterval(this.state_machine);
            this.state_machine = null;
            window.ds = null;
            window.log("[Duo Tools] Voltou ao mapa, parando autocompleter.");
            return;
        }

        // Antes de tentar achar nó de status do React, verifica proativamente se há botão de pular fala
        this.current_challenge = new DuolingoChallenge();
        if (this.current_challenge.proactive_speech_skip()) {
            return;
        }

        // Tenta encontrar o status e agir de acordo
        const status_node = document.getElementsByClassName("_3yE3H")[0];
        if (!status_node) {
            window.log("[Duo Tools] não encontrou o status node!");
            return;
        }

        const status = window.ru.ReactFiber(status_node).return.return.memoizedProps.player.status;

        window.log(status)
        switch (status) {
            case "LOADING":
                break;
            case "SKILL_PRACTICE_SPLASH":
            case "CHECKPOINT_TEST_SPLASH":
            case "FINAL_LEVEL_DUO":
            case "LEGENDARY_DUO":
            case "UNIT_TEST_SPLASH":
            case "CAPSTONE_REVIEW_SPLASH":
                this.current_challenge = new DuolingoChallenge();
                this.current_challenge.click_next();
                break;
            case "GLOBAL_PRACTICE_SPLASH":
                this.current_challenge = new DuolingoChallenge();
                this.current_challenge.click_next();
                break;
            case "GUESSING":
                this.current_challenge = new DuolingoChallenge();
                this.current_challenge.solve().then(() => {
                    this.current_challenge.click_next();
                    this.current_challenge.click_next();
                    window.autolingo.solving = false;
                }).catch(error => {
                    console.error(error);
                });
                break;
            case "SHOWING":
                break;
            case "BLAMING":
                break;
            case "GRADING":
                break;
            case "SLIDING":
            case "PARTIAL_XP_DUO_SLIDING":
                break;
            case "COACH_DUO_SLIDING":
            case "HARD_MODE_DUO_SLIDING":
                break;
            case "COACH_DUO_SPLASH":
            case "DOACH_DUO":
            case "COACH_DUO":
            case "HARD_MODE_DUO":
            case "PARTIAL_XP_DUO":
                this.current_challenge = new DuolingoChallenge();
                this.current_challenge.click_next();
                break;
            case "COACH_DUO_SUBMITTING":
            case "SUBMITTING":
                break;
            case "END_CAROUSEL":
                this.current_challenge = new DuolingoChallenge();
                this.current_challenge.click_next();
                this.current_challenge.click_next();
                this.current_challenge.click_next();
                break;
            case "PLUS_AD":
                this.current_challenge = new DuolingoChallenge();
                this.current_challenge.click_next();
                break;
            case "PRE_LESSON_TIP_SPLASH":
            case "GRAMMAR_SKILL_SPLASH":
                document.querySelector("[data-test=player-next]")?.click();
                Array.from(document.querySelectorAll("span")).forEach(e => {
                    if (e.innerText.toLowerCase().includes("start lesson") || e.innerText.toLowerCase().includes("let's go")) {
                        e?.click();
                    }
                });
                break;
            default:
                console.log("[Duo Tools] STATUS DESCONHECIDO: " + status);
                break;
        }
    }
}
