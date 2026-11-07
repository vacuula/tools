import { updateRobotStore } from "./connect";
import { getRobotKey } from "./key";
import { type ParsedKeys, GetChargerKeys, GetVersionKeys, GetWifistatusKeys, parseGetErr, parseKeys, parseTestmode } from "./parser";


export interface VersionData {
    model?: string;
    modelNum?: string;
    software?: string;
    serial?: string;
    mfgCode?: string;
}

export type DataKey = [string, string];
export interface DataKeyData<K extends string = string> {
    basic: DataKey[];
    advanced?: DataKey[];
    raw: Partial<Record<K, string>>;
    command: string;
    lastUpdated: number;
}


export class Robot {
    serialConnection: SerialPort;
    pendingCommands = new Map<string, (result: string) => void>()

    private dataReader?: ReadableStreamDefaultReader<Uint8Array>;
    private rawTransfer = false;

    version: DataKeyData<ParsedKeys<typeof GetVersionKeys>> = { basic: [], advanced: [], raw: {}, command: 'GetVersion', lastUpdated: 0 };
    charger: DataKeyData<ParsedKeys<typeof GetChargerKeys>> = { basic: [], advanced: [], raw: {}, command: 'GetCharger', lastUpdated: 0 };
    wifistatus: DataKeyData<ParsedKeys<typeof GetWifistatusKeys>> = { basic: [], advanced: [], raw: {}, command: 'GetWifiStatus', lastUpdated: 0 };
    error: DataKeyData<'Error' | 'Alert'> = { basic: [], advanced: [], raw: {}, command: 'GetErr', lastUpdated: 0 };
    testmode: DataKeyData<'testmode'> = { basic: [], advanced: [], raw: {}, command: 'TestMode', lastUpdated: 0 };

    get serial() {
        return this.version.raw["Serial Number"]
    }

    get name() {
        return this.wifistatus.raw["Robot Name"]
    }

    get installedUsing() {
        return this.name?.split('--IV--')?.[1]
    }

    get canDoAdvancedCommands() {
        return this.installedUsing && isRobotAtLeast(this.installedUsing, "1.1.1-b3")
    }

    get testMode() {
        return this.testmode.raw.testmode === "ON" ? true : false;
    }

    constructor(serialConnection: SerialPort) {
        this.serialConnection = serialConnection;

        this.startDataRead();
        this.startWriteData();

        this.sendCommand('GetVersion');
        this.sendCommand('GetCharger');
        this.sendCommand('GetErr');
        this.sendCommand('GetWifiStatus');
        this.sendCommand('TestMode');
        this.startGetErrLoop();
    }

    slog = "";

    readSlog() {
        const skey = getRobotKey(this.version.basic[1][1]);

        const loop = () => {
            this.sendCommand2(`GetWifis sloginfo skey ${skey}`, (logData) => {
                this.slog += logData;

                this.sendCommand2(`GetWifis sloginfo clear 1 skey ${skey}`, (logCleared) => {
                    if (logCleared.includes("===== copy sloginfo to /emmc and clear it ======")) {
                        // good fetch log again after some time
                        setTimeout(loop, 2000)
                    }
                    else {
                        console.error("Failed to clear log!")
                    }
                })
            })
        }

        loop()
    }


