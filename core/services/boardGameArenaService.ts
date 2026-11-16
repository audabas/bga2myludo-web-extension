import { sendToBackground } from "~/core/messaging/sendToBackground";
import { DEFAULT_OPPONENTS_BASE_NAME } from "~/core/constants";
import { BackgroundMessages } from "~/core/models/backgroundMessages";
import type { Friend } from "~/core/models/boardGameArena/friendsResponse";
import type { Player } from "~/core/models/player";
import type { Table } from "~/core/models/table";
import type { PlayerElement } from "~/core/models/boardGameArena/tableInfosResponse";
import type { RegistrationTable } from "~/core/registrationStatus/types";
import configurationService from "./configurationService";

export default class boardGameArenaService {
    static async getTableInformations(tableId: string) {
        const realTimeMode = ["0", "1", "2", "5", "9", 0, 1, 2, 5, 9];

        const connectedUser = await sendToBackground({ name: BackgroundMessages.GET_BGA_USER })
            .then(response => { return response.message; });

        if (!connectedUser) return null;

        const response = await sendToBackground(
            {
                name: BackgroundMessages.GET_BGA_TABLE,
                body: { tableId: tableId }
            }
        ).then(response => { return response.message; });

        if (!response) return null;

        const configuration = await configurationService.get();

        const table: Table = {
            tableId: tableId,
            players: [],
            end: response.data.result.time_end,
            isCooperative: response.data.result.is_coop,
            isSolo: response.data.result.is_solo,
            isAbandoned: response.data.result.endgame_reason.includes('abandon'),
            gameId: response.data.game_name,
            duration: realTimeMode.includes(response.data.options[200]?.value) ? Math.floor(Number(response.data.result.time_duration) / 60) : undefined
        };

        let currentPlayerIndex = -1;
        // joueurs tels qu'ils apparaissent sur BGA, pour le Statut d'enregistrement
        // (le module applique lui-même nom personnalisé et correspondances de joueurs)
        const originalPlayers: Player[] = [];

        response.data.result.player.forEach((item: PlayerElement) => {
            let playerName = item.name;
            const isCurrentPlayer = playerName === connectedUser.nickname;
            const score = item.score ? Number(item.score) : undefined;
            const rank = item.gamerank ? Number(item.gamerank) : undefined;

            originalPlayers.push({ name: item.name, score, rank, isCurrentPlayer });

            if (isCurrentPlayer &&
                configuration.customizeCurrentPlayer &&
                configuration.customCurrentPlayerName) {
                playerName = configuration.customCurrentPlayerName;
            }

            if (isCurrentPlayer) currentPlayerIndex = table.players.length;

            table.players.push({ name: playerName, score, rank, isCurrentPlayer });
        });

        table.originalPlayers = originalPlayers;

        if (configuration.keepOnlyTopOpponent &&
            !table.isSolo &&
            !table.isCooperative &&
            currentPlayerIndex !== -1 &&
            table.players.length >= 2) {
            const me = table.players[currentPlayerIndex];

            // basé sur le rang BGA (pas le score) : certains jeux récompensent le score le plus bas (ex. No Mercy)
            const topOpponent = table.players.reduce((best, current, index) => {
                if (index === currentPlayerIndex) return best;
                return best === null || (current.rank ?? Infinity) < (best.rank ?? Infinity) ? current : best;
            }, null as Player | null);

            if (me && topOpponent) {
                // le rang BGA d'origine peut ne plus désigner le vainqueur une fois les autres joueurs retirés
                const meIsWinner = (me.rank ?? Infinity) <= (topOpponent.rank ?? Infinity);
                me.rank = meIsWinner ? 1 : 2;
                topOpponent.rank = meIsWinner ? 2 : 1;

                table.players = [me, topOpponent];
                // "moi" est toujours en première position dans le tableau réduit ci-dessus
                currentPlayerIndex = 0;
            }
        }

        // pas d'exclusivité volontaire entre les deux options : si les deux sont actives,
        // celle-ci s'applique après keepOnlyTopOpponent (sur les joueurs restants)
        if (configuration.renameAllOpponents &&
            !table.isSolo &&
            currentPlayerIndex !== -1) {
            const baseName = configuration.customOpponentsBaseName && configuration.customOpponentsBaseName.length > 0 ? configuration.customOpponentsBaseName : DEFAULT_OPPONENTS_BASE_NAME;

            // tri par rang BGA (pas le score) : certains jeux récompensent le score le plus bas (ex. No Mercy)
            table.players
                .filter((_, index) => index !== currentPlayerIndex)
                .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity))
                .forEach((opponent, rank) => {
                    opponent.name = rank === 0 ? baseName : `${baseName}_${rank}`;
                });
        }

        return table;
    }

    /** Table normalisée pour le module Statut d'enregistrement, à partir des données du préremplissage. */
    static toRegistrationTable(table: Table): RegistrationTable {
        const players = table.originalPlayers ?? table.players;

        return {
            tableId: String(table.tableId),
            bgaGameId: table.gameId,
            // time_end arrive en chaîne JSON malgré le type
            end: new Date(table.end),
            players: players.map(player => ({
                name: player.name,
                // comme dans l'Historique BGA : une Table abandonnée n'a ni scores ni rangs
                score: table.isAbandoned ? undefined : player.score,
                rank: table.isAbandoned ? undefined : player.rank,
                isCurrentPlayer: player.isCurrentPlayer ?? false
            })),
            isCooperative: Boolean(table.isCooperative),
            isSolo: Boolean(table.isSolo),
            isAbandoned: Boolean(table.isAbandoned)
        };
    }

    static async getFriends(): Promise<Friend[]> {
        return await sendToBackground({ name: BackgroundMessages.GET_BGA_FRIENDS })
            .then(response => { return response.message; })
            .catch((error) => { 
                console.error('Failed to fetch BGA friends:', error);
                return [];
            });
    }

    static async isConnected() {
        return sendToBackground({ name: BackgroundMessages.GET_BGA_USER })
            .then(response => { return response.message; })
            .catch(() => { return false; });
    }

    static async hasPermission(): Promise<boolean> {
        return chrome.permissions
            .contains({ origins: ['https://boardgamearena.com/*'] })
            .then((result: boolean) => { return result; })
            .catch(() => { return false });
    }

    static async requestPermission() {
        chrome.permissions.request({ origins: ['https://boardgamearena.com/*'] });
    }
}