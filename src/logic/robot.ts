import { updateRobotStore } from "./connect";
import { GetChargerKeys, GetVersionKeys, parseGetErr, parseKeys } from "./parser";


export interface VersionData {
    model?: string;
    modelNum?: string;
    software?: string;
    serial?: string;
    mfgCode?: string;
}

export type DataKey = [string, string];
export interface DataKeyData {
    basic: DataKey[];
    advanced?: DataKey[];
    command: string;
    lastUpdated: number;
}

export class Robot {
    serialConnection: SerialPort;
    version: DataKeyData = { basic: [], advanced: [], command: 'GetVersion', lastUpdated: 0 };
    charger: DataKeyData = { basic: [], advanced: [], command: 'GetCharger', lastUpdated: 0 };
    error: DataKeyData = { basic: [], advanced: [], command: 'GetErr', lastUpdated: 0 };
    

    constructor(serialConnection: SerialPort) {
        this.serialConnection = serialConnection;

        this.startDataRead();
        this.startWriteData();

        this.sendCommand('GetVersion');
        this.sendCommand('GetCharger');
        this.sendCommand('GetErr');
        this.startGetErrLoop();
    }



    readBuffer: Uint8Array = new Uint8Array();
    async startDataRead() {
        while (this.serialConnection.readable) {
            const reader = this.serialConnection.readable.getReader();
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) {
                        // |reader| has been canceled.
                        break;
                    }
                    if (!value) continue;
                    this.readBuffer = new Uint8Array([...this.readBuffer, ...value]);
                    // when value has with \x1A we have a full message, decode and continue buffer for new data
                    if (value.includes(0x1A)) {
                        console.warn('Received message with 0x1A, decoding buffer');
                        const parts = new TextDecoder().decode(this.readBuffer).split('\x1A');
                        const lastPart = parts.pop();

                        parts.forEach(part => {
                            this.parseData(part);
                        });
                        if (lastPart === "") {
                            this.readBuffer = new Uint8Array();
                            continue;
                        }
                        this.readBuffer = new TextEncoder().encode(lastPart);
                    }
                }
            } catch (error) {
                // Handle |error|...
            } finally {
                reader.releaseLock();
            }
        }
    }

    parseData(data: string) {
        console.log('Parsing data:', data);
        if (data.includes('Component,Major,Minor,Build,Aux')) this.version = { ...this.version, ...parseKeys(data, GetVersionKeys) };
        else if (data.includes('Label,Value') && data.includes('BattTempCAvg')) this.charger = { ...this.charger, ...parseKeys(data, GetChargerKeys) };
        else if (data.startsWith('GetErr')) this.error = { ...this.error, ...parseGetErr(data) };
        console.log('Updated robot data:', { version: this.version, charger: this.charger });
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
            await this.serialWriter.close();
            this.serialWriter = undefined;
        }
    }

    async sendCommand(command: string) {
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
}

