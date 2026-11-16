import { storage } from "wxt/utils/storage";
import { createRegistrationStatus } from "~/core/registrationStatus/registrationStatus";
import type { RegistrationStatusConfiguration } from "~/core/registrationStatus/types";
import configurationService from "./configurationService";
import myludoService from "./myludoService";

/** Configuration utile au module Statut d'enregistrement, lue depuis la configuration de l'extension. */
async function readConfiguration(): Promise<RegistrationStatusConfiguration> {
    const configuration = await configurationService.get();
    const games = await configurationService.getGames();

    return {
        // valeur par défaut appliquée par configurationService.get()
        enabled: configuration.showRegistrationStatus === true,
        customCurrentPlayerName: configuration.customizeCurrentPlayer && configuration.customCurrentPlayerName
            ? configuration.customCurrentPlayerName
            : undefined,
        userMappings: configuration.users.map(o => ({ bgaUser: o.bgaUser, myludoUser: o.myludoUser })),
        gameMappings: games.reduce((acc, game) => {
            if (game.currentMyludoId) acc[game.bgaId] = game.currentMyludoId;
            return acc;
        }, {} as Record<string, string>)
    };
}

/** Module Statut d'enregistrement branché sur le script de fond (Myludo), le stockage local et l'horloge système. */
const registrationStatusModule = createRegistrationStatus({
    myludo: {
        getAccount: () => myludoService.getAccount(),
        getPlays: (myludoGameId, dateFrom, dateTo) => myludoService.getPlays(myludoGameId, dateFrom, dateTo),
        getPlayDetails: (playId) => myludoService.getPlayDetails(playId)
    },
    storage,
    clock: { now: () => new Date() },
    configuration: readConfiguration
});

const registrationStatusService = {
    ...registrationStatusModule,

    /**
     * Vrai si l'option « Afficher le statut Myludo dans l'historique BGA » est activée.
     * Les pages de l'Historique BGA la consultent avant tout appel (BGA comme Myludo).
     */
    async isHistoryEnabled(): Promise<boolean> {
        const configuration = await configurationService.get();
        return configuration.showRegistrationStatus === true;
    }
};

export default registrationStatusService;
