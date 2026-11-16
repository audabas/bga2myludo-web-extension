import type { Clock, RegistrationStatus, RegistrationStatusStorage } from "./types";

/** Statuts que l'on accepte de mettre en cache (« indéterminée » ne l'est jamais). */
type CachedStatus = Extract<RegistrationStatus, { kind: "registered" | "notRegistered" }>;

/** Entrée du cache, une par numéro de Table. */
interface CacheEntry {
    status: CachedStatus;
    /** date de calcul (ms depuis l'epoch) */
    computedAt: number;
    /** id du compte Myludo pour lequel le statut a été calculé */
    myludoAccountId: string;
    /** id numérique de la fiche de jeu Myludo interrogée */
    myludoGameId: string;
}

/** Ce qui doit correspondre pour qu'une entrée soit utilisable. */
export interface CacheContext {
    myludoAccountId: string;
    myludoGameId: string;
}

const KEY_PREFIX = "registrationStatusCache.";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Durée de validité selon le statut. */
const TIME_TO_LIVE_MS: Record<CachedStatus["kind"], number> = {
    registered: 30 * DAY_MS,
    notRegistered: 7 * DAY_MS
};

function storageKey(tableId: string) {
    return `local:${KEY_PREFIX}${tableId}` as const;
}

function isCacheable(status: RegistrationStatus): status is CachedStatus {
    return status.kind === "registered" || status.kind === "notRegistered";
}

function isEntry(value: unknown): value is CacheEntry {
    if (!value || typeof value !== "object") return false;
    const entry = value as Partial<CacheEntry>;
    return isCacheable(entry.status as RegistrationStatus)
        && typeof entry.computedAt === "number"
        && typeof entry.myludoAccountId === "string"
        && typeof entry.myludoGameId === "string";
}

/** Cache persistant des Statuts d'enregistrement, dans le stockage local de l'extension. */
export class RegistrationStatusCache {
    constructor(private readonly storage: RegistrationStatusStorage, private readonly clock: Clock) { }

    /** Statuts encore valides pour ces Tables (compte et fiche de jeu identiques, non expirés). */
    async read(requests: { tableId: string; context: CacheContext }[]): Promise<Map<string, CachedStatus>> {
        const found = new Map<string, CachedStatus>();
        if (requests.length === 0) return found;

        const values = await this.storage.getItems(requests.map(o => storageKey(o.tableId)));
        const now = this.clock.now().getTime();

        requests.forEach(({ tableId, context }, index) => {
            const entry = values[index]?.value;
            if (!isEntry(entry)) return;
            if (entry.myludoAccountId !== context.myludoAccountId || entry.myludoGameId !== context.myludoGameId) return;

            // une date de calcul dans le futur (horloge reculée) est traitée comme expirée
            const age = now - entry.computedAt;
            if (age < 0 || age >= TIME_TO_LIVE_MS[entry.status.kind]) return;

            found.set(tableId, entry.status);
        });

        return found;
    }

    /** Enregistre les statuts calculés ; ceux qui ne sont pas cachables sont ignorés. */
    async write(results: { tableId: string; status: RegistrationStatus; context: CacheContext }[]): Promise<void> {
        const computedAt = this.clock.now().getTime();
        const items = results
            .filter(o => isCacheable(o.status))
            .map(({ tableId, status, context }) => ({
                key: storageKey(tableId),
                value: { status, computedAt, ...context } as CacheEntry
            }));

        if (items.length > 0) await this.storage.setItems(items);
    }

    /** Oublie le statut d'une Table : il sera recalculé à la prochaine demande. */
    async invalidate(tableId: string): Promise<void> {
        await this.storage.removeItem(storageKey(tableId));
    }

    /** Vide complètement le cache. */
    async clear(): Promise<void> {
        const snapshot = await this.storage.snapshot("local");
        const keys = Object.keys(snapshot)
            .filter(key => key.startsWith(KEY_PREFIX))
            .map(key => `local:${key}` as const);

        if (keys.length > 0) await this.storage.removeItems(keys);
    }
}
