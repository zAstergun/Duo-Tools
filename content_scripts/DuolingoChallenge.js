// DuolingoChallenge.js — portado do Autolingo
// Removidas: verificações de paywall/isPaid/isTrialActive (tudo liberado no Duo Tools)
// Mantida: toda a lógica de resolução de desafios

function executeWithDelay(functionToApply, list, delayMs) {
    return new Promise((resolve) => {
        list.forEach((item, index) => {
            setTimeout(() => {
                functionToApply(item);
                if (index === list.length - 1) resolve();
            }, index * delayMs);
        });
    });
}

export default class DuolingoChallenge {
    constructor() {
        window.autolingo = this;

        // Pega os internals React da lição atual
        autolingo.challenge_internals = autolingo?.get_challenge_internals();

        // Garante que o teclado está habilitado para digitação
        if (
            autolingo?.challenge_internals?.challengeToggleState?.canToggleTyping &&
            !autolingo?.challenge_internals?.challengeToggleState?.isToggledToTyping
        ) {
            autolingo.enable_keyboard()
        }

        autolingo.challenge_node = autolingo?.challenge_internals?.challenge
        autolingo.skill_node = autolingo?.challenge_internals?.skill;

        if (autolingo?.challenge_node) {
            autolingo.source_language = autolingo?.challenge_node?.sourceLanguage;
            autolingo.target_language = autolingo?.challenge_node?.targetLanguage;
            autolingo.challenge_type = autolingo?.challenge_node?.type;
            autolingo.challenge_id = autolingo?.challenge_node?.id;
            autolingo.click_next_count = 0;
            autolingo.active_click_next = undefined;
        }
    }

    enable_keyboard () {
        document.querySelector('[data-test="player-toggle-keyboard"]')?.click()
    }

    get_challenge_internals = () => {
        const challenge_elem = window.ru.ReactFiber(document.querySelector('[data-test="challenge-header"]'));
        if (challenge_elem) {
            return challenge_elem?.memoizedProps?.children?.props;
        }
    };

    async solve () {
        if (autolingo.proactive_speech_skip()) {
            window.autolingo.solving = false;
            return;
        }
        window.log(`[Duo Tools] resolvendo! ${autolingo.challenge_type}`)
        if (!autolingo.challenge_internals) { return; }
        window.autolingo.solving = true
        if (autolingo?.challenge_type && (autolingo.challenge_type.toLowerCase().includes("speak") || autolingo.challenge_type.toLowerCase().includes("speech"))) {
            autolingo.skip_speak();
            window.autolingo.solving = false;
            return;
        }

        switch (autolingo?.challenge_type) {
            case "characterMatch":
                await autolingo.solve_character_match();
                break;
            case "translate":
                await autolingo.solve_translate();
                break;
            case "assist":
            case "form":
                await autolingo.solve_form();
                break;
            case "characterSelect":
                await autolingo.solve_character_select();
                break;
            case "judge":
                await autolingo.solve_judge();
                break;
            case "selectTranscription":
                await autolingo.solve_select_transcription();
                break;
            case "characterIntro":
                await autolingo.solve_select_transcription();
                break;
            case "select":
                await autolingo.solve_select();
                break;
            case "selectPronunciation":
                await autolingo.solve_select_transcription();
                break;
            case "listen":
            case "listenTap":
                await autolingo.solve_listen_tap();
                break;
            case "name":
                await autolingo.solve_name();
                break;
            case "gapFill":
                await autolingo.solve_form();
                break;
            case "tapCompleteTable":
                await autolingo.solve_tap_complete_table();
                break;
            case "typeCompleteTable":
                await autolingo.solve_type_complete_table();
                break;
            case "typeCloze":
            case "typeClozeTable":
                await autolingo.solve_type_complete_table();
                break;
            case "tapClozeTable":
                await autolingo.solve_tap_cloze_table();
                break;
            case "tapCloze":
                await autolingo.solve_tap_cloze();
                break;
            case "tapComplete":
                await autolingo.solve_tap_compelete();
                break;
            case "readComprehension":
                await autolingo.solve_form();
                break;
            case "listenComprehension":
                await autolingo.solve_select_transcription();
                break;
            case "dialogue":
                await autolingo.solve_select_transcription();
                break;
            case "speak":
            case "listenSpeak":
                await autolingo.skip_speak();
                break;
            case "listenMatch":
                await autolingo.solve_pairs();
                break;
            case "match":
                await autolingo.solve_match();
                break;
            case "definition":
            case "listenIsolation":
                await autolingo.solve_definition();
                break;
            case "completeReverseTranslation":
                await autolingo.solve_reverse_translate();
                break;
            case "partialReverseTranslate":
                await autolingo.solve_partialReverseTranslate();
                break;
            case "listenComplete":
                await autolingo.solve_complete_reverse_translation();
                break;
            case "patternTapComplete":
            case "orderTapComplete":
            case "radioBinary":
            case "radioSelect":
            case "radioListenRecognize":
            case "radioImageSelect":
            case "sameDifferent":
            case "syllableTap":
            case "syllableListenTap":
            case "grammar":
                await autolingo.solve_pattern_or_generic();
                break;
            default:
                console.log(`[Duo Tools] TIPO DE DESAFIO DESCONHECIDO OU NOVO: ${autolingo.challenge_type}. Tentando solver genérico...`);
                await autolingo.solve_pattern_or_generic();
                break;
        }
    }

