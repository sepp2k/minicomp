exports.slurpStdin = () => {
    let str = "";
    return new Promise(resolve => {
        process.stdin.on('data', input => {
            str += input;
        });

        process.stdin.on('end', () => {
            resolve(str);
        });
    });
}

exports.onEachLine = (f) => {
    let buf = "";
    process.stdin.on('data', input => {
        input = input.toString();
        buf += input;
        let idx = buf.indexOf('\n');
        while (idx >= 0) {
            f(buf.substring(0, idx));
            buf = buf.substring(idx+1);
            idx = buf.indexOf('\n');
        }
    });

    process.stdin.on('end', () => {
        if (buf.length > 0) {
            f(buf);
        }
    });
}