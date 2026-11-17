/** Horloge du régulateur : heure courante et pause (injectées pour les tests). */
export interface RateLimiterClock {
    now(): Date;
    sleep(ms: number): Promise<void>;
}

export interface MyludoRateLimiterOptions {
    /** requêtes au plus par fenêtre glissante */
    maxRequests: number;
    windowMs: number;
    /** délai entre deux essais après un 429 */
    retryDelayMs: number;
    /** nouveaux essais au plus après un 429 */
    maxRetries: number;
    clock: RateLimiterClock;
}

const systemClock: RateLimiterClock = {
    now: () => new Date(),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms))
};

/**
 * Myludo limite le débit à environ 100 requêtes par minute (fenêtre fixe, 429 sans `Retry-After`) :
 * 80 par fenêtre glissante de 60 s laissent de la marge à la navigation de l'utilisateur sur Myludo.
 * Après un 429, 5 essais espacés de 15 s couvrent plus d'une fenêtre de 60 s, quelle que soit sa phase.
 */
export const MYLUDO_RATE_LIMIT: Omit<MyludoRateLimiterOptions, "clock"> = {
    maxRequests: 80,
    windowMs: 60 * 1000,
    retryDelayMs: 15 * 1000,
    maxRetries: 5
};

/**
 * Régulateur de débit des requêtes Myludo.
 * Chaque requête attend son tour (file, ordre d'arrivée) tant que le plafond de la fenêtre glissante est atteint ;
 * elle n'échoue jamais pour cette raison. Sur un 429, toutes les requêtes sont suspendues et la même requête
 * est réessayée toutes les `retryDelayMs`, `maxRetries` fois au plus ; la dernière réponse est alors rendue telle quelle.
 * Le régulateur n'ajoute pas de parallélisme : il ne fait qu'ordonner et retarder les envois de ses appelants.
 */
export class MyludoRateLimiter {
    private readonly options: MyludoRateLimiterOptions;
    /** heures d'envoi des requêtes de la fenêtre en cours, de la plus ancienne à la plus récente */
    private sent: number[] = [];
    /** dernier de la file : chaque requête attend que la précédente ait obtenu son créneau */
    private queueTail: Promise<void> = Promise.resolve();
    /** suspension en cours après un 429 (résolue quand la requête refusée a abouti ou abandonné) */
    private suspension: Promise<void> | null = null;

    constructor(options: Partial<MyludoRateLimiterOptions> = {}) {
        this.options = { ...MYLUDO_RATE_LIMIT, clock: systemClock, ...options };
    }

    /** Envoie la requête (`send` peut être rappelé pour un nouvel essai) quand le débit le permet. */
    async schedule(send: () => Promise<Response>): Promise<Response> {
        const turn = this.queueTail.then(() => this.takeQueuedSlot());
        this.queueTail = turn;
        await turn;

        const response = await send();
        if (response.status !== 429) return response;

        return this.suspendAndRetry(send, response);
    }

    /** Créneau d'une requête de la file : attend la fin de toute suspension, puis une place dans la fenêtre. */
    private async takeQueuedSlot() {
        for (;;) {
            while (this.suspension) await this.suspension;

            const wait = this.slotWait();
            if (wait <= 0) {
                this.sent.push(this.now());
                return;
            }
            await this.options.clock.sleep(wait);
        }
    }

    /** Créneau d'un nouvel essai après un 429 : passe avant la file suspendue, mais respecte le plafond. */
    private async takeRetrySlot() {
        for (let wait = this.slotWait(); wait > 0; wait = this.slotWait()) await this.options.clock.sleep(wait);
        this.sent.push(this.now());
    }

    /** Délai avant qu'une place se libère dans la fenêtre glissante (0 : place libre). */
    private slotWait() {
        const now = this.now();
        this.sent = this.sent.filter(at => at > now - this.options.windowMs);

        if (this.sent.length < this.options.maxRequests) return 0;
        return this.sent[0]! + this.options.windowMs - now;
    }

    /** Suspend toutes les requêtes et réessaie celle-ci ; deux 429 simultanés se suspendent l'un après l'autre. */
    private suspendAndRetry(send: () => Promise<Response>, refused: Response): Promise<Response> {
        const { retryDelayMs, maxRetries, clock } = this.options;

        const retry = async () => {
            let response = refused;

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                console.warn(`Myludo answered 429, retry ${attempt}/${maxRetries} in ${retryDelayMs / 1000} s`);
                await clock.sleep(retryDelayMs);
                await this.takeRetrySlot();

                response = await send();
                if (response.status !== 429) return response;
            }

            return response;
        };

        const retried = (this.suspension ?? Promise.resolve()).then(retry);
        const suspension = retried.then(() => undefined, () => undefined);
        this.suspension = suspension;
        // enregistré avant les requêtes en attente : elles ne revoient pas une suspension terminée
        suspension.then(() => { if (this.suspension === suspension) this.suspension = null; });

        return retried;
    }

    private now() {
        return this.options.clock.now().getTime();
    }
}
