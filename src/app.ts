import http from "http";
import { Router } from "./router";
import { compose } from "./middleware";
import { createResponse } from "./response";
import { parseJsonFromStream } from "./request";
import type { Handler, Middleware, Request, Response, HTTPMethod, Plugin, PluginHooks } from "./types";

export class RouterGroup {
    private prefix: string;
    private router: Router;
    private groupMiddleware: Middleware[];
    private globalMiddlewareRef: Middleware[]; // reference to app-level middlewares

    constructor(prefix: string, router: Router, globalMiddlewareRef: Middleware[], groupMiddleware: Middleware[] = []) {
        this.prefix = prefix;
        this.router = router;
        this.groupMiddleware = groupMiddleware;
        this.globalMiddlewareRef = globalMiddlewareRef;
    }

    use(mw: Middleware) {
        this.groupMiddleware.push(mw);
    }

    private register(method: HTTPMethod, path: string, handler: Handler, middlewares: Middleware[] = []) {
        const fullPath = this.prefix.endsWith("/") ? this.prefix.slice(0, -1) : this.prefix;
        const finalPath = path.startsWith("/") ? path : `/${path}`;
        // combine: global app middleware -> group middleware -> route middleware
        const combined = [...this.globalMiddlewareRef, ...this.groupMiddleware, ...middlewares];
        this.router.register(method, `${fullPath}${finalPath}`, handler, combined);
    }

    get<P = any, Q = any, B = any>(path: string, handler: Handler<P, Q, B>, ...mw: Middleware[]) {
        this.register("GET", path, handler as unknown as Handler, mw);
    }
    post<P = any, Q = any, B = any>(path: string, handler: Handler<P, Q, B>, ...mw: Middleware[]) {
        this.register("POST", path, handler as unknown as Handler, mw);
    }
    put<P = any, Q = any, B = any>(path: string, handler: Handler<P, Q, B>, ...mw: Middleware[]) {
        this.register("PUT", path, handler as unknown as Handler, mw);
    }
    delete<P = any, Q = any, B = any>(path: string, handler: Handler<P, Q, B>, ...mw: Middleware[]) {
        this.register("DELETE", path, handler as unknown as Handler, mw);
    }
    patch<P = any, Q = any, B = any>(path: string, handler: Handler<P, Q, B>, ...mw: Middleware[]) {
        this.register("PATCH", path, handler as unknown as Handler, mw);
    }
}

export class App {
    private router = new Router();
    private middlewares: Middleware[] = [];
    private plugins: PluginHooks[] = [];
    private rawPlugins: Array<Plugin> = [];
    private server?: http.Server;

    use(mw: Middleware) {
        this.middlewares.push(mw);
    }

    // register a route (used by plugins)
    register<P = any, Q = any, B = any>(method: HTTPMethod, path: string, handler: Handler<P, Q, B>) {
        this.registerRoute(method, path, handler as unknown as Handler);
    }

    // register a plugin (can return hooks)
    async registerPlugin(plugin: Plugin) {
        this.rawPlugins.push(plugin);
        try {
            const result = await plugin({
                use: (mw: Middleware) => this.use(mw),
                register: <P = any, Q = any, B = any>(method: HTTPMethod, path: string, handler: Handler<P, Q, B>) => {
                    this.registerRoute(method, path, handler as unknown as Handler);
                },
            });
            if (result && typeof result === "object") {
                this.plugins.push(result as PluginHooks);
            }
        } catch (err) {
            // plugin registration failed — surface error
            throw err;
        }
    }

    bodyParser(options?: { limit?: number }) {
        const limit = options?.limit ?? 1_048_576;
        const mw: Middleware = async (req, res, next) => {
            try {
                const body = await parseJsonFromStream(req, limit);
                req.body = body ?? {};
                await next();
            } catch (err) {
                if ((err as Error).message === "PayloadTooLarge") {
                    res.status(413).json({ error: "Payload Too Large" });
                    return;
                }
                res.status(400).json({ error: "Invalid JSON" });
            }
        };
        this.use(mw);
    }

