import type { WxtStorage } from "wxt/utils/storage";

// ---------------------------------------------------------------------------
// Entrée : Tables normalisées
// ---------------------------------------------------------------------------

/** Un joueur d'une Table, tel qu'il apparaît sur BGA (avant toute transformation). */
export interface RegistrationPlayer {
    /** pseudo BGA */
    name: string;
    score?: number;
    rank?: number;
    /** vrai pour le joueur BGA connecté (comparaison par id côté BGA) */
    isCurrentPlayer: boolean;
}

/** Une Table normalisée, quelle que soit la page BGA d'où elle provient. */
export interface RegistrationTable {
    /** numéro de table BGA */
    tableId: string;
    /** identifiant BGA du jeu (ex. "yatzy") */
    bgaGameId: string;
    /** heure de fin (instant absolu) */
    end: Date;
    players: RegistrationPlayer[];
    isCooperative: boolean;
    isSolo: boolean;
    isAbandoned: boolean;
}

// ---------------------------------------------------------------------------
// Sortie : Statut d'enregistrement
// ---------------------------------------------------------------------------

export type UndeterminedReason = "notConnected" | "permissionMissing" | "error";

/** Raison d'indétermination commune à tout le compte Myludo : aucune Table ne peut être vérifiée. */
export type MyludoAccountIssue = Exclude<UndeterminedReason, "error">;

export type RegistrationStatus =
    | { kind: "registered" }
    | { kind: "notRegistered" }
    | { kind: "undetermined"; reason: UndeterminedReason }
    | { kind: "gameUnavailable" };

/** Statuts par numéro de table. Une Table absente de la map n'a pas de statut à afficher. */
export type RegistrationStatuses = Map<string, RegistrationStatus>;

export interface GetStatusesOptions {
    /** false : mode « sans cache » (formulaire Myludo), Myludo est toujours interrogé. Vrai par défaut. */
    useCache?: boolean;
    /**
     * Mode « sans cache » seulement : une Table trouvée enregistrée est tout de même mise en cache (Enregistrement
     * groupé, une fois le formulaire validé). Les autres statuts ne le sont pas : une invalidation en cours reste.
     */
    cacheRegistered?: boolean;
    /**
     * Demande d'arrêt (Analyse de l'Enregistrement groupé) : vérifiée avant chaque appel Myludo, et un appel en cours
     * n'est plus attendu. Les statuts déjà calculés sont renvoyés et mis en cache ; les Tables non traitées n'ont pas de statut.
     */
    signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Dépendances injectées
// ---------------------------------------------------------------------------

/** Compte Myludo connecté, ou raison pour laquelle on ne peut pas l'interroger. */
export type MyludoAccount =
    | { status: "connected"; id: string }
    | { status: "notConnected" }
    | { status: "permissionMissing" }
    | { status: "error" };

export interface MyludoPlayPlayer {
    name: string;
    /** score tel que renvoyé par Myludo (chaîne, éventuellement vide) */
    score?: string | null;
}

/** Une Partie Myludo, telle que listée sur une fiche de jeu. */
export interface MyludoPlay {
    id: string;
    /** jour de la partie, AAAA-MM-JJ */
    date: string;
    online: boolean;
    incomplete: boolean;
    coop: boolean;
    solo: boolean;
    /** la liste ne donne qu'un booléen ; le texte complet est dans le détail */
    hasComment: boolean;
    players: MyludoPlayPlayer[];
}

export interface MyludoPlayDetails {
    id: string;
    /** commentaire en texte complet (vide si aucun) */
    comment: string;
}

/**
 * Accès Myludo. Chaque opération renvoie `null` en cas d'erreur (réseau, réponse inattendue…).
 * Une opération qui rejette est traitée comme une erreur.
 */
export interface MyludoAccess {
    getAccount(): Promise<MyludoAccount>;
    /** Parties Myludo de la fiche `myludoGameId` (id numérique) entre deux jours inclus (AAAA-MM-JJ), toutes pages confondues. */
    getPlays(myludoGameId: string, dateFrom: string, dateTo: string): Promise<MyludoPlay[] | null>;
    getPlayDetails(playId: string): Promise<MyludoPlayDetails | null>;
}

export interface Clock {
    now(): Date;
}

/** Stockage du cache (WXT `storage`). */
export type RegistrationStatusStorage = WxtStorage;

/** Configuration utile au module, lue une fois par calcul. */
export interface RegistrationStatusConfiguration {
    /** option « Afficher le statut Myludo dans l'historique BGA » ; ignorée en mode « sans cache » (formulaire Myludo) */
    enabled: boolean;
    /** nom personnalisé du joueur courant (« Moi »), ou undefined si l'option est désactivée */
    customCurrentPlayerName?: string;
    /** correspondances de joueurs BGA → Myludo */
    userMappings: { bgaUser: string; myludoUser: string }[];
    /** Correspondance de jeu courante : id BGA du jeu → id Myludo (ex. "5142" ou "above-37300") */
    gameMappings: Record<string, string>;
}

export interface RegistrationStatusDependencies {
    myludo: MyludoAccess;
    storage: RegistrationStatusStorage;
    clock: Clock;
    configuration: () => Promise<RegistrationStatusConfiguration>;
}

export interface RegistrationStatusModule {
    /** Statut d'enregistrement de chaque Table (les Tables doivent être celles auxquelles l'utilisateur a participé). */
    getStatuses(tables: RegistrationTable[], options?: GetStatusesOptions): Promise<RegistrationStatuses>;
    /** Invalide le statut d'une Table (recalculé à la prochaine demande). */
    invalidate(tableId: string): Promise<void>;
    /** Vide complètement le cache. */
    clearCache(): Promise<void>;
}
