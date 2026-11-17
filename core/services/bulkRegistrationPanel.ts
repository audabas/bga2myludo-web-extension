import { isReadyToRegister } from "~/core/bulkRegistration/bulkRegistration";
import type { BulkAnalysis, BulkRegistrationModule } from "~/core/bulkRegistration/types";
import boardGameArenaHelper from "~/core/helpers/boardGameArenaHelper";
import bulkRegistrationDisplayHelper from "~/core/helpers/bulkRegistrationDisplayHelper";
import registrationStatusDisplayHelper from "~/core/helpers/registrationStatusDisplayHelper";
import bulkRegistrationService, { type BulkRegistrationPage } from "./bulkRegistrationService";

/** Page d'Historique BGA qui propose l'Enregistrement groupé. */
interface BulkRegistrationPageConfig {
    matches: RegExp;
    /** élément avant lequel le panneau est inséré (null : liste pas encore affichée) */
    anchor(): Element | null;
    /**
     * Identité de la page affichée : un changement vaut changement de page (nouveau panneau, arrêt du parcours).
     * BGA navigue en partie sans recharger la page (ni le script de la page) ; l'ancre n'en fait jamais partie.
     */
    pageKey(): string;
    prepare(): Promise<BulkRegistrationPage>;
    /** libellé du plafond de lecture atteint */
    pageCapTextKey: string;
}

/** Adresses des pages d'Historique BGA, reconnues par le script de la page BGA. */
export interface BulkRegistrationPanelPages {
    gameStatsPage: RegExp;
    lastResultsPage: RegExp;
}

export interface BulkRegistrationPanel {
    /**
     * Injecte (une fois par page) le panneau de l'Enregistrement groupé au-dessus de la liste des Tables.
     * À rappeler à chaque passage du script de la page : hors des pages d'Historique BGA, un panneau resté affiché
     * est retiré (ce qui arrête un parcours en cours).
     */
    inject(): Promise<void>;
}

/**
 * Panneau de l'Enregistrement groupé des pages d'Historique BGA : bouton, analyse, confirmation dans la page,
 * enregistrement, puis récapitulatif. L'analyse et l'enregistrement ont un bouton Arrêter et suivent la page affichée.
 */
