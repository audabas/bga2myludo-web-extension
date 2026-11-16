import type { RegistrationStatus, RegistrationStatuses, UndeterminedReason } from "~/core/registrationStatus/types";

const REGISTERED_COLOR = "#2e7d32";
const UNDETERMINED_CLASS = "myludo-browser-extension-status-undetermined";

const UNDETERMINED_TOOLTIPS: Record<UndeterminedReason, string> = {
    notConnected: "registrationStatusNotConnectedTooltip",
    permissionMissing: "registrationStatusPermissionMissingTooltip",
    error: "registrationStatusErrorTooltip"
};

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
     * Statut indéterminé : le lien reste tel quel, suivi d'un « ? » discret dont l'infobulle donne la raison.
     * Les autres statuts gardent (ou rendent) le lien d'origine « Enregistrer sur Myludo ».
     */
    static applyToLink(link: HTMLAnchorElement, status: RegistrationStatus) {
        if (status.kind === "registered") {
            registrationStatusDisplayHelper.findUndeterminedMarker(link)?.remove();
            registrationStatusDisplayHelper.showRegistered(link);
            return;
        }

        registrationStatusDisplayHelper.showOriginal(link);

        if (status.kind === "undetermined") {
            registrationStatusDisplayHelper.showUndetermined(link, status.reason);
        } else {
            registrationStatusDisplayHelper.findUndeterminedMarker(link)?.remove();
        }
    }

    private static showRegistered(link: HTMLAnchorElement) {
        link.dataset.myludoStatus = "registered";
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

    /** Annule l'affichage « enregistrée » : libellé et style d'origine du lien (seul un jeu mappé peut être enregistré). */
    private static showOriginal(link: HTMLAnchorElement) {
        if (link.dataset.myludoStatus !== "registered") return;

        delete link.dataset.myludoStatus;
        link.textContent = chrome.i18n.getMessage("myLudoLinkText");
        link.style.removeProperty("background-color");
        link.style.removeProperty("background-image");
        link.style.removeProperty("color");

        if (link.classList.contains("bgabutton")) {
            link.classList.add("bgabutton_darkgray");
        }
        if (!link.getAttribute("style")) {
            link.removeAttribute("style");
        }
    }

    /** « ? » placé juste après le lien (jamais un lien : les gardes d'injection ne doivent pas le compter). */
    private static showUndetermined(link: HTMLAnchorElement, reason: UndeterminedReason) {
        const tooltip = chrome.i18n.getMessage(UNDETERMINED_TOOLTIPS[reason] ?? UNDETERMINED_TOOLTIPS.error);

        let marker = registrationStatusDisplayHelper.findUndeterminedMarker(link);
        if (!marker) {
            marker = document.createElement("span");
            marker.classList.add(UNDETERMINED_CLASS);
            marker.textContent = "?";
            marker.style.cssText = "margin-left: 4px; cursor: help; opacity: 0.6; font-size: 0.9em;";
            link.insertAdjacentElement("afterend", marker);
        }

        marker.title = tooltip;
        marker.setAttribute("aria-label", tooltip);
        marker.dataset.myludoReason = reason;
    }

    private static findUndeterminedMarker(link: HTMLAnchorElement): HTMLElement | null {
        const next = link.nextElementSibling as HTMLElement | null;
        return next?.classList.contains(UNDETERMINED_CLASS) ? next : null;
    }
}
