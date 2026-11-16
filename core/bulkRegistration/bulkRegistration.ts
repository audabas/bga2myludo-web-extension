import type { MyludoAccountIssue, RegistrationStatus, RegistrationTable } from "~/core/registrationStatus/types";
import type {
    BulkAnalysis,
    BulkFormDriver,
    BulkRecap,
    BulkRegistrationAvailability,
    BulkRegistrationDependencies,
    BulkRegistrationModule,
    BulkRegistrationOptions,
    BulkRegistrationRequiredOption,
    StopReason
} from "./types";

/**
 * Plafond de pages lues dans le fil de l'Historique BGA pour l'Enregistrement groupé (garde-fou contre une pagination
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

/** Nombre d'échecs à la suite qui arrête le parcours : Myludo ne répond plus, ou son formulaire a changé. */
export const MAX_CONSECUTIVE_FAILURES = 3;

/** Problème de compte Myludo signalé par un statut indéterminé (aucune Table ne peut alors être vérifiée), ou undefined. */
function myludoAccountIssueOf(status: RegistrationStatus | undefined): MyludoAccountIssue | undefined {
    if (status?.kind !== "undetermined" || status.reason === "error") return undefined;
    return status.reason;
}

/** Range une Table dans l'analyse selon son Statut d'enregistrement. */
function classify(analysis: BulkAnalysis, table: RegistrationTable, status: RegistrationStatus | undefined) {
    if (status?.kind === "gameUnavailable") {
        analysis.discarded.gameUnavailable.push(table.tableId);
    } else if (status?.kind === "registered") {
        analysis.alreadyRegistered.push(table.tableId);
    } else if (status?.kind !== "notRegistered") {
        // sans statut, la Table est traitée comme indéterminée : on ne risque pas de doublon
        analysis.discarded.undetermined.push(table.tableId);
        analysis.myludoAccountIssue ??= myludoAccountIssueOf(status);
    } else if (table.isAbandoned) {
        analysis.discarded.abandoned.push(table.tableId);
    } else {
        analysis.toRegister.push(table);
    }
}

/**
 * Bouton de l'Enregistrement groupé sur une page d'Historique BGA.
 * - statut Myludo désactivé, aucun joueur BGA connecté, Historique BGA d'un autre joueur, ou navigateur sans fenêtres
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
 * L'analyse permet-elle de proposer l'enregistrement ? Il faut des Tables à enregistrer, un fil lu sans erreur BGA
 * (sinon l'analyse est incomplète : on invite à la relancer) et un compte Myludo utilisable (sinon on invite à s'y
 * connecter). Un fil coupé au plafond de pages n'empêche pas l'enregistrement : la page le signale.
 */
export function isReadyToRegister(analysis: BulkAnalysis): boolean {
    return analysis.toRegister.length > 0 && analysis.feedEnd !== "error" && !analysis.myludoAccountIssue;
}

/**
 * Module Enregistrement groupé : enregistre sur Myludo toutes les Tables non enregistrées d'un Historique BGA.
 * Il ne connaît pas le DOM ; fil de l'Historique BGA, Statut d'enregistrement, horloge et pilote de formulaire sont injectés.
 * Il ne mémorise rien entre deux lancements : relancer refait l'analyse, qui exclut les Tables enregistrées.
 */
