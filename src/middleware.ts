import { Middleware } from "./types";

/**
 * Compose middlewares into a single async function.
 * Each middleware must call next() to continue.
 *
 * This version:
 * - protects against multiple next() calls (same as before)
 * - propagates errors (rejects) to caller so the app can handle them centrally
 */
export function compose(middlewares: Middleware[]) {
    return async (req: Parameters<Middleware>[0], res: Parameters<Middleware>[1]) => {
        let i = -1;
        const dispatch = async (index: number): Promise<void> => {
            if (index <= i) throw new Error("next() called multiple times");
            i = index;
            const fn = middlewares[index];
            if (!fn) return;
            try {
                // ensure returned promise is awaited and errors bubble up
                await Promise.resolve(fn(req as any, res as any, () => dispatch(index + 1)));
            } catch (err) {
                // rethrow to let the outer caller (App) handle it and return a proper 500/response
                throw err;
            }
        };
        await dispatch(0);
    };
}
