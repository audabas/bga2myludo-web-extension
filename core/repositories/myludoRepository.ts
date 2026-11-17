import type { LoginInitResponse, PlayDetailsResponse, PlayedGamesResponse, PlayItem, PlaysResponse } from "~/core/models/myludo/playsResponse";
import type { MyludoAccount, MyludoPlay, MyludoPlayDetails } from "~/core/registrationStatus/types";
import { MyludoRateLimiter } from "./myludoRateLimiter";

const MYLUDO_URL = "https://www.myludo.fr/";
// durée de réutilisation du jeton CSRF (évite de recharger la page d'accueil à chaque appel)
const CSRF_TOKEN_TTL = 10 * 60 * 1000;
// garde-fou contre une pagination incohérente
const MAX_PLAYS_PAGES = 50;
// garde-fou de la liste des jeux joués : 18 jeux par page, soit 1800 jeux
const MAX_PLAYED_GAMES_PAGES = 100;

let csrfToken: { value: string; fetchedAt: number } | null = null;

// régulateur unique de toutes les requêtes Myludo de l'extension (script de fond) ; son état est perdu à l'arrêt du service worker
const rateLimiter = new MyludoRateLimiter();

/** `fetch` vers Myludo, soumis au régulateur de débit (file d'attente, nouveaux essais après un 429). */
function fetchMyludo(url: string, init: RequestInit) {
    return rateLimiter.schedule(() => fetch(url, init));
}

function isFlagSet(value: unknown) {
    return value === true || value === 1 || value === "1";
}

/** Entier positif ou nul, en nombre ou en chaîne. */
function isCount(value: unknown) {
    return (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) && Number.isInteger(Number(value)) && Number(value) >= 0;
}

function toMyludoPlay(item: PlayItem): MyludoPlay | null {
    if (!item || item.id === undefined || item.id === null) return null;

    const date = item.date?.date;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;

    if (!Array.isArray(item.players) || item.players.some(o => !o || typeof o.name !== "string")) return null;

    return {
        id: String(item.id),
        date: date.slice(0, 10),
        online: isFlagSet(item.online),
        incomplete: isFlagSet(item.incomplete),
        coop: isFlagSet(item.coop),
        solo: isFlagSet(item.solo),
        hasComment: isFlagSet(item.comment),
        players: item.players.map(o => ({
            name: o.name!,
            score: o.score === undefined || o.score === null ? null : String(o.score)
        }))
    };
}