    solve_story () {
        let status_node = document.getElementsByClassName("_2neC7")[0];
        if (!status_node) {
            const candidates = Array.from(document.querySelectorAll("div, section")).slice(0, 50);
            for (let el of candidates) {
                const fiber = window.ru?.ReactFiber(el);
                if (fiber && (fiber?.return?.memoizedProps?.continueStory || fiber?.memoizedProps?.continueStory)) {
                    status_node = el;
                    break;
                }
            }
        }
        if (status_node) {
            const fiber = window.ru?.ReactFiber(status_node);
            const cont = fiber?.return?.memoizedProps?.continueStory || fiber?.memoizedProps?.continueStory || fiber?.return?.return?.memoizedProps?.continueStory;
            if (typeof cont === "function") {
                window.log("[Duo Tools] Avançando passo da lição de história!");
                cont();
                return true;
            }
        }
        return false;
    }

    async solve_partialReverseTranslate () {
        const textToFill = autolingo.challenge_node.displayTokens.filter(token => token.isBlank).map(token => token.text).join('');
        const challenge_translate_input = document.querySelector('[contenteditable="true"]')
        window.ru.ReactFiber(challenge_translate_input)?.pendingProps?.onInput({currentTarget: {innerText: textToFill}})
    }

    proactive_speech_skip () {
        let skip_button = document.querySelector("[data-test*='cant-speak'], button[data-test*='cant-speak']");
        if (!skip_button) {
            const candidates = Array.from(document.querySelectorAll("button, [role='button'], a, div[class*='button'], div[class*='Button']"));
            skip_button = candidates.find(b => {
                const text = b.textContent?.trim().toLowerCase() || "";
                if (!text || text.length > 60) return false;
                // Exige EXPRESSAMENTE frases denotando impossibilidade de falar (nunca botões "Pular" nem de áudio)
                if (
                    text.includes("não posso falar") || text.includes("nao posso falar") ||
                    text.includes("can't speak") || text.includes("cannot speak") || text.includes("can’t speak") ||
                    text.includes("no puedo hablar") || text.includes("ne peux pas parler") ||
                    text.includes("nicht sprechen") || text.includes("non posso parlare") ||
                    text.includes("не могу говорить") || text.includes("无法说话") ||
                    text.includes("لا أستطيع التحدث")
                ) {
                    return true;
                }
                const hasSpeakWord = text.includes("falar") || text.includes("speak") || text.includes("hablar") || text.includes("parler") || text.includes("sprechen") || text.includes("parlare");
                const hasSkipContext = text.includes("não") || text.includes("nao") || text.includes("no") || text.includes("not") || text.includes("can't") || text.includes("cannot") || text.includes("can’t") || text.includes("ne ") || text.includes("non ") || text.includes("nicht") || text.includes("无法");
                return hasSpeakWord && hasSkipContext;
            });
        }
        if (skip_button) {
            const targetBtn = skip_button.closest("button, [role='button'], a") || skip_button;
            window.log("[Duo Tools] Pulando exercício de fala (proativo):", targetBtn.textContent?.trim());
            targetBtn.click();
            return true;
        }
        return false;
    }

