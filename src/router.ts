import { Request, Response, Handler, Middleware, HTTPMethod } from "./types";
import { compose } from "./middleware";

/**
 * Node of the Radix Tree
 */
class RadixNode {
    segment: string;
    children: Map<string, RadixNode> = new Map();
    paramChild: RadixNode | null = null;
    handler?: Handler;
    middlewares: Middleware[] = [];
    paramName?: string;
    method?: HTTPMethod;

    constructor(segment: string) {
        this.segment = segment;
    }
}

export class Router {
    private trees: { [K in HTTPMethod]?: RadixNode } = {
        GET: new RadixNode(""),
        POST: new RadixNode(""),
        PUT: new RadixNode(""),
        DELETE: new RadixNode(""),
        PATCH: new RadixNode(""),
        HEAD: new RadixNode(""),
        OPTIONS: new RadixNode(""),
    } as any;

    register(method: HTTPMethod, path: string, handler: Handler, middlewares: Middleware[] = []) {
        const segments = this.splitPath(path);
        let node = this.trees[method]!;

        for (const segment of segments) {
            if (segment.startsWith(":")) {
                if (!node.paramChild) {
                    node.paramChild = new RadixNode(segment);
                    node.paramChild.paramName = segment.slice(1);
                }
                node = node.paramChild;
            } else {
                if (!node.children.has(segment)) {
                    node.children.set(segment, new RadixNode(segment));
                }
                node = node.children.get(segment)!;
            }
        }

        node.handler = handler;
        node.middlewares = middlewares;
        node.method = method;
    }

    private splitPath(path: string) {
        return path
            .split("/")
            .filter(Boolean)
            .map((p) => decodeURIComponent(p));
    }

    private find(method: HTTPMethod, path: string): { handler?: Handler; params: any; middlewares: Middleware[] } | null {
        const segments = this.splitPath(path);
        let node = this.trees[method];
        if (!node) return null;
        const params: Record<string, string> = {};

        for (const segment of segments) {
            if (node.children.has(segment)) {
                node = node.children.get(segment)!;
            } else if (node.paramChild) {
                params[node.paramChild.paramName!] = segment;
                node = node.paramChild;
            } else {
                return null;
            }
        }

        if (!node.handler) return null;
        return { handler: node.handler, params, middlewares: node.middlewares };
    }

    async handle(req: Request, res: Response) {
        const method = (req.method ?? "GET") as HTTPMethod;
        const url = req.url ?? "/";
        const found = this.find(method, url);

        if (!found) {
            res.status(404).json({ error: "Not Found" });
            return;
        }

        // attach params
        req.params = found.params;

        // build composed chain: [ ...routeMiddlewares, routeHandlerAsFinalMiddleware ]
        const chainFns: Middleware[] = [
            ...found.middlewares,
            // final "middleware" that simply invokes the handler
            async (r, s, _next) => {
                await Promise.resolve(found.handler!(r, s));
            },
        ];

        const composed = compose(chainFns);

        try {
            await composed(req, res);
        } catch (err) {
            // If middleware or handler threw — respond 500 (if not already ended)
            if (!res.headersSent) {
                res.status(500).json({ error: (err as Error).message || "Internal Server Error" });
            }
        }
    }
}
