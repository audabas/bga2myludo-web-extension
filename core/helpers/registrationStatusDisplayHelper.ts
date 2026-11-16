import type { RegistrationStatus, RegistrationStatuses } from "~/core/registrationStatus/types";

const REGISTERED_COLOR = "#2e7d32";

export default class registrationStatusDisplayHelper {
    /** Liens Myludo injectés pour une Table (attribut `data-myludo-table-id`). */
    static findLinks(tableId: string): HTMLAnchorElement[] {
        return Array.from(document.querySelectorAll<HTMLAnchorElement>(
            `a.myludo-browser-extension-button[data-myludo-table-id="${CSS.escape(tableId)}"]`
        ));
    }

    /** Met à jour les liens de chaque Table selon son Statut d'enregistrement. */
    static apply(statuses: RegistrationStatuses) {
        statuses.forEach((status, tableId) => {
            registrationStatusDisplayHelper.findLinks(tableId).forEach(link => registrationStatusDisplayHelper.applyToLink(link, status));
        });
    }

    /**
     * Table enregistrée : « ✓ Enregistrée sur Myludo » en vert, à la place du lien (qui reste cliquable).
     * Les autres statuts laissent le lien actuel tel quel.
     */
    static applyToLink(link: HTMLAnchorElement, status: RegistrationStatus) {
        if (status.kind !== "registered") return;

        link.dataset.myludoStatus = status.kind;
        link.textContent = chrome.i18n.getMessage("registeredOnMyludoText");

        if (link.classList.contains("bgabutton")) {
            link.classList.remove("bgabutton_darkgray");
            link.style.backgroundColor = REGISTERED_COLOR;
            link.style.backgroundImage = "none";
            link.style.color = "#fff";
        } else {
            link.style.color = REGISTERED_COLOR;
        }
    }
}
