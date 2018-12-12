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