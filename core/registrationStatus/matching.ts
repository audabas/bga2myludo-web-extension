import { candidateWindow, localEndDay } from "./localDay";
import { normalizeTablePlayers } from "./players";
import type { MyludoPlay, RegistrationStatusConfiguration, RegistrationTable } from "./types";

interface FingerprintPlayer {
    name: string;
    score?: number | string | null;
}

/** Score comparable : absent, vide, non numérique ou 0 sont confondus (0 n'est pas reporté par le préremplissage). */
function comparableScore(score: number | string | null | undefined): number | undefined {
    if (score === undefined || score === null || score === "") return undefined;
    const value = Number(score);
    return Number.isFinite(value) && value !== 0 ? value : undefined;
}

/**
 * Empreinte pseudos/scores, reprise de l'ancienne détection « partie similaire » :
 * préfixes du type « A1 » retirés, insensible à la casse, tri par score décroissant puis par pseudo,
 * scores ignorés en coopératif. Elle est calculée de la même façon des deux côtés.
 */
export function playersFingerprint(players: FingerprintPlayer[], ignoreScores: boolean): string {
    const items = players
        .map(o => ({
            name: o.name.replace(/[A-Z][0-9][\s-]/g, '').trim().toLowerCase(),
            score: ignoreScores ? undefined : comparableScore(o.score)
        }))
        .sort((a, b) => {
            const scoreA = a.score ?? -Infinity;
            const scoreB = b.score ?? -Infinity;
            if (scoreA !== scoreB) return scoreA < scoreB ? 1 : -1;
            if (a.name < b.name) return -1;
            if (a.name > b.name) return 1;
            return 0;
        });

    return JSON.stringify(items);
}

/**
 * Règle de correspondance Table ↔ Partie Myludo (les Parties Myludo sont celles de la fiche de jeu de la Table) :
 * jour de la partie dans [J-1, J+1] et même empreinte pseudos/scores.
 */
export function findMatchingPlay(table: RegistrationTable, plays: MyludoPlay[], configuration: RegistrationStatusConfiguration): MyludoPlay | undefined {
    const { dateFrom, dateTo } = candidateWindow(localEndDay(table.end));
    const tablePlayers = normalizeTablePlayers(table.players, configuration);

    return plays
        .filter(play => play.date >= dateFrom && play.date <= dateTo)
        .find(play => {
            const ignoreScores = table.isCooperative || play.coop;
            return playersFingerprint(tablePlayers, ignoreScores) === playersFingerprint(play.players, ignoreScores);
        });
}
