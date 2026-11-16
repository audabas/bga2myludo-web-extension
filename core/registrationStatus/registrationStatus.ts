import { RegistrationStatusCache } from "./cache";
import { candidateWindow, localEndDay } from "./localDay";
import { findMatchingPlay } from "./matching";
import type {
    GetStatusesOptions,
    MyludoAccount,
    MyludoPlay,
    RegistrationStatus,
    RegistrationStatusConfiguration,
    RegistrationStatusDependencies,
    RegistrationStatuses,
    RegistrationStatusModule,
    RegistrationTable,
    UndeterminedReason
} from "./types";

/** Table dont le jeu a une Correspondance de jeu exploitable. */
interface PendingTable {
    table: RegistrationTable;
    /** id numérique de la fiche de jeu Myludo */
    myludoGameId: string;
    /** J : jour local de fin */
    day: string;
}

/** Id numérique de la fiche Myludo : suffixe numérique de la Correspondance de jeu (« 5142 », « above-37300 »). */
function numericMyludoGameId(currentMyludoId: string): string | undefined {
    return currentMyludoId.match(/(\d+)$/)?.[1];
}

/** Appelle Myludo ; toute exception devient `null` (erreur). */
async function safely<T>(call: () => Promise<T>): Promise<T | null> {
    try {
        return await call();
    } catch (error) {
        console.error("Myludo access failed:", error);
        return null;
    }
}

function undetermined(reason: UndeterminedReason): RegistrationStatus {
    return { kind: "undetermined", reason };
}

function accountProblem(account: MyludoAccount | null): UndeterminedReason | undefined {
    if (!account) return "error";
    switch (account.status) {
        case "connected": return undefined;
        case "notConnected": return "notConnected";
        case "permissionMissing": return "permissionMissing";
        default: return "error";
    }
}

/** Regroupe les Tables par (fiche de jeu Myludo, J) : un seul appel Myludo par groupe. */
function groupByGameAndDay(pending: PendingTable[]): PendingTable[][] {
    const groups = new Map<string, PendingTable[]>();
    pending.forEach(item => {
        const key = `${item.myludoGameId}|${item.day}`;
        const group = groups.get(key) ?? [];
        group.push(item);
        groups.set(key, group);
    });
    return [...groups.values()];
}

export function createRegistrationStatus(deps: RegistrationStatusDependencies): RegistrationStatusModule {
    const cache = new RegistrationStatusCache(deps.storage, deps.clock);

    function resolveGames(tables: RegistrationTable[], configuration: RegistrationStatusConfiguration, statuses: RegistrationStatuses): PendingTable[] {
        const pending: PendingTable[] = [];

        tables.forEach(table => {
            const currentMyludoId = configuration.gameMappings[table.bgaGameId];

            if (!currentMyludoId) {
                statuses.set(table.tableId, { kind: "gameUnavailable" });
                return;
            }

            const myludoGameId = numericMyludoGameId(currentMyludoId);
            if (!myludoGameId) {
                // Correspondance de jeu inexploitable : on ne peut pas vérifier
                statuses.set(table.tableId, undetermined("error"));
                return;
            }

            pending.push({ table, myludoGameId, day: localEndDay(table.end) });
        });

        return pending;
    }

    async function computeGroup(group: PendingTable[], configuration: RegistrationStatusConfiguration, statuses: RegistrationStatuses) {
        const { myludoGameId, day } = group[0]!;
        const { dateFrom, dateTo } = candidateWindow(day);
        const plays: MyludoPlay[] | null = await safely(() => deps.myludo.getPlays(myludoGameId, dateFrom, dateTo));

        group.forEach(({ table }) => {
            if (!plays) {
                statuses.set(table.tableId, undetermined("error"));
                return;
            }

            const match = findMatchingPlay(table, plays, configuration);
            statuses.set(table.tableId, match ? { kind: "registered" } : { kind: "notRegistered" });
        });
    }

    return {
        async getStatuses(tables: RegistrationTable[], options: GetStatusesOptions = {}): Promise<RegistrationStatuses> {
            const statuses: RegistrationStatuses = new Map();
            const useCache = options.useCache !== false;

            if (tables.length === 0) return statuses;

            const configuration = await deps.configuration();
            if (!configuration.enabled) return statuses;

            const pending = resolveGames(tables, configuration, statuses);
            if (pending.length === 0) return statuses;

            // le compte est nécessaire même si tout est en cache : une entrée d'un autre compte est ignorée
            const account = await safely(() => deps.myludo.getAccount());
            if (account?.status !== "connected") {
                const reason = accountProblem(account) ?? "error";
                pending.forEach(({ table }) => statuses.set(table.tableId, undetermined(reason)));
                return statuses;
            }

            const context = (item: PendingTable) => ({ myludoAccountId: account.id, myludoGameId: item.myludoGameId });
            const cached = useCache
                ? await cache.read(pending.map(item => ({ tableId: item.table.tableId, context: context(item) })))
                : new Map<string, RegistrationStatus>();
            cached.forEach((status, tableId) => statuses.set(tableId, status));

            // seules les Tables absentes du cache ou expirées sont recalculées, séquentiellement pour ne pas solliciter Myludo en rafale
            const missing = pending.filter(({ table }) => !cached.has(table.tableId));
            for (const group of groupByGameAndDay(missing)) {
                await computeGroup(group, configuration, statuses);
            }

            // le mode « sans cache » n'écrit pas non plus : il ne doit pas masquer une invalidation en cours
            if (useCache) {
                await cache.write(missing.map(item => ({ tableId: item.table.tableId, status: statuses.get(item.table.tableId)!, context: context(item) })));
            }

            return statuses;
        },

        invalidate: (tableId: string) => cache.invalidate(tableId),

        clearCache: () => cache.clear()
    };
}
