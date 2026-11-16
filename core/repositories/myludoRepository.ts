import type { LoginInitResponse, PlayDetailsResponse, PlayItem, PlaysResponse } from "~/core/models/myludo/playsResponse";
import type { MyludoAccount, MyludoPlay, MyludoPlayDetails } from "~/core/registrationStatus/types";

const MYLUDO_URL = "https://www.myludo.fr/";
// durée de réutilisation du jeton CSRF (évite de recharger la page d'accueil à chaque appel)
const CSRF_TOKEN_TTL = 10 * 60 * 1000;
// garde-fou contre une pagination incohérente
const MAX_PLAYS_PAGES = 50;

let csrfToken: { value: string; fetchedAt: number } | null = null;

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
        return fetch("https://www.myludo.fr/", { method: "GET" })
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

        return fetch(`https://www.myludo.fr/views/login/datas.php?type=init`, { method: "GET", headers })
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

    /** GET JSON sur un endpoint Myludo ; null en cas d'erreur. Un 403 (jeton expiré) est retenté une fois avec un nouveau jeton. */
    private static async getJson<T>(path: string, params: Record<string, string>): Promise<T | null> {
        const url = `${MYLUDO_URL}${path}?${new URLSearchParams(params).toString()}`;

        for (const forceRefresh of [false, true]) {
            const headers = await myludoRepository.getApiHeaders(forceRefresh);

            if (!headers) return null;

            try {
                const response = await fetch(url, { method: "GET", headers, credentials: "include" });

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

    /** Détail d'une Partie Myludo (commentaire en texte complet). */
    static async getPlayDetails(playId: string): Promise<MyludoPlayDetails | null> {
        const response = await myludoRepository.getJson<PlayDetailsResponse>("views/plays/datas.php", { type: "details", id: playId });

        if (!response || typeof response !== "object" || typeof response.comment !== "string") return null;

        return { id: playId, comment: response.comment };
    }
}
