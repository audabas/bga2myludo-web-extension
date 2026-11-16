import type { RegistrationPlayer, RegistrationStatusConfiguration } from "./types";

export interface NormalizedPlayer {
    name: string;
    score?: number;
}

/**
 * Normalise les joueurs d'origine d'une Table comme le préremplissage du formulaire Myludo :
 * nom personnalisé du joueur courant, puis correspondances de joueurs BGA → Myludo.
 * (« renommer les adversaires » / « garder le meilleur adversaire » ne s'appliquent pas ici.)
 */
export function normalizeTablePlayers(players: RegistrationPlayer[], configuration: RegistrationStatusConfiguration): NormalizedPlayer[] {
    return players.map(player => {
        let name = player.name;

        if (player.isCurrentPlayer && configuration.customCurrentPlayerName) {
            name = configuration.customCurrentPlayerName;
        }

        const mapping = configuration.userMappings.find(o => o.bgaUser === name);
        if (mapping && mapping.myludoUser) {
            name = mapping.myludoUser;
        }

        return { name, score: player.score };
    });
}
