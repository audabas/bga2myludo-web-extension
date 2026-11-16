export default class timeHelper {
    /**
     * Jour calendaire local (AAAA-MM-JJ) d'un instant, dans le fuseau horaire du navigateur.
     * Sert pour le jour local de fin d'une Table (et non son jour UTC).
     */
    static toLocalDay = (date: Date): string => {
        const year = date.getFullYear().toString().padStart(4, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    static getTextualTimeAgo = (time: number) => {
        const millisecondsDifference = new Date().getTime() - time;
        const minutes = Math.floor(millisecondsDifference / (1000 * 60));

        const minutesParHeure = 60;
        const secondesParJour = 1440;

        if (minutes >= secondesParJour) {
            const jours = Math.floor(minutes / secondesParJour);
            return `${jours} ${chrome.i18n.getMessage("notificationsdateAgoSuffixDay")}${jours > 1 ? 's' : ''}`;
        } else if (minutes >= minutesParHeure) {
            const heures = Math.floor(minutes / minutesParHeure);
            return `${heures} ${chrome.i18n.getMessage("notificationsdateAgoSuffixHour")}${heures > 1 ? 's' : ''}`;
        } else {
            return `${minutes} ${chrome.i18n.getMessage("notificationsdateAgoSuffixMinute")}${minutes > 1 ? 's' : ''}`;
        }
    };
}