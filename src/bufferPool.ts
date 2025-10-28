/*** 
 * Simple implementation of BufferPool. 
 * * - Allows you to allocate a buffer of fixed maxSize 
 * * - Write chunks to it by offset 
 * * - At the end, return slice(0, used) — this is a view of the same buffer (without copying) 
 * * 
 * Use with caution: the allocated memory is maxSize. You need to know this in advance (limit). 
 * */

export class BufferWriter {
    private buf: Buffer;
    private offset = 0;
    private closed = false;

    constructor(private maxSize: number) {
        this.buf = Buffer.allocUnsafe(maxSize); // unsafe: faster
    }

    write(chunk: Buffer) {
        if (this.closed) throw new Error("Writer closed");
        const len = chunk.length;
        if (this.offset + len > this.maxSize) throw new Error("OUT_OF_SPACE");
        chunk.copy(this.buf, this.offset);
        this.offset += len;
    }

    finish(): Buffer {
        this.closed = true;
        // slice returns view — no copy
        return this.buf.slice(0, this.offset);
    }

    used(): number {
        return this.offset;
    }
}

/** Helper factory */
export function createBufferWriter(maxSize: number) {
    return new BufferWriter(maxSize);
}
