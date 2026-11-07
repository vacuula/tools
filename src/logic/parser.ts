import type { DataKey } from "./robot";

type ParsedValues = Record<string, string>;

interface BaseDataKeyParser {
    key: string;
    basic?: true;
}
interface CustomDataKeyParser extends BaseDataKeyParser {
    parser: (value: string[]) => ParsedValues;
    name?: never;
}
interface DefaultDataKeyParser extends BaseDataKeyParser {
    name?: string;
    parser?: never;
}
type DataKeyParser = CustomDataKeyParser | DefaultDataKeyParser;

type NamesOf<P> =
    P extends { parser: (v: string[]) => infer R } ? keyof R :
    P extends { name: infer N extends string } ? N :
    P extends { key: infer K extends string } ? K :
    never;

export type ParsedKeys<P extends readonly DataKeyParser[]> = NamesOf<P[number]> & string;

function defineKeys<const P extends readonly DataKeyParser[]>(keys: P): P {
    return keys;
}

export function parseKeys<const P extends readonly DataKeyParser[]>(data: string, keys: P) {
    const basic: DataKey[] = [];
    const advanced: DataKey[] = [];
    const raw: Partial<Record<ParsedKeys<P>, string>> = {};

    data.split('\n').forEach(line => {
        const [stringKey, ...value] = line.split(',');
        const key = keys.find(k => k.key === stringKey);
        if (!key) return;

        const output: ParsedValues = key.parser
            ? key.parser(value)
            : { [key.name ?? key.key]: value[0] };

        Object.assign(raw, output);
        (key.basic ? basic : advanced).push(...Object.entries(output));
    });

    return { lastUpdated: Date.now(), basic, advanced, raw };
}

export function parseGetErr(data: string) {
    const lines = data.split('\n');
    // gen2
    if (lines.length === 2) {
        return { basic: [["Error", lines[1]]] as DataKey[], raw: { Error: lines[1] }, lastUpdated: Date.now() };
    }
    // gen3
    return {
        basic: [["Error", lines[2]], ["Alert", lines[4]]] as DataKey[],
        raw: { Error: lines[2], Alert: lines[4] },
        lastUpdated: Date.now(),
    };
}

export function parseTestmode(data: string) {
    const testmode = data.includes("TestMode: On");
    return {
        basic: [["TestMode", testmode ? 'ON' : 'OFF']] as DataKey[],
        raw: { testmode: testmode ? 'ON' : 'OFF' },
        lastUpdated: Date.now(),
    };
}

export const GetVersionKeys = defineKeys([
    {
        key: 'Model',
        basic: true,
        parser: (v) => ({ Model: v[0], ModelNum: v[1] }),
    },
    {
        key: 'Software',
        basic: true,
        parser: (v) => ({ Software: v.slice(0, 3).join('.') + '-' + v[3] }),
    },
    {
        key: 'MainBoard Serial Number',
        basic: true,
        parser: (v) => ({ 'MFG Code': v[0], 'Serial Number': v[1] }),
    },
]);

export const GetChargerKeys = defineKeys([
    { key: 'FuelPercent', name: 'Fuel Percent', basic: true },
    { key: 'BattTempCAvg', name: 'Average Battery Temperature (C)', basic: true },
    { key: 'VBattV', name: 'Battery Voltage', basic: true },
    { key: 'VExtV', name: 'Charger Voltage', basic: true },
    { key: 'BatteryOverTemp' },
    { key: 'ChargingActive' },
    { key: 'ChargingEnabled' },
    { key: 'ConfidentOnFuel' },
    { key: 'OnReservedFuel' },
    { key: 'BatteryFailure' },
    { key: 'ExtPwrPresent' },
    { key: 'ThermistorPresent' },
    { key: 'Discharge_mAH' },
    { key: 'Charger_mAH' },
]);

export const GetWifistatusKeys = defineKeys([
    { key: 'IPADDR', name: 'IP Address', basic: true },
    { key: 'SSID', name: 'WiFi name', basic: true },
    { key: 'Robot Name' },
    { key: 'Linked to Beehive' },
    { key: 'Nucleo Connected' },
    { key: 'Beehive URL' },
    { key: 'Nucleo URL' },
]);