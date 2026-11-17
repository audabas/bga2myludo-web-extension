import { RegistrationStatusCache } from "./cache";
import abortHelper from "~/core/helpers/abortHelper";
import timeHelper from "~/core/helpers/timeHelper";
import { candidateWindow, shiftDay } from "./localDay";
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

/** Début de « toute la période » des Parties Myludo d'une fiche (avant Board Game Arena). */
const WHOLE_PERIOD_FROM = "2000-01-01";

/**
 * D'où viennent le compte Myludo et les Parties Myludo candidates d'un calcul.
 * - par jour (affichage des statuts, formulaire Myludo) : tout est redemandé à chaque calcul ;
 * - Analyse : partagé par tous les calculs de l'Analyse, avec le pré-filtre des jeux joués.
 */
interface PlaysSource {
    account(): Promise<MyludoAccount | null>;
    /**
     * Parties Myludo de la fiche couvrant au moins [J-1, J+1] (la règle de correspondance filtre la fenêtre) ;
     * `notPlayed` : la fiche n'a aucune Partie Myludo ; null : erreur.
     */
    plays(myludoGameId: string, day: string): Promise<MyludoPlay[] | null | "notPlayed">;
    /** détails déjà lus */
    details: Map<string, Promise<MyludoPlayDetails | null>>;
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

            pending.push({ table, myludoGameId, day: timeHelper.toLocalDay(table.end) });
        });

        return pending;
    }

    /** Parties Myludo de la fenêtre [J-1, J+1] de la fiche. */
    function playsOfWindow(myludoGameId: string, day: string) {
        const { dateFrom, dateTo } = candidateWindow(day);
        return safely(() => deps.myludo.getPlays(myludoGameId, dateFrom, dateTo));
    }

    /** Source par jour : un compte et un `getPlays` par groupe (fiche de jeu, J) à chaque calcul. */
    function perDaySource(): PlaysSource {
        return {
            account: () => safely(() => deps.myludo.getAccount()),
            plays: playsOfWindow,
            details: new Map()
        };
    }

    /**
     * Source d'une Analyse, partagée par tous ses calculs :
     * - compte Myludo lu une fois (redemandé tant qu'il n'est pas connecté) ;
     * - liste des jeux joués lue une fois : une fiche absente n'a aucune Partie Myludo. Illisible : pas de pré-filtre ;
     * - une seule requête par fiche jouée, sur toute la période ; si elle échoue (fiche trop chargée pour le plafond
     *   de pages, erreur), repli sur la fenêtre [J-1, J+1] de chaque groupe ;
     * - chaque détail lu une fois.
     */
    function analysisSource(): PlaysSource {
        let account: Promise<MyludoAccount | null> | undefined;
        let playedGames: Promise<Set<string> | null> | undefined;
        const wholePeriod = new Map<string, Promise<MyludoPlay[] | null>>();
        const wholePeriodTo = shiftDay(timeHelper.toLocalDay(deps.clock.now()), 1);

        return {
            account() {
                if (!account) {
                    account = safely(() => deps.myludo.getAccount()).then(result => {
                        if (result?.status !== "connected") account = undefined;
                        return result;
                    });
                }
                return account;
            },
            async plays(myludoGameId, day) {
                playedGames ??= safely(() => deps.myludo.getPlayedGames()).then(ids => ids ? new Set(ids) : null);
                const played = await playedGames;
                if (played && !played.has(myludoGameId)) return "notPlayed";

                let plays = wholePeriod.get(myludoGameId);
                if (!plays) {
                    plays = safely(() => deps.myludo.getPlays(myludoGameId, WHOLE_PERIOD_FROM, wholePeriodTo));
                    wholePeriod.set(myludoGameId, plays);
                }
                return (await plays) ?? playsOfWindow(myludoGameId, day);
            },
            details: new Map()
        };
    }

    /**
     * Lecture du détail d'une Partie Myludo, au plus une fois par Partie Myludo et par source.
     * Après une demande d'arrêt, plus aucun détail n'est demandé (null, comme un détail illisible).
     */
    function detailsReader(details: PlaysSource["details"], signal?: AbortSignal): DetailsReader {
        return async playId => {
            if (signal?.aborted) return null;
            let pending = details.get(playId);
            if (!pending) {
                pending = safely(() => deps.myludo.getPlayDetails(playId));
                details.set(playId, pending);
            }
            return (await abortHelper.until(pending, signal)) ?? null;
        };
    }

    /** Statuts d'un groupe (fiche de jeu, J). Après une demande d'arrêt, les Tables non traitées restent sans statut. */
    async function computeGroup(group: PendingTable[], configuration: RegistrationStatusConfiguration, source: PlaysSource, getDetails: DetailsReader, statuses: RegistrationStatuses, signal?: AbortSignal) {
        const { myludoGameId, day } = group[0]!;
        const plays = await abortHelper.until(source.plays(myludoGameId, day), signal);
        if (signal?.aborted) return;

        for (const { table } of group) {
            if (plays === "notPlayed") {
                statuses.set(table.tableId, { kind: "notRegistered" });
                continue;
            }

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
            } else if (signal?.aborted) {
                // des détails n'ont pas été lus : ni « non enregistrée », ni « indéterminée »
                return;
            } else {
                // un détail illisible ne doit pas donner un faux « non enregistrée »
                statuses.set(table.tableId, fallback.detailsFailed ? undetermined("error") : { kind: "notRegistered" });
            }
        }
    }

    async function getStatuses(tables: RegistrationTable[], options: GetStatusesOptions, source: PlaysSource): Promise<RegistrationStatuses> {
        const statuses: RegistrationStatuses = new Map();
        const useCache = options.useCache !== false;

        if (tables.length === 0) return statuses;

        const configuration = await deps.configuration();
        // l'option ne concerne que l'Historique BGA : le mode « sans cache » (formulaire Myludo) l'ignore
        if (useCache && !configuration.enabled) return statuses;

        const pending = resolveGames(tables, configuration, statuses);
        if (pending.length === 0) return statuses;

        if (options.signal?.aborted) return statuses;

        // le compte est nécessaire même si tout est en cache : une entrée d'un autre compte est ignorée
        const account = await abortHelper.until(source.account(), options.signal);
        if (options.signal?.aborted) return statuses;
        if (account?.status !== "connected") {
            const reason = accountProblem(account ?? null) ?? "error";
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
        const getDetails = detailsReader(source.details, options.signal);
        for (const group of groupByGameAndDay(missing)) {
            if (options.signal?.aborted) break;
            await computeGroup(group, configuration, source, getDetails, statuses, options.signal);
        }

        // après une demande d'arrêt, seules les Tables calculées ont un statut
        const computed = missing.filter(({ table }) => statuses.has(table.tableId));
        // le mode « sans cache » n'écrit pas non plus : il ne doit pas masquer une invalidation en cours,
        // sauf, sur demande, une Table trouvée enregistrée (formulaire validé : il n'y a plus rien à revérifier)
        const toWrite = useCache
            ? computed
            : options.cacheRegistered ? computed.filter(({ table }) => statuses.get(table.tableId)?.kind === "registered") : [];
        await cache.write(toWrite.map(item => ({ tableId: item.table.tableId, status: statuses.get(item.table.tableId)!, context: context(item) })));

        return statuses;
    }

    return {
        getStatuses: (tables, options = {}) => getStatuses(tables, options, perDaySource()),

        openAnalysis() {
            const source = analysisSource();
            return { getStatuses: (tables, options = {}) => getStatuses(tables, options, source) };
        },

        invalidate: (tableId: string) => cache.invalidate(tableId),

        clearCache: () => cache.clear()
    };
}
