import { candidateWindow, localEndDay } from "./localDay";
import { findMatchingPlay } from "./matching";
import { findPlayByTableNumber } from "./tableNumberFallback";
import type {
    GetStatusesOptions,
    MyludoAccount,
    MyludoPlay,
    MyludoPlayDetails,
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

type DetailsReader = (playId: string) => Promise<MyludoPlayDetails | null>;

export function createRegistrationStatus(deps: RegistrationStatusDependencies): RegistrationStatusModule {
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

    /** Lecture du détail d'une Partie Myludo, au plus une fois par Partie Myludo et par calcul. */
    function detailsReader(): DetailsReader {
        const details = new Map<string, Promise<MyludoPlayDetails | null>>();
        return playId => {
            let pending = details.get(playId);
            if (!pending) {
                pending = safely(() => deps.myludo.getPlayDetails(playId));
                details.set(playId, pending);
            }
            return pending;
        };
    }

    async function computeGroup(group: PendingTable[], configuration: RegistrationStatusConfiguration, getDetails: DetailsReader, statuses: RegistrationStatuses) {
        const { myludoGameId, day } = group[0]!;
        const { dateFrom, dateTo } = candidateWindow(day);
        const plays: MyludoPlay[] | null = await safely(() => deps.myludo.getPlays(myludoGameId, dateFrom, dateTo));

        for (const { table } of group) {
            if (!plays) {
                statuses.set(table.tableId, undetermined("error"));
                continue;
            }

            if (findMatchingPlay(table, plays, configuration)) {
                statuses.set(table.tableId, { kind: "registered" });
                continue;
            }

            // Repli par numéro de table (lien de table écrit par l'extension dans le commentaire)
            const fallback = await findPlayByTableNumber(table, plays, getDetails);
            if (fallback.match) {
                statuses.set(table.tableId, { kind: "registered" });
            } else {
                // un détail illisible ne doit pas donner un faux « non enregistrée »
                statuses.set(table.tableId, fallback.detailsFailed ? undetermined("error") : { kind: "notRegistered" });
            }
        }
    }

    return {
        async getStatuses(tables: RegistrationTable[], _options: GetStatusesOptions = {}): Promise<RegistrationStatuses> {
            const statuses: RegistrationStatuses = new Map();

            if (tables.length === 0) return statuses;

            const configuration = await deps.configuration();
            if (!configuration.enabled) return statuses;

            const pending = resolveGames(tables, configuration, statuses);
            if (pending.length === 0) return statuses;

            const account = await safely(() => deps.myludo.getAccount());
            const problem = accountProblem(account);
            if (problem) {
                pending.forEach(({ table }) => statuses.set(table.tableId, undetermined(problem)));
                return statuses;
            }

            // séquentiel, pour ne pas solliciter Myludo en rafale
            const getDetails = detailsReader();
            for (const group of groupByGameAndDay(pending)) {
                await computeGroup(group, configuration, getDetails, statuses);
            }

            return statuses;
        },

        // Pas encore de cache (ticket 08) : rien à invalider ni à vider.
        async invalidate(_tableId: string): Promise<void> { },

        async clearCache(): Promise<void> { }
    };
}
