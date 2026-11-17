import { BackgroundMessages } from "~/core/models/backgroundMessages";
import type { BackgroundRequest } from "~/core/messaging/sendToBackground";
import boardGameArenaRepository from "~/core/repositories/boardGameArenaRepository";
import notificationsService from "~/core/services/notificationsService";
import {
    browserSupportsWindows,
    closeOrphanBulkRegistrationWindows,
    handleBulkRegistrationPort
} from "./bulkRegistrationWindow";
import canOpenWindows from "./messages/canOpenWindows";
import getBgaBoard from "./messages/getBgaBoard";
import getBgaFriends from "./messages/getBgaFriends";
import getBgaGames from "./messages/getBgaGames";
import getBgaTable from "./messages/getBgaTable";
import getBgaUser from "./messages/getBgaUser";
import getMyludoAccount from "./messages/getMyludoAccount";
import getMyludoPlayDetails from "./messages/getMyludoPlayDetails";
import getMyludoPlayedGames from "./messages/getMyludoPlayedGames";
import getMyludoPlays from "./messages/getMyludoPlays";
import getMyludoUser from "./messages/getMyludoUser";

type Handler = (body: any) => Promise<unknown>;

const handlers: Record<string, Handler> = {
    [BackgroundMessages.CAN_OPEN_WINDOWS]: () => canOpenWindows(),
    [BackgroundMessages.GET_BGA_BOARD]: (body) => getBgaBoard(body.query),
    [BackgroundMessages.GET_BGA_FRIENDS]: () => getBgaFriends(),
    [BackgroundMessages.GET_BGA_GAMES]: (body) => getBgaGames(body.query),
    [BackgroundMessages.GET_BGA_TABLE]: (body) => getBgaTable(body.tableId),
    [BackgroundMessages.GET_BGA_USER]: () => getBgaUser(),
    [BackgroundMessages.GET_MYLUDO_ACCOUNT]: () => getMyludoAccount(),
    [BackgroundMessages.GET_MYLUDO_PLAYS]: (body) => getMyludoPlays(body.myludoGameId, body.dateFrom, body.dateTo),
    [BackgroundMessages.GET_MYLUDO_PLAY_DETAILS]: (body) => getMyludoPlayDetails(body.playId),
    [BackgroundMessages.GET_MYLUDO_PLAYED_GAMES]: () => getMyludoPlayedGames(),
    [BackgroundMessages.GET_MYLUDO_USER]: () => getMyludoUser()
};

export default defineBackground(() => {
    chrome.runtime.onMessage.addListener((request: BackgroundRequest, _sender, sendResponse) => {
        const handler = handlers[request?.name];

        if (!handler) return false;

        handler(request.body).then((message) => sendResponse({ message }));

        return true; // keep the message channel open for the async response
    });

    // Enregistrement groupé : fenêtre Myludo dédiée, pilotée depuis la page BGA par une connexion durable
    chrome.runtime.onConnect.addListener(handleBulkRegistrationPort);
    if (browserSupportsWindows()) closeOrphanBulkRegistrationWindows();

    chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
        const manifestData = chrome.runtime.getManifest();

        let showBoarding = false;
        if (reason === "install") {
            showBoarding = true;
        }

        if (reason === "update" && previousVersion) {
            const currentMinorVersion = manifestData.version.substring(0, 3);
            const previousMinorVersion = previousVersion.substring(0, 3);

            if (currentMinorVersion !== previousMinorVersion) {
                showBoarding = true;
            }

            // Migration v3.x.x vers v4.x.x : nettoyer le storage des notifications
            const currentMajor = parseInt(manifestData.version.split('.')[0]!);
            const previousMajor = parseInt(previousVersion.split('.')[0]!);

            if (previousMajor < 4 && currentMajor >= 4) {
                // Breaking change : structure PlayerNotification modifiée
                await notificationsService.clearStorage();
            }
        }

        if (showBoarding) {
            chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
        }

        await chrome.alarms.create('check-notifications', {
            when: Date.now() + 10000,
            periodInMinutes: 30
        });
    });

    chrome.alarms.onAlarm.addListener(async () => {
        boardGameArenaRepository.getPlayerNotifications()
            .then(response => {
                notificationsService.updateNotifications(response);
            });
    });
});
