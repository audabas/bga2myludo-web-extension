/** Attentes écourtées par une demande d'arrêt (`AbortSignal`). */
export default class abortHelper {
    /**
     * Valeur de la promesse, ou undefined dès que le signal est déclenché (tout de suite s'il l'est déjà).
     * L'appel en cours n'est pas annulé : sa réponse est simplement ignorée. Sans signal, la promesse elle-même.
     */
    static until<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T | undefined> {
        if (!signal) return promise;
        if (signal.aborted) return Promise.resolve(undefined);

        return new Promise((resolve, reject) => {
            const onAbort = () => resolve(undefined);
            signal.addEventListener("abort", onAbort, { once: true });
            promise.then(
                value => { signal.removeEventListener("abort", onAbort); resolve(value); },
                error => { signal.removeEventListener("abort", onAbort); reject(error); }
            );
        });
    }
}
