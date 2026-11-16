import { sendToBackground } from "~/core/messaging/sendToBackground";
import { BackgroundMessages } from "~/core/models/backgroundMessages";
import type { Table as GetGamesTable } from "~/core/models/boardGameArena/getGamesResponse";
import type { User } from "~/core/models/user";
import type { RegistrationStatuses, RegistrationTable } from "~/core/registrationStatus/types";
import boardGameArenaService from "./boardGameArenaService";
import registrationStatusService from "./registrationStatusService";

// nombre maximal de pages `getGames` lues pour retrouver les lignes affichées
const MAX_PAGES = 30;

// état de la page « Statistiques de jeu » courante
const knownTables = new Map<string, GetGamesTable>();
const requestedTableIds = new Set<string>();
let nextPage = 1;
let noMorePages = false;
let currentSearch: string | null = null;
let connectedUser: Promise<User | null> | null = null;
let queue: Promise<void> = Promise.resolve();

function splitList(value: string | null | undefined): string[] {
    return value ? String(value).split(",") : [];
}

/** Repart de la première page `getGames` si les filtres de l'URL ont changé. */
function resetIfFiltersChanged() {
    if (currentSearch === window.location.search) return;

    currentSearch = window.location.search;
    knownTables.clear();
    nextPage = 1;
    noMorePages = false;
}

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

    static async getTables(page: number): Promise<GetGamesTable[] | null> {
        return sendToBackground<GetGamesTable[] | null>({
            name: BackgroundMessages.GET_BGA_GAMES,
            body: { query: gameStatsService.buildQuery(window.location.search, page) }
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

    /** Lit les pages `getGames` suivantes jusqu'à connaître toutes les Tables demandées. */
    private static async loadTables(tableIds: string[]) {
        resetIfFiltersChanged();

        while (!noMorePages && nextPage <= MAX_PAGES && tableIds.some(id => !knownTables.has(id))) {
            const tables = await gameStatsService.getTables(nextPage);

            if (!tables) return;
            if (tables.length === 0) {
                noMorePages = true;
                return;
            }

            tables.forEach(table => knownTables.set(String(table.table_id), table));
            nextPage++;
        }
    }

    private static async computeStatuses(tableIds: string[], onStatuses: (statuses: RegistrationStatuses) => void) {
        const newTableIds = tableIds.filter(id => !requestedTableIds.has(id));
        if (newTableIds.length === 0) return;
        newTableIds.forEach(id => requestedTableIds.add(id));

        connectedUser ??= boardGameArenaService.isConnected().then(user => user || null);
        const user = await connectedUser;
        if (!user) return;

        await gameStatsService.loadTables(newTableIds);

        const tables = newTableIds
            .map(id => knownTables.get(id))
            .map(table => table ? gameStatsService.toRegistrationTable(table, user.id) : null)
            .filter((table): table is RegistrationTable => table !== null);

        if (tables.length === 0) return;

        onStatuses(await registrationStatusService.getStatuses(tables));
    }

    /** Calcule le Statut d'enregistrement des Tables affichées (une seule fois par Table), puis appelle `onStatuses`. */
    static showStatuses(tableIds: string[], onStatuses: (statuses: RegistrationStatuses) => void) {
        queue = queue
            .then(() => gameStatsService.computeStatuses(tableIds, onStatuses))
            .catch(error => console.error("Error computing Myludo registration statuses:", error));
        return queue;
    }
}
