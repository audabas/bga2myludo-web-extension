import type { BulkRegistrationModule } from "~/core/bulkRegistration/types";
import boardGameArenaHelper from "~/core/helpers/boardGameArenaHelper";
import bulkRegistrationDisplayHelper from "~/core/helpers/bulkRegistrationDisplayHelper";
import registrationStatusDisplayHelper from "~/core/helpers/registrationStatusDisplayHelper";
import { createInvalidatedTables } from "~/core/registrationStatus/invalidatedTables";
import type { RegistrationStatuses } from "~/core/registrationStatus/types";
import bulkRegistrationService from "~/core/services/bulkRegistrationService";
import gameStatsService from "~/core/services/gameStatsService";
import lastResultsService from "~/core/services/lastResultsService";
import registrationStatusService from "~/core/services/registrationStatusService";

export default defineContentScript({
    matches: ["https://boardgamearena.com/*"],
    allFrames: true,
    main() {
        const myLudoEltId = "myludo-browser-extension-button";
        const regexTablePage = /^https:\/\/boardgamearena\.com\/table\?table=\d+#?$/;
        const regexpEndGamePage = /^https:\/\/boardgamearena\.com\/.*\btable=\d+.*$/;
        const regexpGameStatsPage = /^https:\/\/boardgamearena\.com\/gamestats/;
        const regexpLastResultsPage = /^https:\/\/boardgamearena\.com\/player\?(?=.*[?&]section=lastresults(&|$))/;

        // Tables dont le lien a été cliqué : revérifiées au retour sur l'onglet
        const invalidatedTables = createInvalidatedTables(registrationStatusService);

        // option « Afficher le statut Myludo dans l'historique BGA », lue une fois au chargement de la page :
        // désactivée, l'Historique BGA se comporte exactement comme avant (ni statut, ni observateur, ni écouteur)
        let showRegistrationStatus = false;

        registrationStatusService.isHistoryEnabled()
            .then(enabled => { showRegistrationStatus = enabled; })
            .catch(error => console.error("Error reading configuration:", error))
            .then(() => {
                if (showRegistrationStatus) listenToTableLinks();
                patch();
            });

        /** Clics sur les liens Myludo et retour sur l'onglet (invalidation des Statuts d'enregistrement). */
        function listenToTableLinks() {
            document.addEventListener("click", invalidateClickedTable, true);
            document.addEventListener("auxclick", invalidateClickedTable, true);
            document.addEventListener("visibilitychange", () => {
                if (document.visibilityState === "visible") refreshInvalidatedStatuses();
            });
        }

        /** Relit les lignes quand le conteneur change : les lignes de « Voir plus » peuvent arriver après le délai de lecture. */
        function observeNewRows(containerId: string, feed: () => void) {
            const container = document.getElementById(containerId);
            if (!container || container.hasAttribute('data-myludo-observer')) return;

            container.setAttribute('data-myludo-observer', 'true');
            let debounce: ReturnType<typeof setTimeout> | undefined;
            new MutationObserver(() => {
                clearTimeout(debounce);
                debounce = setTimeout(feed, 250);
            }).observe(container, { childList: true, subtree: true });
        }

        /** Clic (ou clic molette) sur le lien Myludo d'une Table : son Statut d'enregistrement est invalidé. */
        function invalidateClickedTable(event: MouseEvent) {
            if (event.type === "auxclick" && event.button !== 1) return;
            if (!(event.target instanceof Element)) return;

            const link = event.target.closest<HTMLAnchorElement>(`a.${myLudoEltId}[data-myludo-table-id]`);
            if (!link) return;

            invalidatedTables.invalidate(link.dataset.myludoTableId!)
                .catch(error => console.error("Error invalidating Myludo registration status:", error));
        }

        /** Numéros des Tables dont le lien Myludo est affiché dans `container`. */
        function displayedTableIds(container: string): string[] {
            const links = document.querySelectorAll<HTMLAnchorElement>(`${container} a.${myLudoEltId}[data-myludo-table-id]`);
            return Array.from(links, link => link.dataset.myludoTableId!);
        }

        /** Retour sur l'onglet : seules les Tables invalidées affichées sur la page sont recalculées. */
        function refreshInvalidatedStatuses() {
            let displayed: string[];
            let recompute: (tableIds: string[]) => Promise<RegistrationStatuses>;

            if (regexpGameStatsPage.test(window.location.href)) {
                displayed = displayedTableIds("#gamelist_inner");
                recompute = tableIds => gameStatsService.refreshStatuses(tableIds);
            } else if (regexpLastResultsPage.test(window.location.href)) {
                displayed = displayedTableIds("#boardposts_r");
                recompute = tableIds => lastResultsService.refreshStatuses(lastResultsPlayerId(), tableIds);
            } else {
                return;
            }

            invalidatedTables.refresh(displayed, recompute)
                .then(statuses => registrationStatusDisplayHelper.apply(statuses))
                .catch(error => console.error("Error refreshing Myludo registration statuses:", error));
        }

        /** Joueur dont la page « Derniers résultats » est affichée (absent : le joueur connecté). */
        function lastResultsPlayerId(): string | null {
            return new URLSearchParams(window.location.search).get("id");
        }

        // panneau de l'Enregistrement groupé : URL pour laquelle il a été préparé (panneau null : pas de bouton)
        let bulkPanel: { href: string; panel: HTMLElement | null } | null = null;
        let bulkPanelPending = false;

        /** Injecte (une fois par URL) le panneau de l'Enregistrement groupé au-dessus de la liste des Tables. */
        async function injectGameStatsBulkRegistration() {
            if (bulkPanelPending) return;

            const href = window.location.href;
            if (bulkPanel && bulkPanel.href === href && (bulkPanel.panel === null || bulkPanel.panel.isConnected)) return;

            const list = document.getElementById("gamelist_inner");
            const anchor = list?.closest("table") ?? list;
            if (!anchor?.parentElement) return;

            bulkPanelPending = true;
            try {
                bulkPanel?.panel?.remove();
                const { availability, module } = await bulkRegistrationService.forGameStats();
                const panel = bulkRegistrationDisplayHelper.createPanel(availability, () => {
                    if (module && panel) analyseForBulkRegistration(panel, module);
                });
                if (panel && !anchor.isConnected) {
                    // la liste a été redessinée pendant la préparation : on réessaie au prochain passage
                    bulkPanel = null;
                    return;
                }
                if (panel) anchor.parentElement?.insertBefore(panel, anchor);
                bulkPanel = { href, panel };
            } catch (error) {
                console.error("Error preparing Myludo bulk registration:", error);
                bulkPanel = { href, panel: null };
            } finally {
                bulkPanelPending = false;
            }
        }

        /** Analyse de l'Enregistrement groupé : rien n'est écrit sur Myludo, le résultat s'affiche dans le panneau. */
        async function analyseForBulkRegistration(panel: HTMLElement, module: BulkRegistrationModule) {
            bulkRegistrationDisplayHelper.setBusy(panel, true);
            bulkRegistrationDisplayHelper.showAnalysing(panel, 0);
            try {
                const analysis = await module.analyse(progress => bulkRegistrationDisplayHelper.showAnalysing(panel, progress.tablesRead));
                bulkRegistrationDisplayHelper.showAnalysis(panel, analysis);
            } catch (error) {
                console.error("Error analysing BGA history for Myludo bulk registration:", error);
                bulkRegistrationDisplayHelper.showError(panel);
            } finally {
                bulkRegistrationDisplayHelper.setBusy(panel, false);
            }
        }

        async function patch() {
            // l'Enregistrement groupé dépend du statut Myludo ; le panneau n'est pas un lien Myludo de ligne
            if (showRegistrationStatus && window.top === window && regexpGameStatsPage.test(window.location.href)) {
                injectGameStatsBulkRegistration();
            }

            if (document.getElementsByClassName(myLudoEltId).length === 0) {
                if (regexTablePage.test(window.location.href)) {
                    await patchTablePage();
                } else if (regexpEndGamePage.test(window.location.href)) {
                    await patchEndGamePage();
                } else if (regexpGameStatsPage.test(window.location.href)) {
                    await patchGameStatsPage();
                } else if (regexpLastResultsPage.test(window.location.href)) {
                    await patchLastResultsPage();
                }
            }

            setTimeout(() => patch(), 125)
        }

        async function patchTablePage() {
            const reviewgameButton = document.getElementById("reviewgame");

            if (reviewgameButton !== null) {
                const displayStyle = window.getComputedStyle(reviewgameButton).display;

                if (displayStyle !== 'none' && displayStyle !== 'hide') {
                    const bgaButtonBar = document.querySelector(".bgabuttonbar:not(#game_end_links)");

                    if (bgaButtonBar !== null) {
                        const queryString = window.location.search;
                        const urlParams = new URLSearchParams(queryString);
                        const tableId = urlParams.get("table");

                        if (tableId) {
                            try {
                                const gameId = boardGameArenaHelper.extractGameIdFromTablePage();
                                const link = await boardGameArenaHelper.getMyLudoButton(tableId, gameId);
                                bgaButtonBar.appendChild(link);
                            } catch (error) {
                                console.error("Error creating Myludo link:", error);
                            }
                        }
                    }
                }
            }
        }

        async function patchEndGamePage() {
            const rematchButton = document.getElementById("createNew_btn");

            if (rematchButton !== null) {
                const displayStyle = window.getComputedStyle(rematchButton).display;

                if (displayStyle !== 'none' && displayStyle !== 'hide') {
                    const bgaButtonBar = document.getElementById("generalactions");

                    if (bgaButtonBar !== null) {
                        const queryString = window.location.search;
                        const urlParams = new URLSearchParams(queryString);
                        const tableId = urlParams.get("table");

                        if (tableId) {
                            try {
                                const gameId = boardGameArenaHelper.extractGameIdFromEndGamePage();
                                const link = await boardGameArenaHelper.getMyLudoButton(tableId, gameId);
                                bgaButtonBar.appendChild(link);
                            } catch (error) {
                                console.error("Error creating Myludo link:", error);
                            }
                        }
                    }
                }
            }
        }

        async function patchLastResultsPage() {
            let page = 1;

            fetchAndFeedLastResultsPage(page);

            const seeMoreButton = document.querySelector("#board_seemore_r");
            if (seeMoreButton && !seeMoreButton.hasAttribute('data-myludo-listener')) {
                seeMoreButton.setAttribute('data-myludo-listener', 'true');
                seeMoreButton.addEventListener("click", () => {
                    fetchAndFeedLastResultsPage(++page);
                });
            }

            if (showRegistrationStatus) observeNewRows("boardposts_r", () => fetchAndFeedLastResultsPage(page));
        }

        function updateLastResultsStatuses() {
            lastResultsService.showStatuses(lastResultsPlayerId(), displayedTableIds("#boardposts_r"), statuses => registrationStatusDisplayHelper.apply(statuses));
        }

        function fetchAndFeedLastResultsPage(_page: number) {
            const timeout = setTimeout(async () => {
                // on vérifie si toutes les tables sont chargés et rendues
                const rows = document.querySelectorAll('#boardposts_r .post .postcontent .postfooter:not(:has(a[href*="www.myludo.fr"]))');

                if (!rows.length) return; // Vérifie si des lignes existent

                for (const row of rows) {
                    const post = row.closest('.post');
                    if (!post) continue;

                    // avec le statut, seuls les résultats de partie sont traités (pas les trophées ni les autres entrées)
                    if (showRegistrationStatus && !post.querySelector('.board-score-entry')) continue;

                    const linkElement = post.querySelector('a[href*="/table?table="]');
                    const gameIcon = post.querySelector('.game_icon');

                    if (linkElement && gameIcon) {
                        const tableUrl = linkElement.getAttribute('href');
                        const tableIdMatch = tableUrl?.match(/table=(\d+)/);

                        if (tableIdMatch) {
                            const tableId = tableIdMatch[1]!;

                            // Extraire l'ID du jeu depuis l'icône
                            const gameId = boardGameArenaHelper.extractGameIdFromIcon(gameIcon);

                            const span = document.createElement("span");
                            span.textContent = " • ";

                            try {
                                const link = await boardGameArenaHelper.getMyLudoLink(tableId, gameId);
                                span.appendChild(link);
                                // avec l'observateur, une autre passe a pu traiter la ligne pendant l'attente
                                if (!showRegistrationStatus || !row.querySelector(`a.${myLudoEltId}`)) {
                                    row.appendChild(span);
                                }
                            } catch (error) {
                                console.error("Error creating Myludo link:", error);
                            }
                        }
                    }
                }

                if (showRegistrationStatus) updateLastResultsStatuses();

                clearTimeout(timeout);
            }, 125);
        }

        async function patchGameStatsPage() {
            const loader = document.getElementById("tablestats_loading");

            if (loader === null) return;

            const displayStyle = window.getComputedStyle(loader).display;

            if (displayStyle !== 'none' && displayStyle !== 'hide') return;

            let page = 1;

            fetchAndFeedStatsPage(page);

            const seeMoreTablesButton = document.querySelector("#see_more_tables");
            if (seeMoreTablesButton && !seeMoreTablesButton.hasAttribute('data-myludo-listener')) {
                seeMoreTablesButton.setAttribute('data-myludo-listener', 'true');
                seeMoreTablesButton.addEventListener("click", () => {
                    fetchAndFeedStatsPage(++page);
                });
            }

            if (showRegistrationStatus) observeNewRows("gamelist_inner", () => fetchAndFeedStatsPage(page));
        }

        function updateGameStatsStatuses() {
            gameStatsService.showStatuses(displayedTableIds("#gamelist_inner"), statuses => registrationStatusDisplayHelper.apply(statuses));
        }

        function fetchAndFeedStatsPage(_page: number) {
            const timeout = setTimeout(async () => {
                // on vérifie si toutes les tables sont chargés et rendues
                const rows = document.querySelectorAll('#gamelist_inner tr:not(:has(a[href*="www.myludo.fr"]))');
                if (!rows) return;

                for (const row of rows) {
                    const tableText = row.querySelector('a.table_name.bga-link')?.textContent;
                    if (!tableText) continue;

                    const tableId = tableText.slice(1); // on vire le # en début de ligne

                    // Extraire l'ID du jeu depuis l'img
                    const gameIcon = row.querySelector('img.game_icon');
                    let gameId = null;
                    if (gameIcon) {
                        const src = gameIcon.getAttribute('src');
                        if (src) {
                            const match = src.match(/gamemedia\/([^\/]+)\/icon/);
                            gameId = match?.[1] || null;
                        }
                    }

                    try {
                        const link = await boardGameArenaHelper.getMyLudoButton(tableId, gameId);
                        const cell = document.createElement("td");
                        cell.appendChild(link);

                        const targetRow = document.querySelector(`#gamelist_inner a[href="/table?table=${tableId}"]`)?.closest("tr");
                        // avec l'observateur, une autre passe a pu traiter la ligne pendant l'attente
                        if (targetRow && (!showRegistrationStatus || !targetRow.querySelector(`a.${myLudoEltId}`))) {
                            targetRow.appendChild(cell);
                        }
                    } catch (error) {
                        console.error("Error creating Myludo link:", error);
                    }
                }

                if (showRegistrationStatus) updateGameStatsStatuses();

                clearTimeout(timeout);
            }, 125);
        }
    }
});
