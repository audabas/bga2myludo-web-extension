/**
 * Connexion durable (`chrome.runtime.connect`) entre la page BGA qui mène un Enregistrement groupé et le script de fond,
 * qui seul peut créer la fenêtre Myludo dédiée et y naviguer. Une connexion = un parcours = une fenêtre.
 * La page ferme la fenêtre en se déconnectant ; le script de fond la ferme aussi quand la page disparaît.
 */
export const BULK_REGISTRATION_PORT_NAME = "bulkRegistration";

/** Page BGA → script de fond : ouvrir le formulaire Myludo d'une Table (URL du lien unitaire). */
export interface BulkRegistrationOpenRequest {
    type: "open";
    requestId: number;
    url: string;
}

/** Script de fond → page BGA. */
export type BulkRegistrationPortEvent =
    /** le formulaire est en cours de chargement dans la fenêtre dédiée */
    | { type: "opened"; requestId: number }
    /** le formulaire n'a pas pu être ouvert (fenêtre fermée, onglet disparu…) */
    | { type: "openFailed"; requestId: number; error: string }
    /** l'utilisateur a fermé la fenêtre Myludo dédiée */
    | { type: "windowClosed" };