    skip_speak () {
        let skip_button = document.querySelector("[data-test='player-skip'], [data-test='skip'], [data-test*='cant-speak'], [data-test*='player-skip']");
        if (!skip_button) {
            const candidates = Array.from(document.querySelectorAll("button, [role='button'], a, div[class*='button'], div[class*='Button']"));
            skip_button = candidates.find(b => {
                const text = b.textContent?.trim().toLowerCase() || "";
                if (!text || text.length > 50) return false;

                // Ignora explicitamente botões de gravação/interativos como "Clique para falar", "Verificar", etc.
                if (
                    text.includes("clique") || text.includes("click") || 
                    text.includes("toque") || text.includes("tap") || 
                    text.includes("pulsa") || text.includes("toca") || 
                    text.includes("appuyez") || text.includes("klicken") || 
                    text.includes("clicca") || text.includes("нажмите") ||
                    text.includes("verificar") || text.includes("check") ||
                    text.includes("continuar") || text.includes("continue") ||
                    text === "falar" || text === "speak"
                ) {
                    return false;
                }

                // Frases exatas / diretas do botão de pular fala ("Não posso falar agora", "Can't speak now")
                if (
                    text.includes("não posso falar") || text.includes("nao posso falar") ||
                    text.includes("can't speak") || text.includes("cannot speak") || text.includes("can’t speak") ||
                    text.includes("no puedo hablar") || text.includes("ne peux pas parler") ||
                    text.includes("nicht sprechen") || text.includes("non posso parlare") ||
                    text.includes("не могу говорить") || text.includes("无法说话") ||
                    text.includes("لا أستطيع التحدث")
                ) {
                    return true;
                }

                // Palavras diretas de pular/omitir
                if (
                    text.includes("pular") || text === "skip" ||
                    text.includes("omitir") || text.includes("ignorer") ||
                    text.includes("überspringen") || text.includes("пропустить") ||
                    text.includes("跳过")
                ) {
                    return true;
                }

                // Expressões combinadas de falar + negação/pular
                const hasSpeakWord = text.includes("falar") || text.includes("speak") || text.includes("hablar") || text.includes("parler") || text.includes("sprechen") || text.includes("parlare");
                const hasSkipContext = text.includes("não") || text.includes("nao") || text.includes("no") || text.includes("not") || text.includes("can't") || text.includes("cannot") || text.includes("can’t") || text.includes("ne ") || text.includes("non ") || text.includes("nicht") || text.includes("agora") || text.includes("now") || text.includes("ahora") || text.includes("maintenant") || text.includes("ora") || text.includes("jetzt") || text.includes("无法");

                return hasSpeakWord && hasSkipContext;
            });
        }
        if (skip_button) {
            const targetBtn = skip_button.closest("button, [role='button'], a") || skip_button;
            window.log("[Duo Tools] Pulando exercício de fala:", targetBtn.textContent?.trim());
            targetBtn.click();
            return true;
        }
        return false;
    }

    insert_translation = (translation) => {
        let challenge_translate_input = document.querySelector("[data-test='challenge-translate-input']");
        window.ru.ReactFiber(challenge_translate_input)?.pendingProps?.onChange({target: {value: translation}})
    }

    async solve_definition () {
        let correct_index = autolingo.challenge_node.correctIndex;
        autolingo.choose_index("[data-test='challenge-judge-text']", correct_index);
    }

    async solve_reverse_translate () {
        let translation = autolingo.challenge_node.challengeResponseTrackingProperties.best_solution
        autolingo.insert_translation(translation);
    }

