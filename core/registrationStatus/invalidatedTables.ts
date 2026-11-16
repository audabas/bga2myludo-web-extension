import type { RegistrationStatus, RegistrationStatuses, RegistrationStatusModule } from "./types";

/** Statuts qui ne changeront plus d'eux-mêmes : inutile de revérifier la Table aux retours suivants. */
function isSettled(status: RegistrationStatus | undefined): boolean {
    return status?.kind === "registered" || status?.kind === "gameUnavailable";
}

/**
 * Tables dont le lien a été cliqué sur la page courante.
 * Une Table reste à revérifier à chaque retour sur l'onglet tant qu'elle n'est pas « enregistrée » :
 * l'utilisateur peut revenir avant d'avoir validé la partie sur Myludo.
 */
export function createInvalidatedTables(module: Pick<RegistrationStatusModule, "invalidate">) {
    const tableIds = new Set<string>();
    let queue: Promise<unknown> = Promise.resolve();

    async function refreshNow(displayedTableIds: string[], recompute: (tableIds: string[]) => Promise<RegistrationStatuses>): Promise<RegistrationStatuses> {
        const toRecompute = [...new Set(displayedTableIds)].filter(id => tableIds.has(id));
        if (toRecompute.length === 0) return new Map();

        // un retour précédent a pu remettre la Table en cache (« non enregistrée ») : on force le recalcul
        await Promise.all(toRecompute.map(id => module.invalidate(id)));
        const statuses = await recompute(toRecompute);

        toRecompute.forEach(id => {
            if (isSettled(statuses.get(id))) tableIds.delete(id);
        });

        return statuses;
    }

    return {
        /** Clic sur le lien d'une Table : son entrée de cache est invalidée. */
        async invalidate(tableId: string): Promise<void> {
            tableIds.add(tableId);
            await module.invalidate(tableId);
        },

        /**
         * Retour sur l'onglet : recalcule (`recompute`, cache actif) seulement les Tables invalidées parmi celles affichées.
         * Aucun appel s'il n'y en a pas. Les retours successifs sont traités l'un après l'autre.
         */
        refresh(displayedTableIds: string[], recompute: (tableIds: string[]) => Promise<RegistrationStatuses>): Promise<RegistrationStatuses> {
            const result = queue.then(() => refreshNow(displayedTableIds, recompute));
            queue = result.catch(() => undefined);
            return result;
        }
    };
}
