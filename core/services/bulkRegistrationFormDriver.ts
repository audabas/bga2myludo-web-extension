import type { BulkFormDriver } from "~/core/bulkRegistration/types";
import boardGameArenaHelper from "~/core/helpers/boardGameArenaHelper";
import {
    BULK_REGISTRATION_PORT_NAME,
    type BulkRegistrationOpenRequest,
    type BulkRegistrationPortEvent
} from "~/core/models/bulkRegistrationPort";
import type { RegistrationTable } from "~/core/registrationStatus/types";

/**
 * Pilote de formulaire relié au script de fond par une connexion durable : le script de fond crée la fenêtre Myludo
 * dédiée et y charge chaque formulaire ; `close` (déconnexion) la ferme. Voir `entrypoints/background/bulkRegistrationWindow.ts`.
 * La fermeture de la fenêtre par l'utilisateur, ou la disparition du script de fond, est signalée à `onWindowClosed`.
 */
export function openPortFormDriver(): BulkFormDriver {
    const port = chrome.runtime.connect({ name: BULK_REGISTRATION_PORT_NAME });
    const pending = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
    const windowClosedListeners: (() => void)[] = [];
    let nextRequestId = 0;
    let connected = true;

    const rejectPending = (reason: string) => {
        pending.forEach(request => request.reject(new Error(reason)));
        pending.clear();
    };

    port.onMessage.addListener((event: BulkRegistrationPortEvent) => {
        if (event.type === "windowClosed") {
            windowClosedListeners.forEach(listener => listener());
            return;
        }
        const request = pending.get(event.requestId);
        if (!request) return;
        pending.delete(event.requestId);
        if (event.type === "opened") request.resolve();
        else request.reject(new Error(event.error));
    });

    port.onDisconnect.addListener(() => {
        connected = false;
        rejectPending("Background disconnected");
        windowClosedListeners.forEach(listener => listener());
    });

    return {
        async open(table: RegistrationTable) {
            const url = await boardGameArenaHelper.myludoFormUrl(table.bgaGameId, table.tableId);
            if (!url) throw new Error(`No Myludo game for ${table.bgaGameId}`);
            if (!connected) throw new Error("Background disconnected");

            const requestId = ++nextRequestId;
            return new Promise<void>((resolve, reject) => {
                pending.set(requestId, { resolve, reject });
                port.postMessage({ type: "open", requestId, url } satisfies BulkRegistrationOpenRequest);
            });
        },

        async close() {
            if (!connected) return;
            connected = false;
            rejectPending("Closed");
            port.disconnect();
        },

        onWindowClosed(listener) {
            windowClosedListeners.push(listener);
        }
    };
}