export function createBulkRegistration(deps: BulkRegistrationDependencies): BulkRegistrationModule {
    let currentRun: Run | undefined;

    return {
        async analyse(onProgress) {
            const analysis: BulkAnalysis = {
                toRegister: [],
                discarded: { undetermined: [], abandoned: [], gameUnavailable: [] },
                alreadyRegistered: [],
                tablesRead: 0,
                feedEnd: "complete"
            };

            // une Table déjà lue n'est comptée qu'une fois (curseur qui n'avance plus, liste décalée par une nouvelle partie)
            const seen = new Set<string>();
            const feed = deps.openFeed();
            for (let pagesRead = 0; pagesRead < BULK_MAX_PAGES; pagesRead++) {
                const page = await feed();
                if (!page) {
                    analysis.feedEnd = "error";
                    return analysis;
                }

                const tables = page.tables.filter(table => !seen.has(table.tableId) && seen.add(table.tableId));
                const statuses = tables.length > 0 ? await deps.statuses.getStatuses(tables) : new Map();
                tables.forEach(table => classify(analysis, table, statuses.get(table.tableId)));
                analysis.tablesRead += tables.length;
                onProgress?.({ tablesRead: analysis.tablesRead });

                // compte Myludo inutilisable : aucune autre Table ne pourrait être vérifiée, inutile de lire la suite
                if (page.isLast || analysis.myludoAccountIssue) return analysis;
            }

            analysis.feedEnd = "pageCap";
            return analysis;
        },

        async register(analysis, onProgress) {
            const recap: BulkRecap = {
                registered: [],
                failed: [],
                discarded: analysis.discarded,
                alreadyRegistered: analysis.alreadyRegistered,
                remaining: []
            };

            const total = analysis.toRegister.length;
            if (total === 0) return recap;

            const run = createRun();
            currentRun = run;
            let processed = 0;
            let consecutiveFailures = 0;

            const forms = deps.openFormDriver();
            forms.onWindowClosed(() => run.requestStop("windowClosed"));
            try {
                for (const [index, table] of analysis.toRegister.entries()) {
                    if (index > 0) await run.wait(PAUSE_BETWEEN_TABLES_MS);
                    if (run.stopReason) break;

                    const progress = { table, rank: index + 1, total };
                    onProgress?.(progress);
                    const registered = await registerOne(table, forms, run);
                    processed++;
                    if (registered) {
                        consecutiveFailures = 0;
                        recap.registered.push(table.tableId);
                        onProgress?.({ ...progress, outcome: "registered" });
                    } else {
                        consecutiveFailures++;
                        recap.failed.push(table);
                        onProgress?.({ ...progress, outcome: "failed" });
                    }

                    // après la dernière Table, le parcours est de toute façon terminé
                    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && index < total - 1) {
                        run.requestStop("consecutiveFailures");
                    }
                }
            } finally {
                if (currentRun === run) currentRun = undefined;
                await forms.close();
            }

            recap.remaining = analysis.toRegister.slice(processed).map(table => table.tableId);
            recap.stopReason = run.stopReason;
            return recap;
        },

        stop() {
            currentRun?.requestStop("requested");
        }
    };

    function createRun(): Run {
        let onStop = () => {};
        const stopped = new Promise<void>(resolve => { onStop = resolve; });
        const run: Run = {
            requestStop(reason) {
                if (run.stopReason) return;
                run.stopReason = reason;
                onStop();
            },
            wait: ms => run.stopReason ? Promise.resolve() : Promise.race([deps.clock.sleep(ms), stopped])
        };
        return run;
    }

    /**
     * Invalide le statut de la Table et ouvre son formulaire, puis attend que son statut sans cache dise « enregistrée »
     * (au plus 30 s). Le calcul sans cache qui la trouve enregistrée met ce statut en cache, sans autre appel Myludo ;
     * une Table en échec reste hors du cache (son statut a été invalidé) : l'affichage la revérifiera.
     * Une demande d'arrêt écourte l'attente : le statut est alors vérifié une dernière fois, tout de suite.
     * Compte Myludo non connecté (ou permission manquante) : la Table compte en échec et le parcours s'arrête aussitôt.
     */
    async function registerOne(table: RegistrationTable, forms: BulkFormDriver, run: Run): Promise<boolean> {
        await deps.statuses.invalidate(table.tableId);
        try {
            await forms.open(table);
        } catch (error) {
            console.error(`Error opening the Myludo form of table ${table.tableId}:`, error);
            return false;
        }

        const deadline = deps.clock.now().getTime() + FORM_TIMEOUT_MS;
        while (deps.clock.now().getTime() < deadline) {
            await run.wait(Math.min(STATUS_POLL_INTERVAL_MS, deadline - deps.clock.now().getTime()));
            const status = (await deps.statuses.getStatuses([table], { useCache: false, cacheRegistered: true })).get(table.tableId);
            if (status?.kind === "registered") return true;
            // le compte Myludo ne peut plus être interrogé : continuer accumulerait des échecs
            const accountIssue = myludoAccountIssueOf(status);
            if (accountIssue) run.requestStop(accountIssue);
            if (run.stopReason) return false;
        }
        return false;
    }
}

/** Parcours d'enregistrement en cours, que l'on peut arrêter. */
interface Run {
    /** raison de l'arrêt demandé : la première demande l'emporte */
    stopReason?: StopReason;
    requestStop(reason: StopReason): void;
    /** pause, écourtée par une demande d'arrêt */
    wait(ms: number): Promise<void>;
}
