export type BlastStatus =
    | "handshake"
    | "sending"
    | "awaiting_ack"
    | "verifying"
    | "rebooting"
    | "done";

export type BlastUploadKind =
    | "code" | "sound" | "LDS" | "Metadata" | "Package"
    | "Tarball" | "Image" | "mainboard";

export interface BlastOptions {
    kind?: BlastUploadKind;
    reboot?: boolean;
    readflash?: boolean;
    noburn?: boolean;
    xmodem?: boolean;
    /** Skip REQ and final ACK/NAK handling. */
    noHandshake?: boolean;
    /** Use 16 KiB ACK-gated blocks instead of one-shot transfer. */
    blastAck?: boolean;
    updateswVerify?: boolean;
    hasMainboardVersion?: boolean;
}

export interface BlastProgress {
    sent: number;
    total: number;
    fraction: number;
}

export interface BlastEvents {
    onProgress?: (progress: BlastProgress) => void;
    onStatus?: (status: BlastStatus) => void;
    onLog?: (message: string) => void;
}

/** The shape supplied by the Robot class in connect.ts after the patch below. */
export interface BlastCapableRobot {
    serialConnection: SerialPort;
    beginRawTransfer(): Promise<{
        reader: ReadableStreamDefaultReader<Uint8Array>;
        writer: WritableStreamDefaultWriter<Uint8Array>;
    }>;
    endRawTransfer(): Promise<void>;
}

const REQ = 0x05;
const ACK = 0x06;
const NAK = 0x15;
const ONESHOT_CHUNK = 1024;
const ONESHOT_DELAY_MS = 3;
const ACK_CHUNK = 512;
const ACK_BLOCK = 16 * 1024;
const ACK_RETRIES = 5;
const ACK_RETRY_DELAY_MS = 1000;
const READ_WINDOW_MS = 100;
const REQ_POLLS = 15;
const FINAL_TIMEOUT_MS = 10_000;
const NO_HANDSHAKE_DELAY_MS = 5000;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function blastChecksum(data: Uint8Array): number {
    let sum = 0;
    for (const byte of data) sum = (sum + byte) >>> 0;
    return sum;
}

export function patchAppSize(data: Uint8Array, appSize: number): Uint8Array {
    if (data.length < 24) {
        throw new Error("cannot replace application size at byte 20: file is shorter than 24 bytes");
    }
    const result = data.slice();
    new DataView(result.buffer, result.byteOffset, result.byteLength).setUint32(20, appSize, true);
    return result;
}

function uint32LE(value: number): Uint8Array {
    const result = new Uint8Array(4);
    new DataView(result.buffer).setUint32(0, value >>> 0, true);
    return result;
}

function join(a: Uint8Array, b: Uint8Array): Uint8Array {
    const result = new Uint8Array(a.length + b.length);
    result.set(a);
    result.set(b, a.length);
    return result;
}

/**
 * Upload through the already-connected Robot instance.
 * The existing Robot's normal polling and command queue are suspended for the
 * duration of the upload and restored afterwards (except after reboot, where
 * the robot/serial link may intentionally disappear).
 */
