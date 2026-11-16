export default class timeHelper {
    /**
     * Local calendar day (YYYY-MM-DD) of an instant, in the browser's time zone.
     * Used for the local end day of a Table (not its UTC day).
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