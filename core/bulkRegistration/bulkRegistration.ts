import type { RegistrationStatus, RegistrationTable } from "~/core/registrationStatus/types";
import type {
    BulkAnalysis,
    BulkFormDriver,
    BulkRecap,
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

/**
 * Intervalle entre deux recalculs sans cache du Statut d'enregistrement d'une Table dont le formulaire est ouvert :
 * chaque recalcul est un appel Myludo, et un formulaire met quelques secondes à se charger et à être validé.
 */
const STATUS_POLL_INTERVAL_MS = 3_000;

/** Délai maximal entre l'ouverture d'un formulaire et le constat de la Table enregistrée : au-delà, c'est un échec. */
const FORM_TIMEOUT_MS = 30_000;

/** Pause entre deux Tables, pour ne pas surcharger Myludo. */
const PAUSE_BETWEEN_TABLES_MS = 2_000;

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
 * - statut Myludo désactivé, aucun joueur BGA connecté, historique d'un autre joueur, ou navigateur sans fenêtres
 *   (Firefox Android : pas de fenêtre Myludo dédiée) : aucun bouton ;
 * - validation automatique ou lien de la table désactivés : bouton désactivé, avec les options manquantes ;
 * - sinon : bouton actif.
 * `displayedPlayerId` est le joueur de l'URL (`player`, `id`), absent ou vide pour le joueur connecté.
 */
export function bulkRegistrationAvailability(
    options: BulkRegistrationOptions,
    displayedPlayerId: string | null,
    connectedUserId: string | null,
    canOpenWindows = true
): BulkRegistrationAvailability {
    if (options.showRegistrationStatus !== true) return { kind: "hidden" };
    if (!canOpenWindows) return { kind: "hidden" };
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
 * Il ne connaît pas le DOM ; fil d'historique, Statut d'enregistrement, horloge et pilote de formulaire sont injectés.
 * Il ne mémorise rien entre deux lancements : relancer refait l'analyse, qui exclut les Tables enregistrées.
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
        },

        async register(analysis, onProgress) {
            const recap: BulkRecap = {
                registered: [],
                failed: [],
                discarded: analysis.discarded,
                alreadyRegistered: analysis.alreadyRegistered
            };

            const total = analysis.toRegister.length;
            if (total === 0) return recap;

            const forms = deps.openFormDriver();
            try {
                for (const [index, table] of analysis.toRegister.entries()) {
                    if (index > 0) await deps.clock.sleep(PAUSE_BETWEEN_TABLES_MS);

                    const progress = { table, rank: index + 1, total };
                    onProgress?.(progress);
                    if (await registerOne(table, forms)) {
                        recap.registered.push(table.tableId);
                        onProgress?.({ ...progress, outcome: "registered" });
                    } else {
                        recap.failed.push(table);
                        onProgress?.({ ...progress, outcome: "failed" });
                    }
                }
            } finally {
                await forms.close();
            }

            return recap;
        }
    };

    /**
     * Invalide le statut de la Table et ouvre son formulaire, puis attend que son statut sans cache dise « enregistrée »
     * (au plus 30 s). Le statut sans cache n'est pas mis en cache : une fois la Table enregistrée, un dernier calcul
     * avec cache l'y écrit, comme pour l'affichage. Une Table en échec reste hors du cache.
     */
    async function registerOne(table: RegistrationTable, forms: BulkFormDriver): Promise<boolean> {
        await deps.statuses.invalidate(table.tableId);
        try {
            await forms.open(table);
        } catch (error) {
            console.error(`Error opening the Myludo form of table ${table.tableId}:`, error);
            return false;
        }

        const deadline = deps.clock.now().getTime() + FORM_TIMEOUT_MS;
        while (deps.clock.now().getTime() < deadline) {
            await deps.clock.sleep(Math.min(STATUS_POLL_INTERVAL_MS, deadline - deps.clock.now().getTime()));
            const status = (await deps.statuses.getStatuses([table], { useCache: false })).get(table.tableId);
            if (status?.kind === "registered") {
                await deps.statuses.getStatuses([table]);
                return true;
            }
        }
        return false;
    }
}
