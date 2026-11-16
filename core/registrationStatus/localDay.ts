import timeHelper from "~/core/helpers/timeHelper";

/** Jour local de fin d'une Table (J), au format AAAA-MM-JJ. */
export function localEndDay(end: Date): string {
    return timeHelper.toLocalDay(end);
}

/** Décale un jour AAAA-MM-JJ de `delta` jours calendaires (passage par une date locale, insensible aux changements d'heure). */
export function shiftDay(day: string, delta: number): string {
    const [year, month, date] = day.split("-").map(Number);
    const shifted = new Date(year!, month! - 1, date!);
    shifted.setDate(shifted.getDate() + delta);
    return timeHelper.toLocalDay(shifted);
}

/** Fenêtre [J-1, J+1] des Parties Myludo candidates pour une Table finie le jour J. */
export function candidateWindow(day: string): { dateFrom: string; dateTo: string } {
    return { dateFrom: shiftDay(day, -1), dateTo: shiftDay(day, 1) };
}
