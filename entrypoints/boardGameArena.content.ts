import boardGameArenaHelper from "~/core/helpers/boardGameArenaHelper";
import registrationStatusDisplayHelper from "~/core/helpers/registrationStatusDisplayHelper";
import { createInvalidatedTables } from "~/core/registrationStatus/invalidatedTables";
import type { RegistrationStatuses } from "~/core/registrationStatus/types";
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

        document.addEventListener("click", invalidateClickedTable, true);
        document.addEventListener("auxclick", invalidateClickedTable, true);
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") refreshInvalidatedStatuses();
        });

        patch();

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

        async function patch() {
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

            // les lignes de « Voir plus » peuvent arriver après le délai de fetchAndFeedLastResultsPage
            const boardPosts = document.getElementById("boardposts_r");
            if (boardPosts && !boardPosts.hasAttribute('data-myludo-observer')) {
                boardPosts.setAttribute('data-myludo-observer', 'true');
                let debounce: ReturnType<typeof setTimeout> | undefined;
                new MutationObserver(() => {
                    clearTimeout(debounce);
                    debounce = setTimeout(() => fetchAndFeedLastResultsPage(page), 250);
                }).observe(boardPosts, { childList: true, subtree: true });
            }
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

                    // seuls les résultats de partie sont traités (pas les trophées ni les autres entrées)
                    if (!post.querySelector('.board-score-entry')) continue;

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
                                // une autre passe a pu traiter la ligne pendant l'attente
                                if (!row.querySelector(`a.${myLudoEltId}`)) {
                                    row.appendChild(span);
                                }
                            } catch (error) {
                                console.error("Error creating Myludo link:", error);
                            }
                        }
                    }
                }

                updateLastResultsStatuses();

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

            // les lignes de « Voir plus » peuvent arriver après le délai de fetchAndFeedStatsPage
            const gameList = document.getElementById("gamelist_inner");
            if (gameList && !gameList.hasAttribute('data-myludo-observer')) {
                gameList.setAttribute('data-myludo-observer', 'true');
                let debounce: ReturnType<typeof setTimeout> | undefined;
                new MutationObserver(() => {
                    clearTimeout(debounce);
                    debounce = setTimeout(() => fetchAndFeedStatsPage(page), 250);
                }).observe(gameList, { childList: true, subtree: true });
            }
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
                        // une autre passe a pu traiter la ligne pendant l'attente
                        if (targetRow && !targetRow.querySelector(`a.${myLudoEltId}`)) {
                            targetRow.appendChild(cell);
                        }
                    } catch (error) {
                        console.error("Error creating Myludo link:", error);
                    }
                }

                updateGameStatsStatuses();

                clearTimeout(timeout);
            }, 125);
        }
    }
});
