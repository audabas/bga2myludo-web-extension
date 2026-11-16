import type { Player } from "./player";

export class Table {
    tableId!: string;
    players!: Player[];
    // joueurs tels qu'ils apparaissent sur BGA (pseudos BGA, avant nom personnalisé, renommage ou filtrage), utilisés pour le Statut d'enregistrement
    originalPlayers?: Player[];
    end!: Date;
    isCooperative!: boolean;
    isSolo!: boolean;
    isAbandoned!: boolean;
    gameId!: string;
    duration?: number;
}