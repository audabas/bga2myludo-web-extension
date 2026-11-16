import { bulkRegistrationAvailability, createBulkRegistration } from "~/core/bulkRegistration/bulkRegistration";
import type { BulkClock, BulkHistoryFeed, BulkRegistrationAvailability, BulkRegistrationModule } from "~/core/bulkRegistration/types";
import { sendToBackground } from "~/core/messaging/sendToBackground";
import { BackgroundMessages } from "~/core/models/backgroundMessages";
import type { User } from "~/core/models/user";
import type { RegistrationTable } from "~/core/registrationStatus/types";
import boardGameArenaService from "./boardGameArenaService";
import { openPortFormDriver } from "./bulkRegistrationFormDriver";
import configurationService from "./configurationService";
import gameStatsService from "./gameStatsService";
import type { HistoryFeed } from "./historySource";
import registrationStatusService from "./registrationStatusService";

const systemClock: BulkClock = {
    now: () => new Date(),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms))
};

/** Fil d'historique de l'Enregistrement groupé : les entrées d'un fil BGA, normalisées pour le joueur connecté. */
function normalizedFeed<TEntry>(
    feed: HistoryFeed<TEntry>,
    toRegistrationTable: (entry: TEntry) => RegistrationTable | null
): BulkHistoryFeed {
    return async () => {
        const page = await feed();
        if (!page) return null;

        return {
            tables: page.entries.map(toRegistrationTable).filter((table): table is RegistrationTable => table !== null),
            isLast: page.isLast
        };
    };
}

/** Le script de fond sait-il ouvrir la fenêtre Myludo dédiée ? (pas de fenêtres sur Firefox Android) */
async function canOpenWindows(): Promise<boolean> {
    try {
        const response = await sendToBackground<boolean>({ name: BackgroundMessages.CAN_OPEN_WINDOWS });
        return response?.message === true;
    } catch (error) {
        console.error("Error checking windows support:", error);
        return false;
    }
}

/** Bouton et module Enregistrement groupé d'une page d'Historique BGA (script de la page BGA). */
export interface BulkRegistrationPage {
    availability: BulkRegistrationAvailability;
    /** module branché sur le fil de la page, pour un bouton actif */
    module?: BulkRegistrationModule;
}

export default class bulkRegistrationService {
    /**
     * Enregistrement groupé de « Statistiques de jeu », dans le périmètre des filtres de l'URL courante.
     * Statut Myludo désactivé : aucun appel (ni BGA ni Myludo).
     */
    static async forGameStats(): Promise<BulkRegistrationPage> {
        const configuration = await configurationService.get();
        if (configuration.showRegistrationStatus !== true) return { availability: { kind: "hidden" } };

        const connectedUser: User | null = await boardGameArenaService.isConnected().then(user => user || null);
        const displayedPlayer = new URLSearchParams(window.location.search).get("player");
        const availability = bulkRegistrationAvailability(
            configuration,
            displayedPlayer,
            connectedUser?.id ?? null,
            await canOpenWindows()
        );
        if (availability.kind !== "enabled" || !connectedUser) return { availability };

        const search = gameStatsService.currentFilters(connectedUser);
        const module = createBulkRegistration({
            openFeed: () => normalizedFeed(
                gameStatsService.openFeed(search),
                table => gameStatsService.toRegistrationTable(table, connectedUser.id)
            ),
            statuses: registrationStatusService,
            clock: systemClock,
            openFormDriver: openPortFormDriver
        });

        return { availability, module };
    }
}
