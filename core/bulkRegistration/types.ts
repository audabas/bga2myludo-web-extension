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

export interface BulkRegistrationDependencies {
    /** Ouvre le fil d'historique, lu depuis le début (un nouveau fil à chaque lancement). */
    openFeed(): BulkHistoryFeed;
    statuses: BulkRegistrationStatusAccess;
    clock: BulkClock;
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

export interface BulkRegistrationModule {
    /** Lit tout le fil d'historique (sous le plafond de pages), calcule les Statuts d'enregistrement et classe les Tables. */
    analyse(onProgress?: (progress: AnalysisProgress) => void): Promise<BulkAnalysis>;
}
