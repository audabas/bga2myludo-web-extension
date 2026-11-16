import type {
    BulkAnalysis,
    BulkRegistrationAvailability,
    BulkRegistrationRequiredOption,
    DiscardReason
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
        bulkRegistrationDisplayHelper.showText(panel, message("bulkRegistrationAnalysingText", { COUNT: tablesRead }));
    }

    static showAnalysis(panel: HTMLElement, analysis: BulkAnalysis) {
        const reasons = (Object.keys(DISCARD_LABELS) as DiscardReason[])
            .filter(reason => analysis.discarded[reason].length > 0)
            .map(reason => message(DISCARD_LABELS[reason], { COUNT: analysis.discarded[reason].length }));
        const discardedCount = reasons.length === 0
            ? "0"
            : `${Object.values(analysis.discarded).reduce((sum, ids) => sum + ids.length, 0)} (${reasons.join(", ")})`;

        const lines = [message("bulkRegistrationAnalysisText", {
            TO_REGISTER: analysis.toRegister.length,
            DISCARDED: discardedCount,
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

    private static showText(panel: HTMLElement, text: string) {
        const element = panel.querySelector(`.${MESSAGE_CLASS}`);
        if (element) element.textContent = text;
    }
}