export function createBulkRegistrationPanel(pages: BulkRegistrationPanelPages): BulkRegistrationPanel {
    const pageConfigs: BulkRegistrationPageConfig[] = [
        {
            // au-dessus de la liste des Tables ; les filtres de l'URL définissent le périmètre
            matches: pages.gameStatsPage,
            anchor: () => {
                const list = document.getElementById("gamelist_inner");
                return list?.closest("table") ?? list;
            },
            pageKey: () => window.location.href.split("#")[0]!,
            prepare: () => bulkRegistrationService.forGameStats(),
            pageCapTextKey: "bulkRegistrationPageCapText"
        },
        {
            // au-dessus du fil (hors du conteneur observé pour « Voir plus ») ; seuls le joueur et la section
            // désignent la page : un autre paramètre ajouté par BGA (« Voir plus »…) n'arrête pas le parcours
            matches: pages.lastResultsPage,
            anchor: () => document.getElementById("boardposts_r"),
            pageKey: () => {
                const params = new URLSearchParams(window.location.search);
                return `${window.location.origin}${window.location.pathname}?id=${params.get("id") ?? ""}&section=${params.get("section") ?? ""}`;
            },
            prepare: () => bulkRegistrationService.forLastResults(),
            pageCapTextKey: "bulkRegistrationPageCapLastResultsText"
        }
    ];

    // panneau de l'Enregistrement groupé : page pour laquelle il a été préparé (panneau null : pas de bouton)
    let current: { page: BulkRegistrationPageConfig; key: string; panel: HTMLElement | null } | null = null;
    let pending = false;

    async function inject() {
        if (pending) return;

        const page = pageConfigs.find(candidate => candidate.matches.test(window.location.href));
        if (!page) {
            current?.panel?.remove();
            current = null;
            return;
        }

        const key = page.pageKey();
        if (current && current.page === page && current.key === key
            && (current.panel === null || current.panel.isConnected)) return;

        const anchor = page.anchor();
        if (!anchor?.parentElement) return;

        pending = true;
        try {
            current?.panel?.remove();
            const { availability, module } = await page.prepare();
            const panel = bulkRegistrationDisplayHelper.createPanel(availability, () => {
                if (module && panel) analyse(panel, module, page);
            });
            if (panel && !anchor.isConnected) {
                // la liste a été redessinée pendant la préparation : on réessaie au prochain passage
                current = null;
                return;
            }
            if (panel) anchor.parentElement?.insertBefore(panel, anchor);
            current = { page, key, panel };
        } catch (error) {
            console.error("Error preparing Myludo bulk registration:", error);
            current = { page, key, panel: null };
        } finally {
            pending = false;
        }
    }

    /**
     * Surveille la page affichée toutes les 250 ms : la quitter, changer de filtre (ou de joueur) ou retirer le panneau
     * appelle `onLeave`. BGA navigue en partie sans recharger la page. Renvoie la fin de la surveillance.
     */
    function watchPage(panel: HTMLElement, page: BulkRegistrationPageConfig, onLeave: () => void): () => void {
        const key = page.pageKey();
        const watcher = setInterval(() => {
            if (!page.matches.test(window.location.href) || page.pageKey() !== key || !panel.isConnected) onLeave();
        }, 250);
        return () => clearInterval(watcher);
    }

    /**
     * Analyse de l'Enregistrement groupé : rien n'est écrit sur Myludo, le résultat s'affiche dans le panneau.
     * Bouton Arrêter et suivi de la page affichée, comme pour l'enregistrement : un arrêt n'affiche que « Analyse
     * arrêtée ». Si l'analyse le permet, l'enregistrement est proposé, à confirmer dans la page.
     */
    async function analyse(panel: HTMLElement, module: BulkRegistrationModule, page: BulkRegistrationPageConfig) {
        bulkRegistrationDisplayHelper.setBusy(panel, true);
        bulkRegistrationDisplayHelper.startAnalysing(panel, () => module.stop());
        const stopWatching = watchPage(panel, page, () => module.stop());
        try {
            const analysis = await module.analyse(progress => bulkRegistrationDisplayHelper.showAnalysing(panel, progress.tablesRead));
            bulkRegistrationDisplayHelper.showAnalysis(panel, analysis, page.pageCapTextKey);
            if (isReadyToRegister(analysis)) {
                bulkRegistrationDisplayHelper.showConfirmation(panel, analysis.toRegister.length, () => {
                    register(panel, module, analysis, page);
                });
            }
        } catch (error) {
            console.error("Error analysing BGA history for Myludo bulk registration:", error);
            bulkRegistrationDisplayHelper.showError(panel);
        } finally {
            stopWatching();
            bulkRegistrationDisplayHelper.setBusy(panel, false);
        }
    }

    /**
     * Enregistrement des Tables analysées, une à une dans la fenêtre Myludo dédiée : progression dans le panneau,
     * bouton Arrêter, lignes affichées passées à « Enregistrée sur Myludo » au fil de l'eau, puis récapitulatif.
     * Quitter la page vaut demande d'arrêt : un rechargement ou la fermeture de l'onglet coupe la connexion durable
     * (le script de fond ferme alors la fenêtre Myludo), et une navigation sans rechargement est repérée ici.
     * Si BGA retire le panneau de la page, le parcours s'arrête aussi : il ne continue jamais sans affichage.
     */
    async function register(
        panel: HTMLElement,
        module: BulkRegistrationModule,
        analysis: BulkAnalysis,
        page: BulkRegistrationPageConfig
    ) {
        bulkRegistrationDisplayHelper.setBusy(panel, true);
        bulkRegistrationDisplayHelper.showStopButton(panel, () => module.stop());
        const stopWatching = watchPage(panel, page, () => module.stop());
        try {
            const recap = await module.register(analysis, progress => {
                bulkRegistrationDisplayHelper.showProgress(panel, progress);
                if (progress.outcome === "registered") {
                    registrationStatusDisplayHelper.apply(new Map([[progress.table.tableId, { kind: "registered" }]]));
                }
            });
            const failedLinks = await Promise.all(recap.failed.map(async table => ({
                tableId: table.tableId,
                url: await boardGameArenaHelper.myludoFormUrl(table).catch(() => null)
            })));
            bulkRegistrationDisplayHelper.showRecap(panel, recap, failedLinks);
        } catch (error) {
            console.error("Error during Myludo bulk registration:", error);
            bulkRegistrationDisplayHelper.showRegistrationError(panel);
        } finally {
            stopWatching();
            bulkRegistrationDisplayHelper.setBusy(panel, false);
        }
    }

    return { inject };
}
