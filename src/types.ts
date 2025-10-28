import { IncomingMessage, ServerResponse } from "http";

/** HTTP methods we support */
export type HTTPMethod =
    | "GET"
    | "POST"
    | "PUT"
    | "DELETE"
    | "PATCH"
    | "HEAD"
    | "OPTIONS";

/** Typed request with generics for params, query, body */
export interface Request<P = Record<string, string>, Q = Record<string, string | string[]>, B = any>
    extends IncomingMessage {
    params: P;
    query: Q;
    body: B;
    // plugin authors can augment this
    [key: string]: any;
}

/** Response helper — extends native ServerResponse */
export interface Response extends ServerResponse {
    json: (data: unknown) => void;
    send: (data: unknown) => void;
    status: (code: number) => Response;
}

/** Handler with generics */
export type Handler<P = any, Q = any, B = any> = (req: Request<P, Q, B>, res: Response) => void | Promise<void>;

/** Middleware signature */
export type Middleware = (req: Request, res: Response, next: () => Promise<void>) => Promise<void> | void;

/**
 * Plugin hooks that a plugin may return.
 * - onReady: called after server starts (useful for background tasks)
 * - onClose: called when server is closed (for cleanup)
 */
export interface PluginHooks {
    onReady?: (app: { listen: (p: number, cb?: () => void) => void; close?: () => Promise<void> }) => void | Promise<void>;
    onClose?: (app: { close?: () => Promise<void> }) => void | Promise<void>;
}

/**
 * Plugin signature:
 * - may return PluginHooks (sync or Promise)
 */
export type Plugin = (app: {
    use: (mw: Middleware) => void;
    register: <P = any, Q = any, B = any>(method: HTTPMethod, path: string, handler: Handler<P, Q, B>) => void;
    // allow plugin to modify app in other ways
    [k: string]: any;
}) => void | PluginHooks | Promise<void | PluginHooks>;