    async solve_translate() {
        // Verifica se há tokens de tap disponíveis no DOM.
        // O estado do toggle pode estar desatualizado vindo de um exercício anterior,
        // por isso usamos a presença real dos tokens como fonte de verdade.
        const tap_token_nodes = document.querySelectorAll("[data-test='challenge-tap-token-text']");
        const hasTapTokens = tap_token_nodes.length > 0;

        if (!hasTapTokens) {
            // Modo de digitação: sem tokens disponíveis na tela
            let translation = autolingo.challenge_node.correctSolutions[0];
            autolingo.insert_translation(translation);
        } else {
            // Modo tap: clica nos tokens na ordem correta
            let correct_tokens = autolingo.challenge_node.correctTokens;
            let tap_tokens = {};
            const normalize = (text) => text.toLowerCase().replace(/[.,?!;:'"“”]/g, '').trim();

            Array.from(tap_token_nodes).forEach((tap_token_node) => {
                let content = normalize(tap_token_node.childNodes[0].textContent);
                if (!tap_tokens[content]) { tap_tokens[content] = []; }
                tap_tokens[content].push(tap_token_node);
            });
            await executeWithDelay((token) => {
                let tokenNorm = normalize(token);
                if (tap_tokens[tokenNorm] && tap_tokens[tokenNorm].length > 0) {
                    tap_tokens[tokenNorm].shift().click();
                }
            }, correct_tokens, window.solver_delay);
        }
    };

    async solve_listen_tap () {
        const tap_token_nodes = document.querySelectorAll("[data-test='challenge-tap-token-text']");
        const hasTapTokens = tap_token_nodes.length > 0;

        // Função auxiliar para normalizar texto (remove maiúsculas e pontuação)
        const normalize = (text) => text.toLowerCase().replace(/[.,?!;:'"“”]/g, '').trim();

        if (hasTapTokens) {
            if (autolingo.challenge_node.correctIndices) {
                await autolingo.choose_indices(
                    "[data-test='challenge-tap-token-text']",
                    autolingo.challenge_node.correctIndices,
                    document.querySelector('[data-test="word-bank"]')
                );
            } else if (autolingo.challenge_node.correctTokens) {
                let correct_tokens = autolingo.challenge_node.correctTokens;
                let tap_tokens = {};
                Array.from(tap_token_nodes).forEach((tap_token_node) => {
                    let content = normalize(tap_token_node.childNodes[0].textContent);
                    if (!tap_tokens[content]) { tap_tokens[content] = []; }
                    tap_tokens[content].push(tap_token_node);
                });
                await executeWithDelay((token) => {
                    let tokenNorm = normalize(token);
                    if (tap_tokens[tokenNorm] && tap_tokens[tokenNorm].length > 0) {
                        tap_tokens[tokenNorm].shift().click();
                    }
                }, correct_tokens, window.solver_delay);
            }
        } else {
            let translation = autolingo.challenge_node.prompt;
            autolingo.insert_translation(translation);
        }
    }

    async solve_name () {
        const answer = autolingo.challenge_node.correctSolutions[0];
        const articles = autolingo.challenge_node.articles;
        let answer_text;
        if (articles) {
            const correct_article = articles.find(article => answer.startsWith(article));
            Array.from(document.querySelectorAll("[data-test='challenge-judge-text']")).find(e => e.innerHTML === correct_article)?.click();
            answer_text = answer.replace(correct_article, "");
        } else {
            answer_text = answer;
        }
        let challenge_translate_input = document.querySelector("[data-test='challenge-text-input']");
        window.ru.ReactFiber(challenge_translate_input)?.return?.stateNode?.props?.onChange({"target": {"value": answer_text}});
    }

    async solve_tap_complete_table () {
        const tokens = autolingo.challenge_node.displayTableTokens;
        const tap_token_nodes = document.querySelectorAll("[data-test='challenge-tap-token-text']");
        let tap_tokens = {};
        Array.from(tap_token_nodes).forEach(tap_token_node => {
            let content = tap_token_node.childNodes[0].textContent;
            tap_tokens[content] = tap_token_node;
        });
        tokens.forEach(row => {
            row.forEach(cell => {
                cell = cell[0];
                if (cell.isBlank) {
                    const matching_choice = tap_tokens[cell.text];
                    if (matching_choice) { matching_choice?.click(); }
                }
            });
        });
    }

    async solve_type_complete_table () {
        const blank_inputs = document.querySelectorAll("input[type=text]");
        blank_inputs.forEach(input => {
            const fiber = autolingo.ReactFiber(input);
            const answer_token = fiber?.return?.return?.return?.return?.pendingProps;
            const answer = answer_token?.fullText?.substring(answer_token?.damageStart);
            fiber?.pendingProps?.onChange({"target": {"value": answer}});
        });
    }

    async solve_tap_cloze_table () {
        const tokens = autolingo.challenge_node?.displayTableTokens;
        const tap_token_nodes = document.querySelectorAll("[data-test='challenge-tap-token-text']");
        let tap_tokens = {};
        Array.from(tap_token_nodes).forEach(tap_token_node => {
            let content = tap_token_node?.childNodes[0]?.textContent;
            tap_tokens[content] = tap_token_node;
        });
        tokens.forEach(row => {
            row.forEach(cell => {
                cell = cell[0];
                if (cell.damageStart !== undefined) {
                    const answer = cell.text.substring(cell.damageStart);
                    const matching_choice = tap_tokens[answer];
                    if (matching_choice) { matching_choice?.click(); }
                }
            });
        });
    }

    async solve_character_match () {
        let pairs = autolingo.challenge_node.pairs;
        let tap_token_nodes = document.querySelectorAll("[data-test='challenge-tap-token-text']");
        let tap_tokens = {};
        Array.from(tap_token_nodes).forEach(tap_token_node => {
            let content = tap_token_node.childNodes[0].textContent;
            tap_tokens[content] = tap_token_node;
        });
        await executeWithDelay(pair => {
            tap_tokens[pair.character]?.click();
            tap_tokens[pair.transliteration]?.click();
        }, pairs, window.solver_delay);
    }

    async solve_pairs () {
        const nodes = document.querySelectorAll('[data-test*="-challenge-tap-token"]');
        const groupedNodes = {};
        nodes.forEach(node => {
            const dataTestKey = node.getAttribute('data-test');
            if (!groupedNodes[dataTestKey]) { groupedNodes[dataTestKey] = []; }
            groupedNodes[dataTestKey].push(node);
        });
        await executeWithDelay((pair) => {
            pair?.[0]?.click()
            pair?.[1]?.click()
        }, Object.values(groupedNodes), window.solver_delay)
    }

    async solve_match () {
        let pairs = autolingo.challenge_node.pairs;
        let tap_token_nodes = document.querySelectorAll("[data-test='challenge-tap-token-text']");
        let tap_tokens = {};
        Array.from(tap_token_nodes).forEach(tap_token_node => {
            let content = tap_token_node.childNodes[0].textContent;
            tap_tokens[content] = tap_token_node;
        });
        await executeWithDelay(pair => {
            tap_tokens[pair.learningToken]?.click();
            tap_tokens[pair.fromToken]?.click();
        }, pairs, window.solver_delay);
    }

    async solve_form () {
        let correct_index = autolingo.challenge_node.correctIndex;
        autolingo.choose_index("[data-test='challenge-choice']", correct_index);
    }
    
    async solve_character_select () {
        let correct_index = autolingo.challenge_node.correctIndex;
        autolingo.choose_index("[data-test='challenge-choice-card']", correct_index);
    }

    async solve_judge () {
        let correct_index = autolingo.challenge_node.correctIndices[0];
        autolingo.choose_index("[data-test='challenge-judge-text']", correct_index);
    }

    async solve_select_transcription () {
        let correct_index = autolingo.challenge_node.correctIndex;
        autolingo.choose_index("[data-test='challenge-judge-text']", correct_index);
    }

    async solve_select () {
        let correct_index = autolingo.challenge_node.correctIndex;
        autolingo.choose_index("[data-test*='challenge-choice']", correct_index);
    }

    async solve_complete_reverse_translation () {
        let challenge_translate_inputs = Array.from(document.querySelectorAll("[data-test='challenge-text-input']"));
        autolingo.challenge_node.displayTokens.forEach(token => {
            if (token.isBlank) {
                const answer = token.text;
                const challenge_translate_input = challenge_translate_inputs.shift();
                window.ru.ReactFiber(challenge_translate_input)?.return?.stateNode?.props?.onChange({"target": {"value": answer}});
            }
        });
    }

    async solve_tap_cloze () {
        const tap_token_nodes = document.querySelectorAll("[data-test='challenge-tap-token-text']");
        let tap_tokens = {};
        Array.from(tap_token_nodes).forEach(tap_token_node => {
            let content = tap_token_node.childNodes[0].textContent;
            tap_tokens[content] = tap_token_node;
        });
        autolingo.challenge_node.displayTokens.forEach(answer_token => {
            if (answer_token.damageStart !== undefined) {
                let answer = answer_token.text.substring(answer_token.damageStart);
                tap_tokens[answer]?.click();
            };
        });
    }

    async solve_tap_compelete () {
        await autolingo.choose_indices(
            "[data-test='challenge-tap-token-text']",
            autolingo.challenge_node.correctIndices,
            document.querySelector('[data-test="word-bank"]')
        );
    }

    async solve_pattern_or_generic() {
        const node = autolingo.challenge_node || {};
        window.log("[Duo Tools] Solucionando pattern/genérico para tipo:", autolingo.challenge_type);

        // 1. Se houver tabelas de tokens ou lacunas em tabelas (displayTableTokens)
        if (node.displayTableTokens) {
            if (autolingo.solve_tap_complete_table) {
                await autolingo.solve_tap_complete_table();
                return;
            }
        }

        // Função auxiliar para obter opções sem duplicar elementos pai/filho
        const getDistinctChoices = () => {
            const wordBank = document.querySelector('[data-test="word-bank"]');
            const root = wordBank || document;
            const selectors = [
                "[data-test='challenge-choice-card']",
                "[data-test='challenge-choice']",
                "[data-test='challenge-tap-token-text']",
                "[data-test='challenge-judge-text']",
                "[role='radio']",
                "button[data-test*='choice']"
            ];
            for (let sel of selectors) {
                const els = Array.from(root.querySelectorAll(sel));
                if (els && els.length > 0) return els;
            }
            return Array.from(root.querySelectorAll("button, [role='button']")).filter(b => {
                const testAttr = (b.getAttribute("data-test") || "").toLowerCase();
                const text = b.textContent?.trim().toLowerCase() || "";
                if (!text || text.length > 60) return false;
                return !testAttr.includes("skip") && !testAttr.includes("next") && !testAttr.includes("cta") && !testAttr.includes("control") && text !== "verificar" && text !== "check" && text !== "continuar" && text !== "continue" && text !== "pular" && text !== "skip";
            });
        };

        // 2. Tenta por correctIndices (ex: patternTapComplete, tapComplete, etc.)
        if (node.correctIndices && Array.isArray(node.correctIndices) && node.correctIndices.length > 0) {
            let choices = getDistinctChoices();
            if (choices.length > 0) {
                await executeWithDelay(idx => {
                    if (idx >= choices.length) idx = choices.length - 1;
                    const btn = choices[idx]?.closest("button, [role='button'], a, div") || choices[idx];
                    btn?.click();
                }, node.correctIndices, window.solver_delay);
                return;
            }
        }

        // 3. Tenta por correctIndex (ex: radioSelect, form, radioBinary, etc.)
        if (node.correctIndex !== undefined) {
            let choices = getDistinctChoices();
            if (choices.length > 0) {
                let idx = node.correctIndex;
                if (idx >= choices.length) idx = choices.length - 1;
                const btn = choices[idx]?.closest("button, [role='button'], a, div") || choices[idx];
                btn?.click();
                return;
            }
        }

        // 4. Tenta por correctTokens ou displayTokens
        if (node.correctTokens && Array.isArray(node.correctTokens) && node.correctTokens.length > 0) {
            const tap_token_nodes = document.querySelectorAll("[data-test*='tap-token'], [data-test*='choice'], [role='button'], button");
            const normalize = (text) => text.toLowerCase().replace(/[.,?!;:'"“”]/g, '').trim();
            let tap_tokens = {};
            Array.from(tap_token_nodes).forEach(el => {
                const text = normalize(el.textContent);
                if (text && text.length > 0 && text.length < 50) {
                    if (!tap_tokens[text]) tap_tokens[text] = [];
                    tap_tokens[text].push(el);
                }
            });
            await executeWithDelay((token) => {
                let tokenNorm = normalize(token);
                if (tap_tokens[tokenNorm] && tap_tokens[tokenNorm].length > 0) {
                    const el = tap_tokens[tokenNorm].shift();
                    el?.click();
                }
            }, node.correctTokens, window.solver_delay);
            return;
        }

        // 5. Se houver input de texto na tela e correctSolutions / prompt
        const input = document.querySelector("input[type='text'], [data-test='challenge-translate-input'], [data-test='challenge-text-input']");
        if (input) {
            let answer = "";
            if (node.correctSolutions && node.correctSolutions.length > 0) {
                answer = node.correctSolutions[0];
            } else if (node.prompt) {
                answer = node.prompt;
            } else if (node.best_solution) {
                answer = node.best_solution;
            }
            if (answer) {
                autolingo.insert_translation(answer);
                return;
            }
        }
        
        // 6. Fallback para tapComplete / tapCloze padrão
        if (document.querySelectorAll("[data-test='challenge-tap-token-text'], [data-test='challenge-tap-token']").length > 0) {
            if (node.displayTokens) {
                await autolingo.solve_tap_cloze();
            } else {
                await autolingo.solve_tap_compelete();
            }
        }
    }

    async choose_indices (query_selector, correctIndices, element_to_select_from=null) {
        if (element_to_select_from === null) { element_to_select_from = document }
        let choices = element_to_select_from.querySelectorAll(query_selector);
        await executeWithDelay(correct_index => {
            if (correct_index >= choices.length) { correct_index = choices.length - 1; }
            choices[correct_index]?.click();
        }, correctIndices, window.solver_delay);
    }

    choose_index = (query_selector, correct_index, element_to_select_from=null) => {
        if (element_to_select_from === null) { element_to_select_from = document }
        let choices = element_to_select_from.querySelectorAll(query_selector);
        if (correct_index >= choices.length) { correct_index = choices.length - 1; }
        choices[correct_index]?.click();
    }

    click_next = () => {
        autolingo.click_next_count = (autolingo.click_next_count || 0) + 1;
        if (!autolingo.active_click_next) {
            if (autolingo.click_next_interval) { clearInterval(autolingo.click_next_interval); }
            autolingo.set_click_next_interval();
            autolingo.active_click_next = true;
        }
    }

    set_click_next_interval = () => {
        autolingo.click_next_interval = setInterval(() => {
            let player_next_button = (
                document.querySelector("[data-test='player-next']") ||
                document.querySelector('[data-test="cta-button"]') ||
                document.querySelector('[data-test="continue-final-level"]') ||
                document.querySelector('[data-test="legendary-session-end-continue"]')
            )
            if (!player_next_button) {
                player_next_button = Array.from(document.querySelectorAll("button, [role='button']"))
                    .find(element => {
                        const text = element.textContent?.trim().toLowerCase() || "";
                        return text === "continue" || text.includes("continuar") || text.includes("praticar") || text.includes("titãs");
                    });
            }
            if (
                player_next_button &&
                !player_next_button.disabled &&
                player_next_button.getAttribute("aria-disabled") !== "true" &&
                autolingo.click_next_count > 0
            ) {
                player_next_button?.click();
                autolingo.click_next_count--;
                clearInterval(autolingo.click_next_interval);
                if (autolingo.click_next_count > 0) {
                    autolingo.active_click_next = true;
                    autolingo.set_click_next_interval();
                } else {
                    autolingo.active_click_next = false;
                }
            }
        }, window.solver_delay)
    }

    end () {
        if (autolingo.click_next_interval) { clearInterval(autolingo.click_next_interval); }
    }
}
