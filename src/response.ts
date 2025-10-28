import { ServerResponse } from "http";
import { Response } from "./types";

export function createResponse(res: ServerResponse): Response {
    const r = res as Response;

    r.status = function (code: number) {
        this.statusCode = code;
        return this;
    };

    r.json = function (data: unknown) {
        if (!this.headersSent) this.setHeader("Content-Type", "application/json");
        this.end(JSON.stringify(data));
    };

    r.send = function (data: unknown) {
        if (!this.headersSent) {
            if (typeof data === "object" && !Buffer.isBuffer(data)) {
                this.setHeader("Content-Type", "application/json");
                this.end(JSON.stringify(data));
            } else {
                this.end(data as any);
            }
        } else {
            this.end();
        }
    };

    return r;
}
