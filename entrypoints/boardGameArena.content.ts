import boardGameArenaHelper from "~/core/helpers/boardGameArenaHelper";
import registrationStatusDisplayHelper from "~/core/helpers/registrationStatusDisplayHelper";
import gameStatsService from "~/core/services/gameStatsService";
import lastResultsService from "~/core/services/lastResultsService";

export default defineContentScript({
    matches: ["https://boardgamearena.com/*"],
    allFrames: true,
    main() {
        const myLudoEltId = "myludo-browser-extension-button";

        patch();

        async function patch() {
            const regexTablePage = /^https:\/\/boardgamearena\.com\/table\?table=\d+#?$/;
            const regexpEndGamePage = /^https:\/\/boardgamearena\.com\/.*\btable=\d+.*$/;
            const regexpGameStatsPage = /^https:\/\/boardgamearena\.com\/gamestats/;
            const regexpLastResultsPage = /^https:\/\/boardgamearena\.com\/player\?(?=.*[?&]section=lastresults(&|$))/;

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
            const links = document.querySelectorAll<HTMLAnchorElement>(`#boardposts_r a.${myLudoEltId}[data-myludo-table-id]`);
            const tableIds = Array.from(links, link => link.dataset.myludoTableId!);
            // joueur dont la page est affichée (absent : le joueur connecté)
            const playerId = new URLSearchParams(window.location.search).get("id");

            lastResultsService.showStatuses(playerId, tableIds, statuses => registrationStatusDisplayHelper.apply(statuses));
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
            const links = document.querySelectorAll<HTMLAnchorElement>(`#gamelist_inner a.${myLudoEltId}[data-myludo-table-id]`);
            const tableIds = Array.from(links, link => link.dataset.myludoTableId!);

            gameStatsService.showStatuses(tableIds, statuses => registrationStatusDisplayHelper.apply(statuses));
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