    group(prefix: string, callback: (group: RouterGroup) => void) {
        const group = new RouterGroup(prefix, this.router, this.middlewares);
        callback(group);
    }

    private registerRoute(method: HTTPMethod, path: string, handler: Handler, middlewares: Middleware[] = []) {
        // combine global app middleware with route-specific
        const combined = [...this.middlewares, ...middlewares];
        this.router.register(method, path, handler, combined);
    }

    get<P = any, Q = any, B = any>(path: string, handler: Handler<P, Q, B>, ...mw: Middleware[]) {
        this.registerRoute("GET", path, handler as unknown as Handler, mw);
    }
    post<P = any, Q = any, B = any>(path: string, handler: Handler<P, Q, B>, ...mw: Middleware[]) {
        this.registerRoute("POST", path, handler as unknown as Handler, mw);
    }
    put<P = any, Q = any, B = any>(path: string, handler: Handler<P, Q, B>, ...mw: Middleware[]) {
        this.registerRoute("PUT", path, handler as unknown as Handler, mw);
    }
    delete<P = any, Q = any, B = any>(path: string, handler: Handler<P, Q, B>, ...mw: Middleware[]) {
        this.registerRoute("DELETE", path, handler as unknown as Handler, mw);
    }
    patch<P = any, Q = any, B = any>(path: string, handler: Handler<P, Q, B>, ...mw: Middleware[]) {
        this.registerRoute("PATCH", path, handler as unknown as Handler, mw);
    }

    listen(port: number, cb?: () => void) {
        const composed = compose(this.middlewares);

        this.server = http.createServer(async (reqRaw, resBase) => {
            const res = createResponse(resBase);
            const req = reqRaw as Request;
            // init safe fields
            req.params = {} as any;
            req.query = {} as any;
            req.body = {} as any;

            // parse query string into req.query
            try {
                // Ensure we have an absolute URL for the URL parser. Host header fallback.
                const host = req.headers.host ?? "localhost";
                const u = new URL(req.url ?? "/", `http://${host}`);
                const qp: Record<string, string | string[]> = {};
                for (const [k, v] of u.searchParams) {
                    const prev = qp[k];
                    if (prev === undefined) qp[k] = v;
                    else if (Array.isArray(prev)) (prev as string[]).push(v);
                    else qp[k] = [prev as string, v];
                }
                req.query = qp as any;
            } catch {
                req.query = {} as any;
            }

            // run composed global middlewares (they may short-circuit)
            try {
                await composed(req, res);
            } catch (err) {
                // middleware threw — respond if possible
                if (!res.headersSent) {
                    res.status(500).json({ error: (err as Error).message || "Middleware Error" });
                }
                return;
            }

            if (res.writableEnded || res.headersSent) return;

            // Hand off to router (router handles per-route middlewares + handler)
            await this.router.handle(req, res);
        });

        this.server.listen(port, async () => {
            // call plugin onReady hooks
            for (const p of this.plugins) {
                if (p.onReady) {
                    try {
                        await p.onReady({ listen: (p: number, cb?: () => void) => this.listen(p, cb), close: () => this.close() });
                    } catch (err) {
                        console.error("Plugin onReady failed:", (err as Error).message);
                    }
                }
            }
            cb?.();
        });
    }

    /** Graceful close (returns a Promise) */
    async close(): Promise<void> {
        // call plugin onClose hooks first
        for (const p of this.plugins) {
            if (p.onClose) {
                try {
                    await p.onClose({ close: () => this.close() });
                } catch (err) {
                    console.error("Plugin onClose failed:", (err as Error).message);
                }
            }
        }

        if (!this.server) return;
        await new Promise<void>((resolve, reject) => {
            this.server!.close((err) => {
                if (err) return reject(err);
                resolve();
            });
        });
        this.server = undefined;
    }
}
