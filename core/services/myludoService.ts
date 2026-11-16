import { sendToBackground } from "~/core/messaging/sendToBackground";
import { BackgroundMessages } from "~/core/models/backgroundMessages";
import type { MyludoAccount, MyludoPlay, MyludoPlayDetails } from "~/core/registrationStatus/types";

export default class myludoService {
    static async isConnected() {
        return sendToBackground({ name: BackgroundMessages.GET_MYLUDO_USER })
            .then(response => {
                return response.message;
            })
            .catch(() => { return false; });
    }

    /** Compte Myludo connecté (id), ou raison pour laquelle on ne peut pas interroger Myludo. */
    static async getAccount(): Promise<MyludoAccount> {
        return sendToBackground<MyludoAccount>({ name: BackgroundMessages.GET_MYLUDO_ACCOUNT })
            .then(response => response?.message ?? { status: "error" } as MyludoAccount)
            .catch(() => ({ status: "error" } as MyludoAccount));
    }

    /** Parties Myludo d'une fiche de jeu (id numérique) entre deux jours inclus (AAAA-MM-JJ) ; null en cas d'erreur. */
    static async getPlays(myludoGameId: string, dateFrom: string, dateTo: string): Promise<MyludoPlay[] | null> {
        return sendToBackground<MyludoPlay[] | null>({ name: BackgroundMessages.GET_MYLUDO_PLAYS, body: { myludoGameId, dateFrom, dateTo } })
            .then(response => response?.message ?? null)
            .catch(() => null);
    }

    /** Détail d'une Partie Myludo (commentaire complet) ; null en cas d'erreur. */
    static async getPlayDetails(playId: string): Promise<MyludoPlayDetails | null> {
        return sendToBackground<MyludoPlayDetails | null>({ name: BackgroundMessages.GET_MYLUDO_PLAY_DETAILS, body: { playId } })
            .then(response => response?.message ?? null)
            .catch(() => null);
    }

    static async hasPermission() {
        return chrome.permissions
            .contains({ origins: ['https://www.myludo.fr/*'] })
            .then((result: boolean) => { return result; })
            .catch(() => { return false });
    }

    static async requestPermission() {
        chrome.permissions.request({ origins: ['https://www.myludo.fr/*'] });
    }
}