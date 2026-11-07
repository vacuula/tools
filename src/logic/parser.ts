import type { DataKey } from "./robot";

interface BaseDataKeyParser {
    key: string;
    basic?: true;
}
interface CustomDataKeyParser extends BaseDataKeyParser {
    parser: (value: string[]) => DataKey[];
    name?: string;
}
interface DefaultDataKeyParser extends BaseDataKeyParser {
    name?: string;
    parser?: never;
}
type DataKeyParser = CustomDataKeyParser | DefaultDataKeyParser;

function defaultParser(name: string, value: string[]): DataKey[] {
    return [[name, value[0]]];
}
export function parseKeys(data: string, keys: DataKeyParser[]) {
    const basic: DataKey[] = [];
    const advanced: DataKey[] = [];
    const lines = data.split('\n');
    lines.forEach(line => {
        const [stringKey, ...value] = line.split(',');
        const key = keys.find(k => k.key === stringKey);
        if (!key) return;
        (key.basic ? basic : advanced).push(...(key.parser ? key.parser(value) : defaultParser(key.name || key.key, value)));
    });
    const now = Date.now();

    return {
        lastUpdated: now,
        basic,
        advanced,
    }
}



export function parseGetErr(data: string) {
    const lines = data.split('\n');

    // gen2
    if (lines.length === 2) return { basic: [["Error", lines[1]]] as DataKey[], lastUpdated: Date.now() };
    // gen3
    return { basic: [["Error", lines[2]], ["Alert", lines[4]]] as DataKey[], lastUpdated: Date.now() };
}



export const GetVersionKeys: DataKeyParser[] = [{
    key: 'Model',
    basic: true,
    parser: (value: string[]) => {
        return [
            ['Model', value[0]],
            ['ModelNum', value[1]]
        ];
    }
},
{
    key: 'Software',
    basic: true,
    parser: (value: string[]) => {
        return [
            ['Software', value.slice(0, 3).join(".") + '-' + value[3]]
        ]
    }
},
{
    key: 'MainBoard Serial Number',
    basic: true,
    parser: (value: string[]) => {
        return [
            ['MFG Code', value[0]],
            ['Serial Number', value[1]]
        ]
    }
}];


export const GetChargerKeys: DataKeyParser[] = [
    {
        key: 'FuelPercent',
        name: 'Fuel Percent',
        basic: true,
    },
    {
        key: 'BattTempCAvg',
        basic: true,
        name: 'Average Battery Temperature (C)',
    },
    {
        key: 'VBattV',
        basic: true,
        name: 'Battery Voltage',
    },
    {
        key: 'VExtV',
        basic: true,
        name: 'Charger Voltage',
    },
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
];

