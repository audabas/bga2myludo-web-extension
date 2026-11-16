import { storage } from "wxt/utils/storage";
import {
    BULK_REGISTRATION_PORT_NAME,
    type BulkRegistrationOpenRequest,
    type BulkRegistrationPortEvent
} from "~/core/models/bulkRegistrationPort";

/** Taille de la fenêtre dédiée : assez grande pour le formulaire, sans masquer toute la page BGA et sa progression. */
const WINDOW_WIDTH = 1000;
const WINDOW_HEIGHT = 800;

/** Délai maximal du chargement de la page vide intercalée entre deux formulaires. */
const BLANK_PAGE_TIMEOUT_MS = 5_000;

/**
 * Fenêtres Myludo dédiées ouvertes par ce script de fond, recopiées en stockage de session : si le service worker
 * est arrêté pendant un parcours, la connexion avec la page BGA est coupée et la page s'arrête, mais la fenêtre reste
 * ouverte. Au redémarrage du script de fond, les fenêtres notées par l'instance précédente sont donc orphelines.
 */
const DEDICATED_WINDOWS_KEY = "session:bulkRegistrationWindowIds";
const dedicatedWindows = new Set<number>();

function saveDedicatedWindows() {
    storage.setItem(DEDICATED_WINDOWS_KEY, [...dedicatedWindows])
        .catch(error => console.error("Error saving the Myludo bulk registration windows:", error));
}

/** Ferme les fenêtres dédiées laissées par une instance précédente du script de fond (à appeler au démarrage). */
export async function closeOrphanBulkRegistrationWindows() {
    try {
        const orphans = (await storage.getItem<number[]>(DEDICATED_WINDOWS_KEY)) ?? [];
        await Promise.all(orphans
            .filter(id => !dedicatedWindows.has(id))
            .map(id => chrome.windows.remove(id).catch(() => undefined)));
        await storage.setItem(DEDICATED_WINDOWS_KEY, [...dedicatedWindows]);
    } catch (error) {
        // stockage de session absent (anciens Firefox) : rien à fermer
        console.error("Error closing orphan Myludo bulk registration windows:", error);
    }
}

/** Enregistrement groupé possible : le navigateur sait créer des fenêtres (Firefox Android ne le sait pas). */
export function browserSupportsWindows(): boolean {
    return typeof chrome.windows?.create === "function";
}

/**
 * Charge une URL dans l'onglet et attend la fin du chargement (au plus `timeoutMs`).
 * On attend un passage à « loading » avant d'accepter « complete », pour ignorer un événement de la page précédente.
 */
function navigateAndWait(tabId: number, url: string, timeoutMs: number): Promise<void> {
    return new Promise(resolve => {
        let loading = false;
        const done = () => {
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
        };
        const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
            if (updatedTabId !== tabId) return;
            if (changeInfo.status === "loading") loading = true;
            else if (changeInfo.status === "complete" && loading) done();
        };
        const timer = setTimeout(done, timeoutMs);
        chrome.tabs.onUpdated.addListener(listener);
        chrome.tabs.update(tabId, { url }).catch(done);
    });
}

/**
 * Pilote de formulaire de l'Enregistrement groupé, côté script de fond, pour une connexion de la page BGA :
 * - une seule fenêtre Myludo dédiée, normale et visible (le script Myludo ne préremplit pas un onglet masqué),
 *   créée au premier formulaire, avec un seul onglet réutilisé ;
 * - chaque formulaire est chargé avec un rechargement complet : Myludo est une application monopage, et passer d'un
 *   lien unitaire à un autre ne change que le hash, sans recharger la page ni relancer le préremplissage (le script
 *   Myludo ne préremplit qu'une fois par chargement). L'onglet passe donc par `about:blank` entre deux formulaires ;
 * - la fermeture de la fenêtre par l'utilisateur est signalée à la page (`windowClosed`) ; les formulaires suivants
 *   échouent ;
 * - la déconnexion de la page (fin du parcours, onglet BGA fermé ou quitté) ferme la fenêtre.
 */
export function handleBulkRegistrationPort(port: chrome.runtime.Port) {
    if (port.name !== BULK_REGISTRATION_PORT_NAME) return;

    let windowId: number | undefined;
    let tabId: number | undefined;
    let windowClosedByUser = false;
    let disconnected = false;
    // un formulaire à la fois, dans l'ordre des demandes
    let queue: Promise<void> = Promise.resolve();

    const post = (event: BulkRegistrationPortEvent) => {
        if (disconnected) return;
        try {
            port.postMessage(event);
        } catch (error) {
            console.error("Error posting to the BGA page:", error);
        }
    };

    const forgetWindow = (id: number) => {
        if (dedicatedWindows.delete(id)) saveDedicatedWindows();
    };

    const closeWindow = () => {
        if (windowId === undefined) return;
        const id = windowId;
        windowId = undefined;
        tabId = undefined;
        chrome.windows.remove(id).catch(() => undefined).then(() => forgetWindow(id));
    };

    const onWindowRemoved = (removedWindowId: number) => {
        if (removedWindowId !== windowId) return;
        forgetWindow(removedWindowId);
        windowId = undefined;
        tabId = undefined;
        windowClosedByUser = true;
        post({ type: "windowClosed" });
    };

    async function open(url: string) {
        if (windowClosedByUser) throw new Error("Myludo window closed by the user");

        if (windowId === undefined) {
            const created = await chrome.windows.create({
                url,
                type: "normal",
                focused: true,
                width: WINDOW_WIDTH,
                height: WINDOW_HEIGHT
            });
            windowId = created?.id;
            tabId = created?.tabs?.[0]?.id;
            if (windowId !== undefined) {
                dedicatedWindows.add(windowId);
                saveDedicatedWindows();
            }
            if (disconnected) {
                closeWindow();
                return;
            }
            if (windowId !== undefined && tabId === undefined) {
                tabId = (await chrome.tabs.query({ windowId }))[0]?.id;
            }
            if (tabId === undefined) throw new Error("Myludo window has no tab");
            return;
        }

        if (tabId === undefined) throw new Error("Myludo window has no tab");
        await navigateAndWait(tabId, "about:blank", BLANK_PAGE_TIMEOUT_MS);
        await chrome.tabs.update(tabId, { url });
    }

    chrome.windows.onRemoved.addListener(onWindowRemoved);

    port.onMessage.addListener((request: BulkRegistrationOpenRequest) => {
        if (request?.type !== "open") return;
        queue = queue
            .then(() => open(request.url))
            .then(
                () => post({ type: "opened", requestId: request.requestId }),
                error => {
                    console.error("Error opening the Myludo form:", error);
                    post({ type: "openFailed", requestId: request.requestId, error: String(error) });
                }
            );
    });

    port.onDisconnect.addListener(() => {
        disconnected = true;
        chrome.windows.onRemoved.removeListener(onWindowRemoved);
        closeWindow();
    });
}
