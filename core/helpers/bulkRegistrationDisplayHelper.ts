import type {
    BulkAnalysis,
    BulkRecap,
    BulkRegistrationAvailability,
    BulkRegistrationRequiredOption,
    DiscardReason,
    RegistrationProgress
} from "~/core/bulkRegistration/types";

/** Marqueur du panneau (jamais la classe des liens Myludo : elle sert de garde d'injection des lignes). */
export const BULK_REGISTRATION_PANEL_ATTRIBUTE = "data-myludo-bulk-registration";

const OPTION_LABELS: Record<BulkRegistrationRequiredOption, string> = {
    autoSubmit: "configurationAutoSubmitLabel",
    addTableLink: "configurationAddTableLinkLabel"
};

const DISCARD_LABELS: Record<DiscardReason, string> = {
    undetermined: "bulkRegistrationDiscardedUndeterminedText",
    abandoned: "bulkRegistrationDiscardedAbandonedText",
    gameUnavailable: "bulkRegistrationDiscardedGameUnavailableText"
};

const BUTTON_CLASS = "myludo-bulk-registration-button";
const MESSAGE_CLASS = "myludo-bulk-registration-message";
const ACTIONS_CLASS = "myludo-bulk-registration-actions";
const DETAILS_CLASS = "myludo-bulk-registration-details";

/** Table en échec dans le récapitulatif, avec l'URL de son lien unitaire (null : pas de lien). */
export interface FailedTableLink {
    tableId: string;
    url: string | null;
}

function message(key: string, tokens: Record<string, string | number> = {}): string {
    return Object.entries(tokens).reduce(
        (text, [token, value]) => text.replace(`#${token}#`, String(value)),
        chrome.i18n.getMessage(key)
    );
}

/** Panneau de l'Enregistrement groupé dans une page d'Historique BGA : bouton, explication, progression, résultat. */
export default class bulkRegistrationDisplayHelper {
    /** Panneau du bouton, ou null quand il n'y a pas de bouton. `onStart` est appelé au clic sur un bouton actif. */
    static createPanel(availability: BulkRegistrationAvailability, onStart: () => void): HTMLElement | null {
        if (availability.kind === "hidden") return null;

        const panel = document.createElement("div");
        panel.setAttribute(BULK_REGISTRATION_PANEL_ATTRIBUTE, "true");
        panel.style.cssText = "margin: 8px 0;";

        const button = document.createElement("a");
        button.href = "#";
        button.classList.add(BUTTON_CLASS, "bgabutton");
        button.style.cssText = "display: inline-block;";
        button.textContent = chrome.i18n.getMessage("bulkRegistrationButtonText");
        panel.appendChild(button);

        const text = document.createElement("div");
        text.classList.add(MESSAGE_CLASS);
        text.style.cssText = "margin-top: 4px; white-space: pre-line;";
        panel.appendChild(text);

        // boutons de confirmation
        const actions = document.createElement("div");
        actions.classList.add(ACTIONS_CLASS);
        actions.style.cssText = "margin-top: 4px;";
        panel.appendChild(actions);

        // liens unitaires des Tables en échec
        const details = document.createElement("div");
        details.classList.add(DETAILS_CLASS);
        details.style.cssText = "margin-top: 4px;";
        panel.appendChild(details);

        if (availability.kind === "disabled") {
            const explanation = bulkRegistrationDisplayHelper.missingOptionsText(availability.missingOptions);
            button.classList.add("bgabutton_darkgray");
            button.setAttribute("aria-disabled", "true");
            button.style.opacity = "0.5";
            button.style.cursor = "not-allowed";
            button.title = explanation;
            button.addEventListener("click", event => event.preventDefault());
            text.textContent = explanation;
            return panel;
        }

        button.classList.add("bgabutton_blue");
        button.addEventListener("click", event => {
            event.preventDefault();
            if (button.getAttribute("aria-disabled") === "true") return;
            onStart();
        });

        return panel;
    }

    /** Explication du bouton désactivé, avec les libellés des options de la fenêtre de l'extension. */
    static missingOptionsText(missingOptions: BulkRegistrationRequiredOption[]): string {
        const options = missingOptions
            .map(option => `« ${chrome.i18n.getMessage(OPTION_LABELS[option])} »`)
            .join(chrome.i18n.getMessage("bulkRegistrationOptionsSeparator"));
        return message("bulkRegistrationMissingOptionsText", { OPTIONS: options });
    }

    /** Bouton momentanément inactif (pendant l'analyse), puis rendu. */
    static setBusy(panel: HTMLElement, busy: boolean) {
        const button = panel.querySelector<HTMLElement>(`.${BUTTON_CLASS}`);
        if (!button) return;

        if (busy) {
            button.setAttribute("aria-disabled", "true");
            button.style.opacity = "0.5";
        } else {
            button.removeAttribute("aria-disabled");
            button.style.removeProperty("opacity");
        }
    }

    static showAnalysing(panel: HTMLElement, tablesRead: number) {
        bulkRegistrationDisplayHelper.clearExtras(panel);
        bulkRegistrationDisplayHelper.showText(panel, message("bulkRegistrationAnalysingText", { COUNT: tablesRead }));
    }

