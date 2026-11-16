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

/** `views/plays/datas.php?type=details` */
export interface PlayDetailsResponse {
    id?: number | string;
    /** texte complet */
    comment?: string | null;
}

/** `views/login/datas.php?type=init` */
export interface LoginInitResponse {
    user?: { id?: number | string } | null;
}
