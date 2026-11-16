import { sendToBackground } from "~/core/messaging/sendToBackground";
import { BackgroundMessages } from "~/core/models/backgroundMessages";
import type { Table as GetGamesTable } from "~/core/models/boardGameArena/getGamesResponse";
import type { User } from "~/core/models/user";
import type { RegistrationStatuses, RegistrationTable } from "~/core/registrationStatus/types";
import { createHistorySource } from "./historySource";

function splitList(value: string | null | undefined): string[] {
    return value ? String(value).split(",") : [];
}

// Tables de la page « Statistiques de jeu », lues page à page ; un nouveau fil quand les filtres de l'URL changent
const historySource = createHistorySource<GetGamesTable>({
    openFeed: search => {
        let page = 1;
        return async () => {
            const tables = await gameStatsService.getTables(search, page);
            if (!tables) return null;

            page++;
            return { entries: tables, isLast: tables.length === 0 };
        };
    },
    tableIdOf: table => String(table.table_id),
    toRegistrationTable: (table, connectedUserId) => gameStatsService.toRegistrationTable(table, connectedUserId)
});

// sans `player` dans l'URL (lien « Statistiques de jeu » du menu BGA), la page affiche le joueur connecté ; getGames l'exige
const currentFilters = (connectedUser: User) => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get("player")) params.set("player", String(connectedUser.id));
    return `?${params.toString()}`;
};

export default class gameStatsService {
    /** Paramètres `getGames` d'une page, repris des filtres de l'URL de « Statistiques de jeu ». */
    static buildQuery(search: string, page: number): string {
        const urlParams = new URLSearchParams(search);
        const query = new URLSearchParams();

        const player = urlParams.get("player");
        if (player) query.set("player", player);
        query.set("opponent_id", urlParams.get("opponent_id") || "0");
        query.set("finished", urlParams.get("finished") || "0");
        ["game_id", "start_date", "end_date"].forEach(name => {
            const value = urlParams.get(name);
            if (value) query.set(name, value);
        });
        query.set("updateStats", "0");
        query.set("page", String(page));

        return query.toString();
    }

    static async getTables(search: string, page: number): Promise<GetGamesTable[] | null> {
        return sendToBackground<GetGamesTable[] | null>({
            name: BackgroundMessages.GET_BGA_GAMES,
            body: { query: gameStatsService.buildQuery(search, page) }
        })
            .then(response => response?.message ?? null)
            .catch(() => null);
    }

    /** Table normalisée, ou null si le joueur BGA connecté n'y a pas participé. */
    static toRegistrationTable(table: GetGamesTable, connectedUserId: string): RegistrationTable | null {
        const ids = splitList(table.players);
        if (!ids.includes(String(connectedUserId))) return null;

        const isAbandoned = table.normalend === "0";
        const names = splitList(table.player_names);
        // une Table abandonnée n'a ni scores ni rangs
        const scores = isAbandoned ? [] : splitList(table.scores);
        const ranks = isAbandoned ? [] : splitList(table.ranks);

        return {
            tableId: String(table.table_id),
            bgaGameId: table.game_name,
            end: new Date(Number(table.end) * 1000),
            players: ids.map((id, index) => ({
                name: names[index] ?? "",
                score: scores[index] ? Number(scores[index]) : undefined,
                rank: ranks[index] ? Number(ranks[index]) : undefined,
                isCurrentPlayer: id === String(connectedUserId)
            })),
            // getGames n'indique pas si le jeu est coopératif : la règle s'appuie alors sur la Partie Myludo
            isCooperative: false,
            isSolo: ids.length === 1,
            isAbandoned
        };
    }

    /** Calcule le Statut d'enregistrement des Tables affichées (une seule fois par Table), puis appelle `onStatuses`. */
    static showStatuses(tableIds: string[], onStatuses: (statuses: RegistrationStatuses) => void) {
        return historySource.showStatuses(currentFilters, tableIds, onStatuses);
    }

    /** Recalcule le Statut d'enregistrement de Tables déjà affichées (Tables invalidées), à la suite des autres calculs. */
    static refreshStatuses(tableIds: string[]): Promise<RegistrationStatuses> {
        return historySource.refreshStatuses(currentFilters, tableIds);
    }
}
