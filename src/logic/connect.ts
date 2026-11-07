import { Robot } from "./robot";

let robotConnection: SerialPort;
export let robot: Robot | null = null;

const listeners = new Set<() => void>();
let updateTick = 0;

export const updateRobotStore = () => {
    // Simply bump a tick counter to notify React that internal class state changed
    updateTick++;
    listeners.forEach(listener => listener());
}

export const subscribeToRobot = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export const getRobotUpdateTick = () => updateTick;

export const ConnectionStatus = {
    NotConnected: 'NotConnected',
    Connecting: 'Connecting',
    Connected: 'Connected',
    Error: 'Error'
} as const;


export async function connectToRobot(setStatus: (status: string) => void, filterResults: boolean) {
    setStatus('Select device in browser prompt');
    try {
        robotConnection = await navigator.serial.requestPort({
            filters: filterResults ? [{ usbVendorId: 0x2108 } ] : []
        });
    } catch (e) {
        setStatus('No device selected');
        return;
    }
    setStatus('Opening port...');
    try {
        await robotConnection.open({ baudRate: 115200 });
    } catch (e) {
        setStatus('Error opening port');
        return;
    }
    setStatus('Connected successfully');

    setTimeout(async () => {
        robot = new Robot(robotConnection);
        updateRobotStore();

        // const writer = robotConnection?.writable?.getWriter();
        // await writer?.write(new TextEncoder().encode('GetErr\n'));
        // // writer?.releaseLock();
        // await writer?.write(new TextEncoder().encode('GetVersion\n'));
        // await writer?.write(new TextEncoder().encode('GetWarranty\n'));
        // await writer?.write(new TextEncoder().encode('GetState\n'));
        // await writer?.write(new TextEncoder().encode('GetCharger\n'));
        // // writer?.releaseLock();
        // console.log('Sent GetVersion command');
    }, 200);

}