    readBuffer: Uint8Array = new Uint8Array();
    async startDataRead() {
        while (this.serialConnection.readable && !this.rawTransfer) {
            const reader = this.serialConnection.readable.getReader();
            this.dataReader = reader;

            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    if (!value) continue;

                    this.emitSerialData(value);

                    this.readBuffer = new Uint8Array([
                        ...this.readBuffer,
                        ...value
                    ]);

                    if (value.includes(0x1A)) {
                        const parts = new TextDecoder()
                            .decode(this.readBuffer)
                            .split('\x1A');

                        const lastPart = parts.pop();

                        parts.forEach(part => this.parseData(part));

                        this.readBuffer = new TextEncoder()
                            .encode(lastPart ?? "");
                    }
                }
            } catch (error) {
                console.error(error);
            } finally {
                reader.releaseLock();
                this.dataReader = undefined;
            }
        }
    }


    parseData(data: string) {
        const cmd = data.split('\n')[0].trim();
        const callback = this.pendingCommands.get(cmd);
        if (callback) {
            this.pendingCommands.delete(cmd)
            callback(data)

        }

        // TODO: change this to new callback system
        if (data.includes('Component,Major,Minor,Build,Aux')) this.version = { ...this.version, ...parseKeys(data, GetVersionKeys) };
        else if (data.includes('Label,Value') && data.includes('BattTempCAvg')) this.charger = { ...this.charger, ...parseKeys(data, GetChargerKeys) };
        else if (data.startsWith('GetWifiStatus')) this.wifistatus = { ...this.wifistatus, ...parseKeys(data, GetWifistatusKeys) };
        else if (data.startsWith('GetErr')) this.error = { ...this.error, ...parseGetErr(data) };
        else if (data.startsWith('TestMode')) this.testmode = { ...this.testmode, ...parseTestmode(data) };
        updateRobotStore();
    }

    cmdQueue: string[] = [];
    writeTimer?: number;
    serialWriter?: WritableStreamDefaultWriter;
    async startWriteData() {
        if (!this.serialConnection.writable) {
            console.error('Serial connection not writable');
            return;
        }

        if (this.writeTimer) {
            this.stopWriteData();
            return;
        };

        this.serialWriter = this.serialConnection.writable.getWriter();
        this.writeTimer = setInterval(() => {
            if (this.cmdQueue.length === 0) return;
            if (!this.serialWriter) {
                console.error('Serial writer not available');
                this.stopWriteData();
                return;
            }
            const cmd = this.cmdQueue.shift()!;
            console.log('Sending command:', cmd);
            this.serialWriter.write(new TextEncoder().encode(cmd));
        }, 100);
    }

    async stopWriteData() {
        if (this.writeTimer) {
            clearInterval(this.writeTimer);
            this.writeTimer = undefined;
        }

        if (this.serialWriter) {
            await this.serialWriter.ready;
            this.serialWriter.releaseLock();
            this.serialWriter = undefined;
        }
    }

    async sendCommand(command: string) {
        this.cmdQueue.push(command + '\n');
    }

    sendCommand2(command: string, callback: (result: string) => void) {
        this.pendingCommands.set(command, callback);
        this.cmdQueue.push(command + '\n');
    }

    getErrLoopTimer?: number;
    startGetErrLoop() {
        if (this.getErrLoopTimer) {
            this.stopGetErrLoop();
            return;
        }
        this.getErrLoopTimer = setInterval(() => {
            this.sendCommand('GetErr');
        }, 2000);
    }

    stopGetErrLoop() {
        if (this.getErrLoopTimer) {
            clearInterval(this.getErrLoopTimer);
            this.getErrLoopTimer = undefined;
        }
    }

    async beginRawTransfer() {
        this.rawTransfer = true;

        // Stop background robot commands.
        this.stopGetErrLoop();
        this.cmdQueue = [];

        // Release existing writer.
        await this.stopWriteData();

        // Cancel existing text reader.
        if (this.dataReader) {
            await this.dataReader.cancel();
        }

        // Acquire exclusive binary reader/writer.
        if (!this.serialConnection.readable ||
            !this.serialConnection.writable) {
            throw new Error("Serial connection unavailable");
        }

        return {
            reader: this.serialConnection.readable.getReader(),
            writer: this.serialConnection.writable.getWriter()
        };
    }

    async endRawTransfer() {
        this.rawTransfer = false;

        // Resume normal robot communication.
        this.startDataRead();
        this.startWriteData();
        // this.startGetErrLoop();
    }


    serialDataListeners = new Set<SerialDataListener>();

    subscribeSerialData(callback: SerialDataListener): () => void {
        this.serialDataListeners.add(callback);

        // Return unsubscribe function.
        return () => {
            this.serialDataListeners.delete(callback);
        };
    }

    private emitSerialData(data: Uint8Array) {
        for (const listener of this.serialDataListeners) {
            listener(data);
        }
    }

}

type SerialDataListener = (data: Uint8Array) => void;


// TODO clean this when doing firmware install section!
import { uploadNeatoBlast } from "./neato_blast";
import { isRobotAtLeast } from "./version";

export function textToFile(
    text: string,
    filename: string,
    mimeType = "text/plain"
): File {
    const blob = new Blob([text], { type: mimeType });
    return new File([blob], filename, { type: mimeType });
}



export async function uploadFirmware(robot: Robot, file: File) {
    const success = await uploadNeatoBlast(
        robot,
        file,
        {
            kind: "Tarball",
        },
        {
            onProgress: ({ sent, total, fraction }) => {
                console.log(
                    `Progress: ${(fraction * 100).toFixed(1)}%`,
                    sent,
                    total
                );
            },

            onStatus: status => {
                console.log("BLAST:", status);
            },

            onLog: message => {
                console.log("[NEATO BLAST]", message);
            }
        }
    );

    console.log("Upload result:", success);
}

