import timeHelper from "~/core/helpers/timeHelper";
import { candidateWindow } from "./localDay";
import type { MyludoPlay, MyludoPlayDetails, RegistrationTable } from "./types";

/** Résultat du repli : la Partie Myludo reconnue, sinon si un détail n'a pas pu être lu. */
export interface TableNumberFallbackResult {
    match?: MyludoPlay;
    detailsFailed: boolean;
}

/**
 * Vrai si le commentaire contient le lien de table de l'extension pour ce numéro de table
 * (« …/table?table=<numéro> », cf. le message `tableLinkText`). Le numéro doit être exactement celui de la Table :
 * 1234 ne reconnaît pas « table?table=12345 ».
 */
export function commentMentionsTable(comment: string, tableId: string): boolean {
    return [...comment.matchAll(/table\?table=(\d+)/g)].some(match => match[1] === tableId);
}

/**
 * Repli par numéro de table, pour une Table que la règle pseudos/scores n'a pas reconnue :
 * le détail n'est demandé que pour les candidates [J-1, J+1] commentées, une par une, jusqu'à la première reconnue.
 */
export async function findPlayByTableNumber(
    table: RegistrationTable,
    plays: MyludoPlay[],
    getDetails: (playId: string) => Promise<MyludoPlayDetails | null>
): Promise<TableNumberFallbackResult> {
    const { dateFrom, dateTo } = candidateWindow(timeHelper.toLocalDay(table.end));
    const candidates = plays.filter(play => play.hasComment && play.date >= dateFrom && play.date <= dateTo);
    let detailsFailed = false;

    for (const play of candidates) {
        const details = await getDetails(play.id);
        if (!details) {
            detailsFailed = true;
            continue;
        }
        if (commentMentionsTable(details.comment, table.tableId)) {
            return { match: play, detailsFailed };
        }
    }

    return { detailsFailed };
}
