import type { User } from "~/core/models/user";
import type { RegistrationStatuses, RegistrationTable } from "~/core/registrationStatus/types";
import boardGameArenaService from "./boardGameArenaService";
import registrationStatusService from "./registrationStatusService";

// nombre maximal de pages BGA lues pour retrouver les lignes affichées
const MAX_PAGES = 30;

/** Page lue dans un fil BGA : ses entrées, et si c'est la dernière. */
export interface HistoryPage<TEntry> {
    entries: TEntry[];
    isLast: boolean;
}

/** Lit la page suivante d'un fil BGA (il garde sa propre position) ; null en cas d'erreur. */
export type HistoryFeed<TEntry> = () => Promise<HistoryPage<TEntry> | null>;

export interface HistorySourceOptions<TEntry> {
    /** Ouvre le fil d'une vue de la page (filtres, joueur affiché…), lu depuis le début. */
    openFeed(scope: string): HistoryFeed<TEntry>;
    /** Numéro de Table d'une entrée, ou null. */
    tableIdOf(entry: TEntry): string | null;
    /** Table normalisée d'une entrée, ou null si elle n'est pas à vérifier. */
    toRegistrationTable(entry: TEntry, connectedUserId: string): RegistrationTable | null;
}

/** Vue courante de la page, déterminée une fois le joueur BGA connecté connu. */
export type HistoryScope = (connectedUser: User) => string;

/**
 * Source de l'Historique BGA d'une page (« Statistiques de jeu », « Derniers résultats ») : lit le fil BGA
 * jusqu'à connaître les Tables affichées, puis calcule leur Statut d'enregistrement, une seule fois par Table.
 * Option désactivée : aucun appel, ni BGA ni Myludo.
 */
export function createHistorySource<TEntry>(options: HistorySourceOptions<TEntry>) {
    const knownTables = new Map<string, TEntry>();
    const requestedTableIds = new Set<string>();
    let currentScope: string | null = null;
    let feed: HistoryFeed<TEntry> | null = null;
    let pagesRead = 0;
    let noMorePages = false;
    let connectedUser: Promise<User | null> | null = null;
    let queue: Promise<void> = Promise.resolve();

    /** Repart du début du fil si la vue de la page a changé. */
    function resetIfScopeChanged(scope: string) {
        if (feed && currentScope === scope) return;

        currentScope = scope;
        feed = options.openFeed(scope);
        knownTables.clear();
        pagesRead = 0;
        noMorePages = false;
    }

    /** Lit les pages suivantes jusqu'à connaître toutes les Tables demandées. */
    async function loadTables(scope: string, tableIds: string[]) {
        resetIfScopeChanged(scope);

        while (!noMorePages && pagesRead < MAX_PAGES && tableIds.some(id => !knownTables.has(id))) {
            const page = await feed!();

            if (!page) return;

            pagesRead++;
            page.entries.forEach(entry => {
                const tableId = options.tableIdOf(entry);
                if (tableId) knownTables.set(tableId, entry);
            });
            noMorePages = page.isLast;
        }
    }

    /** Statuts des Tables données, calculés avec le cache (option déjà vérifiée). */
    async function statusesOf(scopeOf: HistoryScope, tableIds: string[]): Promise<RegistrationStatuses> {
        connectedUser ??= boardGameArenaService.isConnected().then(user => user || null);
        const user = await connectedUser;
        if (!user) return new Map();

        await loadTables(scopeOf(user), tableIds);

        const tables = tableIds
            .map(id => knownTables.get(id))
            .map(entry => entry ? options.toRegistrationTable(entry, user.id) : null)
            .filter((table): table is RegistrationTable => table !== null);

        if (tables.length === 0) return new Map();

        return registrationStatusService.getStatuses(tables);
    }

    async function computeStatuses(scopeOf: HistoryScope, tableIds: string[], onStatuses: (statuses: RegistrationStatuses) => void) {
        // option désactivée : la page reste telle qu'aujourd'hui, sans aucun appel BGA ni Myludo
        if (!(await registrationStatusService.isHistoryEnabled())) return;

        const newTableIds = tableIds.filter(id => !requestedTableIds.has(id));
        if (newTableIds.length === 0) return;
        newTableIds.forEach(id => requestedTableIds.add(id));

        onStatuses(await statusesOf(scopeOf, newTableIds));
    }

    async function recomputeStatuses(scopeOf: HistoryScope, tableIds: string[]): Promise<RegistrationStatuses> {
        // option désactivée (y compris le recalcul au retour sur l'onglet) : aucun appel BGA ni Myludo
        if (!(await registrationStatusService.isHistoryEnabled())) return new Map();

        return statusesOf(scopeOf, tableIds);
    }

    return {
        /** Calcule le Statut d'enregistrement des Tables affichées (une seule fois par Table), puis appelle `onStatuses`. */
        showStatuses(scopeOf: HistoryScope, tableIds: string[], onStatuses: (statuses: RegistrationStatuses) => void) {
            queue = queue
                .then(() => computeStatuses(scopeOf, tableIds, onStatuses))
                .catch(error => console.error("Error computing Myludo registration statuses:", error));
            return queue;
        },

        /** Recalcule le Statut d'enregistrement de Tables déjà affichées (Tables invalidées), à la suite des autres calculs. */
        refreshStatuses(scopeOf: HistoryScope, tableIds: string[]): Promise<RegistrationStatuses> {
            const result = queue.then(() => recomputeStatuses(scopeOf, tableIds));
            queue = result.then(() => undefined, () => undefined);
            return result;
        }
    };
}
