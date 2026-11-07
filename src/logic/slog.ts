import { getRobotKey } from "./key";
import { updateRobotStore } from "./connect";
import { textToFile, uploadFirmware, type Robot } from "./robot";


export function builtinSlogRead(robot: Robot) {
    const skey = getRobotKey(robot.version.basic[1][1]);

    const loop = () => {
        robot.sendCommand2(`GetWifis sloginfo skey ${skey}`, (logData) => {
            robot.slog += logData;

            robot.sendCommand2(`GetWifis sloginfo clear 1 skey ${skey}`, (logCleared) => {
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


const ontimelogread = `# [vacuula-tools] one time read of slog
echo "[[vacuula-tools-started]]" > /dev/serusb1

sloginfo | sed 's/^/[[vacuula-tools-sloginfo]] /' > /dev/serusb1


echo "[[vacuula-tools-finished]]" > /dev/serusb1
`;

export function onetimeFullSlogRead(robot: Robot) {

    const unsub = robot.subscribeSerialData((data) => {
        const text = new TextDecoder().decode(data);
        if (text.includes("[[vacuula-tools-started]]")) console.warn("sloginfo started!")
        if (text.includes("[[vacuula-tools-finished]]")) unsub()
        if (text.includes("[[vacuula-tools-sloginfo]]")) {
            robot.slog += text;
            updateRobotStore();
        }
    });

    uploadFirmware(robot, textToFile(ontimelogread, "upload")).then(() => robot.sendCommand('CopyDumps'))
}

const foreverlogread = `# [vacuula-tools] one time read of slog
echo "[[vacuula-tools-started]]" > /dev/serusb1

sloginfo -w | sed 's/^/[[vacuula-tools-sloginfo]] /' > /dev/serusb1
`;

export function foreverFullSlogRead(robot: Robot) {

    const unsub = robot.subscribeSerialData((data) => {
        const text = new TextDecoder().decode(data);
        if (text.includes("[[vacuula-tools-started]]")) console.warn("sloginfo started!")
        if (text.includes("[[vacuula-tools-finished]]")) unsub()
        if (text.includes("[[vacuula-tools-sloginfo]]")) {
            robot.slog += text;
            updateRobotStore();
        }
    });

    uploadFirmware(robot, textToFile(foreverlogread, "upload")).then(() => robot.sendCommand('CopyDumps'))
}
