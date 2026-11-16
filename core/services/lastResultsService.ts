import { sendToBackground } from "~/core/messaging/sendToBackground";
import { BackgroundMessages } from "~/core/models/backgroundMessages";
import type { News } from "~/core/models/boardGameArena/BoardResponse";
import type { User } from "~/core/models/user";
import type { RegistrationPlayer, RegistrationStatuses, RegistrationTable } from "~/core/registrationStatus/types";
import { createHistorySource } from "./historySource";

// type d'entrée `message/board` correspondant à un résultat de partie (les trophées sont "30")
const GAME_RESULT_NEWS_TYPE = "2";
// taille de page utilisée par BGA sur « Derniers résultats »
const PER_PAGE = 10;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

/** Position dans le fil `message/board` à partir de laquelle lire la page suivante. */
export interface BoardCursor {
    timestamp: string;
    refid: string;
}

function decodeHtml(value: string): string {
    return value
        .replace(/<[^>]*>/g, "")
        .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (entity, code: string) => {
            if (code[0] === "#") {
                const charCode = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
                return Number.isNaN(charCode) ? entity : String.fromCodePoint(charCode);
            }
            return ENTITIES[code.toLowerCase()] ?? entity;
        })
        .trim();
}

/** Joueurs d'une entrée : `<div class="board-score-entry">1st - <a href="player?id=…">pseudo</a> - 69 …</div>`. */
function parsePlayers(html: string): { id: string, player: Omit<RegistrationPlayer, "isCurrentPlayer"> }[] {
    const regex = /board-score-entry[^>]*>([^<]*)<a\s[^>]*href="\/?player\?id=(\d+)"[^>]*>([\s\S]*?)<\/a>([^<]*)/g;

    return Array.from(html.matchAll(regex), match => {
        const rank = match[1]!.match(/\d+/)?.[0];
        const score = match[4]!.match(/^\s*-\s*(-?\d+(?:\.\d+)?)/)?.[1];

        return {
            id: match[2]!,
            player: {
                name: decodeHtml(match[3]!),
                score: score !== undefined ? Number(score) : undefined,
                rank: rank !== undefined ? Number(rank) : undefined
            }
        };
    });
}

/** Numéro de Table d'une entrée `message/board`, ou null. */
function parseTableId(news: News): string | null {
    return news.html?.match(/href="\/?table\?table=(\d+)"/)?.[1] ?? null;
}

// entrées de « Derniers résultats », lues en suivant le curseur du fil ; un nouveau fil quand le joueur affiché change
const historySource = createHistorySource<News>({
    openFeed: playerId => {
        let cursor: BoardCursor | null = null;
        return async () => {
            const news = await lastResultsService.getNews(lastResultsService.buildQuery(playerId, cursor));
            if (!news) return null;

            const last = news[news.length - 1];
            const next = last ? { timestamp: String(last.timestamp), refid: String(last.refid) } : null;
            // fin du fil (ou curseur qui n'avance plus)
            const isLast = !next || (next.timestamp === cursor?.timestamp && next.refid === cursor?.refid);
            cursor = next;

            return { entries: news, isLast };
        };
    },
    tableIdOf: parseTableId,
    toRegistrationTable: (news, connectedUserId) => lastResultsService.toRegistrationTable(news, connectedUserId)
});

/** Fil du joueur `playerId`, à défaut le joueur connecté. */
const playerFeed = (playerId: string | null) => (connectedUser: User) => playerId || String(connectedUser.id);

export default class lastResultsService {
    /** Paramètres `message/board` des résultats de partie d'un joueur, à partir de `from` (page suivante) si fourni. */
    static buildQuery(playerId: string, from?: BoardCursor | null): string {
        const query = new URLSearchParams();

        query.set("type", "playerresult");
        query.set("id", playerId);
        query.set("social", "false");
        if (from) {
            query.set("page", "0");
            query.set("from_time", from.timestamp);
            query.set("from_id", from.refid);
        }
        query.set("per_page", String(PER_PAGE));

        return query.toString();
    }

    static async getNews(query: string): Promise<News[] | null> {
        return sendToBackground<News[] | null>({
            name: BackgroundMessages.GET_BGA_BOARD,
            body: { query }
        })
            .then(response => response?.message ?? null)
            .catch(() => null);
    }

    /**
     * Table normalisée d'une entrée `message/board`, ou null si ce n'est pas un résultat de partie
     * ou si le joueur BGA connecté n'y a pas participé.
     */
    static toRegistrationTable(news: News, connectedUserId: string): RegistrationTable | null {
        if (String(news.news_type) !== GAME_RESULT_NEWS_TYPE) return null;

        const tableId = parseTableId(news);
        const bgaGameId = news.img?.match(/gamemedia\/([^\/]+)\/icon/)?.[1];
        if (!tableId || !bgaGameId) return null;

        const players = parsePlayers(news.html);
        if (!players.some(({ id }) => id === String(connectedUserId))) return null;

        return {
            tableId,
            bgaGameId,
            end: new Date(Number(news.timestamp) * 1000),
            players: players.map(({ id, player }) => ({ ...player, isCurrentPlayer: id === String(connectedUserId) })),
            // le fil n'indique pas si le jeu est coopératif : la règle s'appuie alors sur la Partie Myludo
            isCooperative: false,
            isSolo: players.length === 1,
            // le fil ne liste que les parties terminées
            isAbandoned: false
        };
    }

    /**
     * Calcule le Statut d'enregistrement des Tables affichées sur « Derniers résultats » du joueur `playerId`
     * (une seule fois par Table), puis appelle `onStatuses`.
     */
    static showStatuses(playerId: string | null, tableIds: string[], onStatuses: (statuses: RegistrationStatuses) => void) {
        return historySource.showStatuses(playerFeed(playerId), tableIds, onStatuses);
    }

    /** Recalcule le Statut d'enregistrement de Tables déjà affichées (Tables invalidées), à la suite des autres calculs. */
    static refreshStatuses(playerId: string | null, tableIds: string[]): Promise<RegistrationStatuses> {
        return historySource.refreshStatuses(playerFeed(playerId), tableIds);
    }
}
