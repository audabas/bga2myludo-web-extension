import type { RegistrationTable } from "~/core/registrationStatus/types";
import configurationService from "~/core/services/configurationService";

const MYLUDO_CONTACT_URL = "https://www.myludo.fr/#!/contact/technique";

interface LinkConfig {
    tableId: string;
    gameId: string | null;
    isButton?: boolean;
}

interface LinkResult {
    href: string;
    text: string;
    tooltip?: string;
    cssClass?: string;
}

export default class boardGameArenaHelper {
    /** URL du lien unitaire : le formulaire Myludo de la Table, prérempli par le script Myludo. */
    static myludoPlayUrl(myludoGameId: string, tableId: string): string {
        return `https://www.myludo.fr/#!/game/${myludoGameId}/plays?bgatableid=${tableId}`;
    }

    /** URL du lien unitaire d'une Table, ou null si son jeu n'a pas de Correspondance de jeu (Jeu indisponible). */
    static async myludoFormUrl(table: Pick<RegistrationTable, "bgaGameId" | "tableId">): Promise<string | null> {
        const gameInfo = await configurationService.getGame(table.bgaGameId);
        return gameInfo?.currentMyludoId ? boardGameArenaHelper.myludoPlayUrl(gameInfo.currentMyludoId, table.tableId) : null;
    }

    private static async createLinkElement(config: LinkConfig): Promise<LinkResult> {
        try {
            // Si gameId est null, retourner un lien en erreur
            if (!config.gameId) {
                return {
                    href: MYLUDO_CONTACT_URL,
                    text: chrome.i18n.getMessage("linkErrorText"),
                    cssClass: config.isButton ? "bgabutton_red" : undefined
                };
            }

            // Vérifier si le jeu est mappé dans games.json
            const gameInfo = await configurationService.getGame(config.gameId);

            if (gameInfo && gameInfo.currentMyludoId) {
                // Jeu mappé - redirection directe vers la page du jeu
                return {
                    href: boardGameArenaHelper.myludoPlayUrl(gameInfo.currentMyludoId, config.tableId),
                    text: chrome.i18n.getMessage("myLudoLinkText") || chrome.i18n.getMessage("myludoLinkText"),
                    cssClass: config.isButton ? "bgabutton_darkgray" : undefined
                };
            } else {
                // Jeu non mappé - lien vers contact technique
                return {
                    href: MYLUDO_CONTACT_URL,
                    text: chrome.i18n.getMessage("gameUnavailableText"),
                    tooltip: chrome.i18n.getMessage("gameUnavailableTooltip"),
                    cssClass: config.isButton ? "bgabutton_red" : undefined
                };
            }
        } catch (error) {
            console.error("Error creating Myludo link:", error);
            // Fallback en cas d'erreur
            return {
                href: MYLUDO_CONTACT_URL,
                text: chrome.i18n.getMessage("linkErrorText"),
                cssClass: config.isButton ? "bgabutton_red" : undefined
            };
        }
    }

    static async getMyLudoLink(tableId: string, gameId: string | null) {
        const link = document.createElement("a");
        link.target = "_blank";
        link.classList.add("myludo-browser-extension-button");
        link.dataset.myludoTableId = tableId;

        const result = await this.createLinkElement({ tableId, gameId, isButton: false });
        link.href = result.href;
        link.textContent = result.text;
        if (result.tooltip) {
            link.title = result.tooltip;
        }

        return link;
    }

    static async getMyLudoButton(tableId: string, gameId: string | null) {
        const link = document.createElement("a");
        link.target = "_blank";
        link.classList.add("myludo-browser-extension-button", "action-button", "bgabutton");
        link.style.cssText = "display: inline;";
        link.dataset.myludoTableId = tableId;

        const result = await this.createLinkElement({ tableId, gameId, isButton: true });
        link.href = result.href;
        link.textContent = result.text;
        if (result.cssClass) {
            link.classList.add(result.cssClass);
        }
        if (result.tooltip) {
            link.title = result.tooltip;
        }

        return link;
    }

    private static extractGameIdFromPattern(source: string | null, pattern: RegExp): string | null {
        if (!source) return null;
        const match = source.match(pattern);
        return match?.[1] || null;
    }

    static extractGameIdFromIcon(iconElement: Element): string | null {
        try {
            const style = iconElement.getAttribute('style');
            return this.extractGameIdFromPattern(style, /gamemedia\/([^\/]+)\/icon/);
        } catch (error) {
            console.error("Error extracting game ID from icon:", error);
            return null;
        }
    }

    static extractGameIdFromTablePage(): string | null {
        try {
            const gameImage = document.querySelector('#pageheader .game_image_box img.game_image');
            if (!gameImage) return null;
            
            const src = gameImage.getAttribute('src');
            return this.extractGameIdFromPattern(src, /gamemedia\/([^\/]+)\/box/);
        } catch (error) {
            console.error("Error extracting game ID from table page:", error);
            return null;
        }
    }

    static extractGameIdFromEndGamePage(): string | null {
        try {
            // Extraire depuis l'URL: https://boardgamearena.com/1/yatzy?table=712581227
            // Le gameId se trouve entre le dernier / et ?table
            return this.extractGameIdFromPattern(window.location.href, /\/([^\/]+)\?table=/);
        } catch (error) {
            console.error("Error extracting game ID from end game page:", error);
            return null;
        }
    }
}