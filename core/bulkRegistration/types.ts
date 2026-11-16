import type { RegistrationStatusModule, RegistrationTable } from "~/core/registrationStatus/types";

// ---------------------------------------------------------------------------
// Dépendances injectées
// ---------------------------------------------------------------------------

/** Page lue dans le fil d'historique : ses Tables normalisées (celles du joueur connecté), et si c'est la dernière. */
export interface BulkHistoryPage {
    tables: RegistrationTable[];
    isLast: boolean;
}

/**
 * Fil d'historique d'un périmètre (page BGA, filtres, joueur connecté), du plus récent au plus ancien.
 * Il garde sa propre position ; null en cas d'erreur.
 */
export type BulkHistoryFeed = () => Promise<BulkHistoryPage | null>;

/** Accès au module Statut d'enregistrement. */
export type BulkRegistrationStatusAccess = Pick<RegistrationStatusModule, "getStatuses" | "invalidate">;

/** Horloge : heure courante et pause (pause entre deux Tables, délai maximal d'un formulaire). */
export interface BulkClock {
    now(): Date;
    sleep(ms: number): Promise<void>;
}

/**
 * Pilote de formulaire : une fenêtre Myludo dédiée, avec un seul onglet réutilisé, pour tout un parcours.
 * La fenêtre est créée au premier formulaire et fermée par `close`.
 */
export interface BulkFormDriver {
    /**
     * Ouvre, avec un rechargement complet de la page, le formulaire Myludo de la Table (URL du lien unitaire) :
     * la validation automatique du script Myludo fait le reste. Rejeté si le formulaire n'a pas pu être ouvert.
     */
    open(table: RegistrationTable): Promise<void>;
    /** Ferme la fenêtre dédiée (fin du parcours). */
    close(): Promise<void>;
}

export interface BulkRegistrationDependencies {
    /** Ouvre le fil d'historique, lu depuis le début (un nouveau fil à chaque lancement). */
    openFeed(): BulkHistoryFeed;
    statuses: BulkRegistrationStatusAccess;
    clock: BulkClock;
    /** Ouvre un pilote de formulaire (une fenêtre dédiée) pour un parcours d'enregistrement. */
    openFormDriver(): BulkFormDriver;
}

// ---------------------------------------------------------------------------
// Disponibilité du bouton
// ---------------------------------------------------------------------------

/** Options de l'extension dont dépend l'Enregistrement groupé (valeurs par défaut déjà appliquées). */
export interface BulkRegistrationOptions {
    showRegistrationStatus?: boolean;
    autoSubmit?: boolean;
    addTableLink?: boolean;
}

/** Options à activer pour que le bouton soit actif. */
export type BulkRegistrationRequiredOption = "autoSubmit" | "addTableLink";

/** Bouton absent, désactivé (avec les options manquantes), ou actif. */
export type BulkRegistrationAvailability =
    | { kind: "hidden" }
    | { kind: "disabled"; missingOptions: BulkRegistrationRequiredOption[] }
    | { kind: "enabled" };

// ---------------------------------------------------------------------------
// Analyse
// ---------------------------------------------------------------------------

/** Raisons pour lesquelles une Table est écartée de l'Enregistrement groupé. */
export type DiscardReason = "undetermined" | "abandoned" | "gameUnavailable";

/** Fin de la lecture du fil : jusqu'au bout, arrêtée au plafond de pages, ou interrompue par une erreur BGA. */
export type FeedEnd = "complete" | "pageCap" | "error";

/** Avancement de l'analyse. */
export interface AnalysisProgress {
    tablesRead: number;
}

/** Résultat de l'analyse : rien n'a été écrit sur Myludo. */
export interface BulkAnalysis {
    /** Tables à enregistrer (non enregistrées, non abandonnées), dans l'ordre du fil : plus récentes d'abord */
    toRegister: RegistrationTable[];
    /** numéros des Tables écartées, par raison */
    discarded: Record<DiscardReason, string[]>;
    /** numéros des Tables déjà enregistrées */
    alreadyRegistered: string[];
    tablesRead: number;
    feedEnd: FeedEnd;
    /**
     * Raison commune à tout le compte Myludo (non connecté, permission manquante) quand des Tables sont indéterminées
     * pour cette raison : la page peut inviter à se connecter plutôt que d'annoncer des Tables écartées.
     */
    myludoAccountIssue?: "notConnected" | "permissionMissing";
}

// ---------------------------------------------------------------------------
// Enregistrement
// ---------------------------------------------------------------------------

/**
 * Avancement de l'enregistrement : émis au début de chaque Table (sans `outcome`), puis à son issue.
 * `rank` va de 1 à `total`.
 */
export interface RegistrationProgress {
    table: RegistrationTable;
    rank: number;
    total: number;
    outcome?: "registered" | "failed";
}

/** Récapitulatif final d'un parcours d'enregistrement. */
export interface BulkRecap {
    /** numéros des Tables enregistrées pendant le parcours */
    registered: string[];
    /** Tables dont le formulaire n'a pas abouti (pour proposer leur lien unitaire) */
    failed: RegistrationTable[];
    /** numéros des Tables écartées par l'analyse, par raison */
    discarded: Record<DiscardReason, string[]>;
    /** numéros des Tables déjà enregistrées avant le parcours */
    alreadyRegistered: string[];
}

export interface BulkRegistrationModule {
    /** Lit tout le fil d'historique (sous le plafond de pages), calcule les Statuts d'enregistrement et classe les Tables. */
    analyse(onProgress?: (progress: AnalysisProgress) => void): Promise<BulkAnalysis>;
    /**
     * Enregistre les Tables à enregistrer de l'analyse, des plus récentes aux plus anciennes, une à la fois,
     * dans une fenêtre Myludo dédiée fermée à la fin.
     */
    register(analysis: BulkAnalysis, onProgress?: (progress: RegistrationProgress) => void): Promise<BulkRecap>;
}
