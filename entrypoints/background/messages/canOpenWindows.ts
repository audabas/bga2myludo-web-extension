import { browserSupportsWindows } from "../bulkRegistrationWindow";

/** Le navigateur sait-il ouvrir la fenêtre Myludo dédiée de l'Enregistrement groupé ? (non sur Firefox Android) */
export default async function canOpenWindows() {
    return browserSupportsWindows();
}
