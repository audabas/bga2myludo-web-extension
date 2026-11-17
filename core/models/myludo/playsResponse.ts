// Réponses (non documentées) des endpoints Myludo utilisés pour le Statut d'enregistrement.
// Tous les champs sont optionnels : une réponse inattendue doit produire une erreur, jamais un faux statut.

/** `views/game/datas.php?type=plays` */
export interface PlaysResponse {
    count?: number;
    pages?: number;
    list?: PlayItem[];
}

export interface PlayItem {
    id?: number | string;
    date?: { date?: string };
    online?: boolean;
    incomplete?: boolean;
    coop?: boolean;
    solo?: boolean;
    /** booléen seulement dans la liste */
    comment?: boolean;
    players?: PlayItemPlayer[];
}

export interface PlayItemPlayer {
    name?: string;
    score?: string | number | null;
    win?: boolean;
}

/**
 * `views/plays/datas.php?type=games` : jeux joués (fiches de jeu avec au moins une Partie Myludo), paginés, sans `pages`.
 * Au-delà de la dernière page, `list` est vide (un objet, pas un tableau).
 */
export interface PlayedGamesResponse {
    count?: number | string;
    list?: PlayedGameItem[] | Record<string, never>;
}

export interface PlayedGameItem {
    /** id numérique de la fiche de jeu */
    id?: number | string;
    /** nombre de Parties Myludo sur la période */
    games?: number | string;
}

/** `views/plays/datas.php?type=details` */
export interface PlayDetailsResponse {
    id?: number | string;
    /** texte complet */
    comment?: string | null;
}

/** `views/login/datas.php?type=init` */
export interface LoginInitResponse {
    user?: { id?: number | string } | null | false;
}