export default class myludoRepository {
    static async getHeaders() {
        //récupérer la home page pour récupérer le x-csrf-token dans les balises meta
        // régulée aussi : rien ne dit que la page d'accueil échappe au quota, et elle n'est chargée qu'au plus toutes les 10 minutes ou après un 403
        return fetchMyludo("https://www.myludo.fr/", { method: "GET" })
            .then(response => { return response.text() })
            .then(response => {
                const regex = /<meta\s+name="csrf-token"\s+content="([^"]+)"/;
                const match = response.match(regex);
                
                if (!match || match.length < 2) {
                    console.error("Failed to extract Myludo CSRF token from response");
                    throw new Error("Failed to extract CSRF token");
                }
                
                return new Headers([["X-Csrf-Token", match[1]!]]);
            })
            .catch((error) => { 
                console.error("Error fetching Myludo headers:", error);
                return null; 
            })
    }

    static async getUser() {
        const headers = await myludoRepository.getHeaders();

        if (!headers) return null;

        return fetchMyludo(`https://www.myludo.fr/views/login/datas.php?type=init`, { method: "GET", headers })
            .then(response => { return response.json(); })
            .then(response => { return response.user })
            .catch((error) => { 
                console.error('Failed to fetch Myludo user:', error);
                return null;
            });
    }

    /** En-têtes des endpoints de données Myludo : jeton CSRF (réutilisé quelques minutes) et XMLHttpRequest. */
    private static async getApiHeaders(forceRefresh: boolean) {
        if (forceRefresh || !csrfToken || Date.now() - csrfToken.fetchedAt > CSRF_TOKEN_TTL) {
            const headers = await myludoRepository.getHeaders();
            const value = headers?.get("X-Csrf-Token");

            csrfToken = value ? { value, fetchedAt: Date.now() } : null;
        }

        if (!csrfToken) return null;

        return new Headers([
            ["X-Csrf-Token", csrfToken.value],
            ["X-Requested-With", "XMLHttpRequest"]
        ]);
    }

    /**
     * GET JSON sur un endpoint Myludo, via le régulateur de débit ; null en cas d'erreur (dont un 429 après tous ses nouveaux essais).
     * Un 403 (jeton expiré) est retenté une fois avec un nouveau jeton, en repassant par le régulateur.
     */
    private static async getJson<T>(path: string, params: Record<string, string>): Promise<T | null> {
        const url = `${MYLUDO_URL}${path}?${new URLSearchParams(params).toString()}`;

        for (const forceRefresh of [false, true]) {
            const headers = await myludoRepository.getApiHeaders(forceRefresh);

            if (!headers) return null;

            try {
                const response = await fetchMyludo(url, { method: "GET", headers, credentials: "include" });

                if (response.status === 403 && !forceRefresh) continue;
                if (!response.ok) {
                    console.error(`Myludo ${path} answered ${response.status}`);
                    return null;
                }

                return await response.json() as T;
            } catch (error) {
                console.error(`Failed to fetch Myludo ${path}:`, error);
                return null;
            }
        }

        return null;
    }

    /** Compte Myludo connecté (id), via l'endpoint d'initialisation de la connexion. */
    static async getAccount(): Promise<MyludoAccount> {
        const response = await myludoRepository.getJson<LoginInitResponse>("views/login/datas.php", { type: "init" });

        if (!response || typeof response !== "object" || Array.isArray(response) || !("user" in response)) return { status: "error" };
        // seule une absence explicite d'utilisateur signifie « non connecté »
        if (response.user === null || response.user === false) return { status: "notConnected" };
        if (typeof response.user !== "object") return { status: "error" };

        const id = response.user.id;
        if (id === undefined || id === null || String(id) === "") return { status: "error" };

        return { status: "connected", id: String(id) };
    }

    /** Parties Myludo d'une fiche de jeu (id numérique) entre deux jours inclus (AAAA-MM-JJ), toutes pages parcourues. */
    static async getPlays(myludoGameId: string, dateFrom: string, dateTo: string): Promise<MyludoPlay[] | null> {
        const plays: MyludoPlay[] = [];
        let page = 1;
        let pages = 1;
        let count = 0;

        do {
            const response = await myludoRepository.getJson<PlaysResponse>("views/game/datas.php", {
                type: "plays",
                id: myludoGameId,
                page: String(page),
                // les deux bornes sont obligatoires, sinon le filtre est ignoré
                datefrom: dateFrom,
                dateto: dateTo,
                order: "bydatedesc"
            });

            if (!response || typeof response !== "object") return null;

            if (!Array.isArray(response.list)) {
                // aucune partie : on n'accepte qu'une réponse explicitement vide
                if (page === 1 && isCount(response.count) && Number(response.count) === 0) return plays;
                console.error("Unexpected Myludo plays response");
                return null;
            }

            for (const item of response.list) {
                const play = toMyludoPlay(item);
                if (!play) {
                    console.error("Unexpected Myludo play format");
                    return null;
                }
                plays.push(play);
            }

            // une liste tronquée pourrait donner un faux « non enregistrée » : `pages` et `count` (total toutes pages) sont exigés
            if (!isCount(response.pages) || !isCount(response.count) || Number(response.pages) > MAX_PLAYS_PAGES) {
                console.error("Unexpected Myludo plays pagination");
                return null;
            }
            pages = Number(response.pages);
            count = Number(response.count);

            page++;
        } while (page <= pages);

        if (plays.length !== count) {
            console.error("Myludo plays count mismatch");
            return null;
        }

        return plays;
    }

    /**
     * Ids numériques des fiches de jeu avec au moins une Partie Myludo, sur toute la période, toutes pages lues.
     * null si la liste est illisible ou incomplète (nombre de jeux lus différent de `count`) : elle ne doit jamais
     * faire croire qu'une fiche n'a aucune Partie Myludo.
     */
    static async getPlayedGames(): Promise<string[] | null> {
        const ids: string[] = [];
        let count: number | undefined;

        for (let page = 1; page <= MAX_PLAYED_GAMES_PAGES; page++) {
            const response = await myludoRepository.getJson<PlayedGamesResponse>("views/plays/datas.php", {
                type: "games",
                page: String(page),
                // bornes vides : toute la période
                datefrom: "",
                dateto: "",
                order: "bydatedesc"
            });

            if (!response || typeof response !== "object" || !isCount(response.count)) {
                console.error("Unexpected Myludo played games response");
                return null;
            }
            count = Number(response.count);

            // au-delà de la dernière page, la liste est un objet vide
            const list = response.list;
            const items = Array.isArray(list) ? list : list && typeof list === "object" && Object.keys(list).length === 0 ? [] : null;
            if (!items) {
                console.error("Unexpected Myludo played games list");
                return null;
            }

            for (const item of items) {
                const id = item?.id;
                if ((typeof id !== "number" && typeof id !== "string") || !/^\d+$/.test(String(id))) {
                    console.error("Unexpected Myludo played game format");
                    return null;
                }
                ids.push(String(id));
            }

            if (ids.length >= count || items.length === 0) break;
        }

        // une liste plus courte (page vide trop tôt, plafond de pages) ou plus longue que `count` est incomplète
        if (count === undefined || ids.length !== count) {
            console.error("Myludo played games count mismatch");
            return null;
        }

        return ids;
    }

    /** Détail d'une Partie Myludo (commentaire en texte complet). */
    static async getPlayDetails(playId: string): Promise<MyludoPlayDetails | null> {
        const response = await myludoRepository.getJson<PlayDetailsResponse>("views/plays/datas.php", { type: "details", id: playId });

        if (!response || typeof response !== "object" || typeof response.comment !== "string") return null;

        return { id: playId, comment: response.comment };
    }
}