export async function uploadNeatoBlast(
    robot: BlastCapableRobot,
    file: File | Blob,
    options: BlastOptions = {},
    events: BlastEvents = {},
): Promise<boolean> {
    const kind = options.kind ?? "code";
    const noHandshake = options.noHandshake ?? false;
    const blastAck = options.blastAck ?? false;
    const reboot = options.reboot ?? false;
    const hasMainboardVersion = options.hasMainboardVersion ?? true;

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
    let readTask: Promise<void> | undefined;
    const incoming: Uint8Array[] = [];
    let readError: unknown;
    let finished = false;
    let rawModeStarted = false;

    const log = (message: string) => events.onLog?.(message);
    const status = (value: BlastStatus) => events.onStatus?.(value);
    const progress = (sent: number, total: number) =>
        events.onProgress?.({ sent, total, fraction: total === 0 ? 1 : sent / total });

    // Pull continuously from the serial stream while protocol methods inspect
    // queued bytes. This avoids missing a short ACK between polling windows.
    const startReader = () => {
        readTask = (async () => {
            try {
                while (!finished) {
                    const { value, done } = await reader!.read();
                    if (done) break;
                    if (value?.length) incoming.push(value.slice());
                }
            } catch (error) {
                if (!finished) readError = error;
            }
        })();
    };

    const takeReceived = (): Uint8Array => {
        if (!incoming.length) return new Uint8Array();
        const total = incoming.reduce((n, part) => n + part.length, 0);
        const result = new Uint8Array(total);
        let offset = 0;
        for (const part of incoming.splice(0)) {
            result.set(part, offset);
            offset += part.length;
        }
        return result;
    };

    const receive = async (windowMs = READ_WINDOW_MS): Promise<Uint8Array> => {
        const deadline = Date.now() + windowMs;
        let result = new Uint8Array();
        do {
            if (readError) throw new Error(`Serial read failed: ${String(readError)}`);
            result = join(result, takeReceived());
            if (Date.now() >= deadline) break;
            await sleep(Math.min(5, deadline - Date.now()));
        } while (Date.now() < deadline);
        return join(result, takeReceived());
    };

    const write = async (bytes: Uint8Array) => {
        if (!writer) throw new Error("BLAST writer is not available.");
        await writer.write(bytes);
    };

    const sendCommand = async (command: string) => {
        log(`Command: ${command}`);
        await write(new TextEncoder().encode(`${command}\n`));
    };

    const waitFor = async (byte: number, polls: number): Promise<Uint8Array> => {
        let buffer = new Uint8Array();
        for (let i = 0; i < polls; i++) {
            buffer = join(buffer, await receive(READ_WINDOW_MS));
            if (buffer.includes(byte)) return buffer;
        }
        throw new Error(`Timed out waiting for 0x${byte.toString(16).padStart(2, "0")}.`);
    };

    const sendOneShot = async (data: Uint8Array) => {
        for (let offset = 0; offset < data.length; offset += ONESHOT_CHUNK) {
            const chunk = data.subarray(offset, offset + ONESHOT_CHUNK);
            await write(chunk);
            await sleep(ONESHOT_DELAY_MS);
            progress(offset + chunk.length, data.length);
        }
    };

    const awaitBlockAck = async () => {
        for (let attempt = 0; attempt < ACK_RETRIES; attempt++) {
            const response = await receive(READ_WINDOW_MS);
            if (response.includes(ACK)) return;
            if (response.includes(NAK)) throw new Error("Robot rejected an upload block (NAK).");
            if (attempt + 1 < ACK_RETRIES) await sleep(ACK_RETRY_DELAY_MS);
        }
        throw new Error("Timeout waiting for ACK during block transfer.");
    };

    const sendAckBlocks = async (data: Uint8Array) => {
        let offset = 0;
        let remaining = ACK_BLOCK;
        while (offset < data.length) {
            const count = Math.min(ACK_CHUNK, remaining, data.length - offset);
            await write(data.subarray(offset, offset + count));
            offset += count;
            remaining -= count;
            progress(offset, data.length);
            if (remaining === 0) {
                log(`Waiting for block ACK: ${offset}/${data.length}`);
                await awaitBlockAck();
                remaining = ACK_BLOCK;
            }
        }
    };

    try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const fileSize = bytes.length;
        const fileName = "name" in file ? String(file.name) : "";
        const isEnc = fileName.toLowerCase().endsWith(".enc");
        const announcedSize = kind === "LDS" && !hasMainboardVersion ? fileSize : fileSize + 4;
        const shouldPatch = (kind === "code" || kind === "Tarball") && !isEnc && blastAck;
        const data = shouldPatch ? patchAppSize(bytes, fileSize) : bytes;

        log(`File size: ${fileSize}`);
        log(`Type: ${kind}`);
        const handles = await robot.beginRawTransfer();
        rawModeStarted = true;
        reader = handles.reader;
        writer = handles.writer;
        startReader();

        let command = `Upload ${kind} `;
        if (options.xmodem) command += "xmodem ";
        if (reboot) command += "reboot ";
        if (options.readflash) command += "readflash ";
        if (!options.noburn) command += "burn ";
        command += `size ${announcedSize}`;
        await sendCommand(command);
        await sleep(100);

        if (noHandshake) {
            await sleep(NO_HANDSHAKE_DELAY_MS);
        } else {
            status("handshake");
            const received = await waitFor(REQ, REQ_POLLS);
            log(`Received REQ (${received.length} bytes captured).`);
        }

        status("sending");
        if (blastAck) {
            log(`Using ACK-based ${ACK_BLOCK / 1024} KiB blocks.`);
            await sendAckBlocks(data);
        } else {
            log("Using one-shot file blast.");
            await sendOneShot(data);
        }

        const checksum = blastChecksum(data);
        await write(uint32LE(checksum));
        log(`Checksum: 0x${checksum.toString(16).padStart(8, "0")}`);

        if (noHandshake) {
            await sendCommand("");
            log("Upload bytes sent; success was not confirmed by the robot.");
            status("done");
            return true;
        }

        status("awaiting_ack");
        const deadline = Date.now() + FINAL_TIMEOUT_MS;
        let verdict = new Uint8Array();
        while (Date.now() < deadline) {
            verdict = join(verdict, await receive(READ_WINDOW_MS));
            if (verdict.includes(ACK)) break;
            if (verdict.includes(NAK)) {
                log("Robot reported upload failure (NAK).");
                return false;
            }
        }
        if (!verdict.includes(ACK)) throw new Error("Timeout waiting for final ACK/NAK from robot.");
        log("Upload completed OK.");

        if (options.updateswVerify) {
            status("verifying");
            await sendCommand("updatesw verify");
            const response = await receive(1000);
            log(`Verify response: ${new TextDecoder().decode(response)}`);
        }

        if (reboot) {
            status("rebooting");
            log("Robot reboot requested; waiting 10 seconds.");
            await sleep(10_000);
        }

        status("done");
        return true;
    } finally {
        finished = true;
        try { await reader?.cancel(); } catch { /* serial link may have dropped */ }
        try { await readTask; } catch { /* handled above */ }
        try { reader?.releaseLock(); } catch { /* already released */ }
        try { writer?.releaseLock(); } catch { /* already released */ }
        // Return stream ownership to the existing Robot command/data handlers.
        if (rawModeStarted) await robot.endRawTransfer();
    }
}
