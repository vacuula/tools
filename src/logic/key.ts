function rc4_ksa(S: number[], key: number[]) {
    for (let i = 0; i < 256; i++) S[i] = i;

    let j = 0;
    for (let i = 0; i < 256; i++) {
        j = (j + S[i] + key[i % key.length]) & 0xFF;
        [S[i], S[j]] = [S[j], S[i]];
    }
}

function rc4_prga(S: number[], len: number) {
    let out = new Array(len);
    let i = 0, j = 0;

    for (let k = 0; k < len; k++) {
        i = (i + 1) & 0xFF;
        j = (j + S[i]) & 0xFF;
        [S[i], S[j]] = [S[j], S[i]];
        out[k] = S[(S[i] + S[j]) & 0xFF];
    }
    return out;
}

function stringToBytes(str: string) {
    return [...str].map(c => c.charCodeAt(0));
}

function byteToHex(b: number) {
    return b.toString(16).padStart(2, '0');
}

export function getRobotKey(mac: string, key = "h6CX\t\t:<*{Y") {
    let S = new Array(256);
    let keyBytes = stringToBytes(key);
    rc4_ksa(S, keyBytes);

    let stream = rc4_prga(S, 256);
    let macBytes = stringToBytes(mac);

    let result = "";

    // equivalent to snprintf("%02x", ...)
    for (let i = 0; i < macBytes.length; i++) {
        result += byteToHex(stream[i] ^ macBytes[i]);
    }

    let extraChar = result.charAt(macBytes.length >> 1);
    result += extraChar;

    return result
}