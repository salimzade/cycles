import { IncomingMessage } from "http";
import { createBufferWriter } from "./bufferPool";

/** JSON parser — optimized (setEncoding) */
export async function parseJsonFromStream<T = any>(req: IncomingMessage, maxBytes = 1_048_576): Promise<T | null> {
    if (!req || req.method === "GET" || req.method === "HEAD") return null;

    const ct = (req.headers["content-type"] ?? "").toLowerCase();
    if (!ct.includes("application/json")) return null;

    return new Promise((resolve, reject) => {
        let received = 0;
        let text = "";
        req.setEncoding("utf8");

        const onData = (chunk: string) => {
            received += Buffer.byteLength(chunk, "utf8");
            if (received > maxBytes) {
                cleanup();
                req.resume();
                return reject(new Error("PayloadTooLarge"));
            }
            text += chunk;
        };

        const onEnd = () => {
            cleanup();
            if (!text) return resolve(null);
            try {
                resolve(JSON.parse(text));
            } catch {
                resolve(null);
            }
        };

        const onError = (err: Error) => {
            cleanup();
            reject(err);
        };

        const cleanup = () => {
            req.off("data", onData);
            req.off("end", onEnd);
            req.off("error", onError);
        };

        req.on("data", onData);
        req.on("end", onEnd);
        req.on("error", onError);
    });
}

/**
 * Binary parser using BufferWriter (pool-ish).
 * - pre-allocates maxBytes buffer, writes chunks into it
 * - avoids Buffer.concat
 * - returns Buffer slice referencing same memory (no copy)
 */
export async function parseBinaryFromStream(req: IncomingMessage, maxBytes = 10 * 1024 * 1024): Promise<Buffer | null> {
    if (!req || req.method === "GET" || req.method === "HEAD") return null;

    const ct = (req.headers["content-type"] ?? "").toLowerCase();
    // accept typical binary types and multipart
    if (!(ct.includes("multipart/form-data") || ct.includes("application/octet-stream") || ct.includes("image/") || ct.includes("video/"))) {
        return null;
    }

    return new Promise((resolve, reject) => {
        const writer = createBufferWriter(maxBytes);

        const onData = (chunk: Buffer) => {
            try {
                writer.write(chunk);
            } catch (err) {
                cleanup();
                req.resume();
                return reject(new Error("PayloadTooLarge"));
            }
        };

        const onEnd = () => {
            cleanup();
            const out = writer.finish();
            resolve(out);
        };

        const onError = (err: Error) => {
            cleanup();
            reject(err);
        };

        const cleanup = () => {
            req.off("data", onData);
            req.off("end", onEnd);
            req.off("error", onError);
        };

        req.on("data", onData);
        req.on("end", onEnd);
        req.on("error", onError);
    });
}