    /** Tables écartées : leur nombre, suivi du détail par raison. */
    private static discardedText(discarded: Record<DiscardReason, string[]>): string {
        const reasons = (Object.keys(DISCARD_LABELS) as DiscardReason[])
            .filter(reason => discarded[reason].length > 0)
            .map(reason => message(DISCARD_LABELS[reason], { COUNT: discarded[reason].length }));
        return reasons.length === 0
            ? "0"
            : `${Object.values(discarded).reduce((sum, ids) => sum + ids.length, 0)} (${reasons.join(", ")})`;
    }

    static showAnalysis(panel: HTMLElement, analysis: BulkAnalysis) {
        const lines = [message("bulkRegistrationAnalysisText", {
            TO_REGISTER: analysis.toRegister.length,
            DISCARDED: bulkRegistrationDisplayHelper.discardedText(analysis.discarded),
            REGISTERED: analysis.alreadyRegistered.length
        })];

        if (analysis.myludoAccountIssue === "notConnected") lines.push(message("bulkRegistrationNotConnectedText"));
        if (analysis.myludoAccountIssue === "permissionMissing") lines.push(message("bulkRegistrationPermissionMissingText"));
        if (analysis.feedEnd === "pageCap") lines.push(message("bulkRegistrationPageCapText", { COUNT: analysis.tablesRead }));
        if (analysis.feedEnd === "error") lines.push(message("bulkRegistrationFeedErrorText"));

        bulkRegistrationDisplayHelper.showText(panel, lines.join("\n"));
    }

    static showError(panel: HTMLElement) {
        bulkRegistrationDisplayHelper.showText(panel, message("bulkRegistrationAnalysisErrorText"));
    }

    /**
     * Confirmation dans la page, avec le nombre de Tables, avant tout envoi (jamais de `confirm` du navigateur).
     * La question s'ajoute sous le résultat de l'analyse.
     */
    static showConfirmation(panel: HTMLElement, count: number, onConfirm: () => void) {
        const element = panel.querySelector(`.${MESSAGE_CLASS}`);
        if (element) element.textContent = `${element.textContent}\n${message("bulkRegistrationConfirmText", { COUNT: count })}`;

        const actions = panel.querySelector(`.${ACTIONS_CLASS}`);
        if (!actions) return;

        const confirm = bulkRegistrationDisplayHelper.createActionButton("bulkRegistrationConfirmButtonText", "bgabutton_blue");
        confirm.addEventListener("click", event => {
            event.preventDefault();
            actions.replaceChildren();
            onConfirm();
        });

        const cancel = bulkRegistrationDisplayHelper.createActionButton("bulkRegistrationCancelButtonText", "bgabutton_gray");
        cancel.style.marginLeft = "8px";
        cancel.addEventListener("click", event => {
            event.preventDefault();
            actions.replaceChildren();
        });

        actions.replaceChildren(confirm, cancel);
    }

    /** Progression « n / total » de l'enregistrement. */
    static showProgress(panel: HTMLElement, progress: RegistrationProgress) {
        bulkRegistrationDisplayHelper.showText(panel, message("bulkRegistrationProgressText", {
            RANK: progress.rank,
            TOTAL: progress.total,
            TABLE_ID: progress.table.tableId
        }));
    }

    /** Récapitulatif : enregistrées, échecs (avec le lien unitaire de chaque Table), écartées par raison. */
    static showRecap(panel: HTMLElement, recap: BulkRecap, failedLinks: FailedTableLink[]) {
        bulkRegistrationDisplayHelper.showText(panel, message("bulkRegistrationRecapText", {
            REGISTERED: recap.registered.length,
            FAILED: recap.failed.length,
            DISCARDED: bulkRegistrationDisplayHelper.discardedText(recap.discarded)
        }));

        const details = panel.querySelector(`.${DETAILS_CLASS}`);
        if (!details || failedLinks.length === 0) return;

        const title = document.createElement("div");
        title.textContent = message("bulkRegistrationFailedTablesText");
        const list = document.createElement("div");
        list.style.cssText = "display: flex; flex-wrap: wrap; gap: 4px 12px;";
        failedLinks.forEach(({ tableId, url }) => {
            const label = `#${tableId}`;
            if (!url) {
                list.appendChild(document.createTextNode(label));
                return;
            }
            // jamais la classe des liens Myludo des lignes : elle sert de garde d'injection
            const link = document.createElement("a");
            link.href = url;
            link.target = "_blank";
            link.textContent = label;
            list.appendChild(link);
        });
        details.replaceChildren(title, list);
    }

    static showRegistrationError(panel: HTMLElement) {
        bulkRegistrationDisplayHelper.showText(panel, message("bulkRegistrationRegistrationErrorText"));
    }

    private static createActionButton(labelKey: string, colorClass: string): HTMLAnchorElement {
        const button = document.createElement("a");
        button.href = "#";
        button.classList.add("bgabutton", colorClass);
        button.style.cssText = "display: inline-block;";
        button.textContent = chrome.i18n.getMessage(labelKey);
        return button;
    }

    /** Retire la confirmation et le détail des échecs d'un lancement précédent. */
    private static clearExtras(panel: HTMLElement) {
        panel.querySelector(`.${ACTIONS_CLASS}`)?.replaceChildren();
        panel.querySelector(`.${DETAILS_CLASS}`)?.replaceChildren();
    }

    private static showText(panel: HTMLElement, text: string) {
        const element = panel.querySelector(`.${MESSAGE_CLASS}`);
        if (element) element.textContent = text;
    }
}
