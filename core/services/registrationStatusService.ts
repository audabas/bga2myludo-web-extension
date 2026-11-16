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
        // l'option « Afficher le statut Myludo dans l'historique BGA » n'existe pas encore
        enabled: true,
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
const registrationStatusService = createRegistrationStatus({
    myludo: {
        getAccount: () => myludoService.getAccount(),
        getPlays: (myludoGameId, dateFrom, dateTo) => myludoService.getPlays(myludoGameId, dateFrom, dateTo),
        getPlayDetails: (playId) => myludoService.getPlayDetails(playId)
    },
    storage,
    clock: { now: () => new Date() },
    configuration: readConfiguration
});

export default registrationStatusService;
