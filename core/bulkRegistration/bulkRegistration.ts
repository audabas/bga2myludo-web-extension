import type { RegistrationStatus, RegistrationTable } from "~/core/registrationStatus/types";
import type {
    BulkAnalysis,
    BulkRegistrationAvailability,
    BulkRegistrationDependencies,
    BulkRegistrationModule,
    BulkRegistrationOptions,
    BulkRegistrationRequiredOption
} from "./types";

/**
 * Plafond de pages lues dans le fil d'historique pour l'Enregistrement groupé (garde-fou contre une pagination
 * incohérente qui ne finirait jamais), bien au-delà des 30 pages de l'affichage.
 * Mesure : `getGames` (« Statistiques de jeu ») renvoie 10 Tables par page, comme `message/board`
 * (« Derniers résultats », `per_page=10`). 1000 pages couvrent donc 10 000 Tables, soit plus de 5 Tables par jour
 * pendant 5 ans : au-delà, l'utilisateur peut restreindre le périmètre avec les filtres de la page (jeu, période).
 * À environ une demi-seconde par page BGA, le plafond borne aussi la lecture du fil à une dizaine de minutes.
 */
const BULK_MAX_PAGES = 1000;

/** Range une Table dans l'analyse selon son Statut d'enregistrement. */
function classify(analysis: BulkAnalysis, table: RegistrationTable, status: RegistrationStatus | undefined) {
    if (status?.kind === "gameUnavailable") {
        analysis.discarded.gameUnavailable.push(table.tableId);
    } else if (status?.kind === "registered") {
        analysis.alreadyRegistered.push(table.tableId);
    } else if (status?.kind !== "notRegistered") {
        // sans statut, la Table est traitée comme indéterminée : on ne risque pas de doublon
        analysis.discarded.undetermined.push(table.tableId);
        if (status?.reason === "notConnected" || status?.reason === "permissionMissing") {
            analysis.myludoAccountIssue = status.reason;
        }
    } else if (table.isAbandoned) {
        analysis.discarded.abandoned.push(table.tableId);
    } else {
        analysis.toRegister.push(table);
    }
}

/**
 * Bouton de l'Enregistrement groupé sur une page d'Historique BGA.
 * - statut Myludo désactivé, aucun joueur BGA connecté, ou historique d'un autre joueur : aucun bouton ;
 * - validation automatique ou lien de la table désactivés : bouton désactivé, avec les options manquantes ;
 * - sinon : bouton actif.
 * `displayedPlayerId` est le joueur de l'URL (`player`, `id`), absent ou vide pour le joueur connecté.
 */
export function bulkRegistrationAvailability(
    options: BulkRegistrationOptions,
    displayedPlayerId: string | null,
    connectedUserId: string | null
): BulkRegistrationAvailability {
    if (options.showRegistrationStatus !== true) return { kind: "hidden" };
    if (!connectedUserId) return { kind: "hidden" };
    // `who` peut renvoyer un id numérique
    if (displayedPlayerId && String(displayedPlayerId) !== String(connectedUserId)) return { kind: "hidden" };

    const missingOptions: BulkRegistrationRequiredOption[] = [];
    if (options.autoSubmit !== true) missingOptions.push("autoSubmit");
    if (options.addTableLink !== true) missingOptions.push("addTableLink");

    return missingOptions.length > 0 ? { kind: "disabled", missingOptions } : { kind: "enabled" };
}

/**
 * Module Enregistrement groupé : enregistre sur Myludo toutes les Tables non enregistrées d'un Historique BGA.
 * Il ne connaît pas le DOM ; fil d'historique, Statut d'enregistrement et horloge sont injectés.
 */
export function createBulkRegistration(deps: BulkRegistrationDependencies): BulkRegistrationModule {
    return {
        async analyse(onProgress) {
            const analysis: BulkAnalysis = {
                toRegister: [],
                discarded: { undetermined: [], abandoned: [], gameUnavailable: [] },
                alreadyRegistered: [],
                tablesRead: 0,
                feedEnd: "complete"
            };

            const feed = deps.openFeed();
            for (let pagesRead = 0; pagesRead < BULK_MAX_PAGES; pagesRead++) {
                const page = await feed();
                if (!page) {
                    analysis.feedEnd = "error";
                    return analysis;
                }

                const statuses = await deps.statuses.getStatuses(page.tables);
                page.tables.forEach(table => classify(analysis, table, statuses.get(table.tableId)));
                analysis.tablesRead += page.tables.length;
                onProgress?.({ tablesRead: analysis.tablesRead });

                if (page.isLast) return analysis;
            }

            analysis.feedEnd = "pageCap";
            return analysis;
        }
    };
}
