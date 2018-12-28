const process = require('process');
const fs = require('fs');
const onEachLine = require('./util').onEachLine;

const buf = fs.readFileSync(process.argv[2]);

const stdlib = {
    print(i) {
        console.log(i);
    }
};
WebAssembly.instantiate(new Uint8Array(buf), {stdlib: stdlib}).then(result => {
    let nextLabel = 0;
    function run() {
        nextLabel = result.instance.exports.main(nextLabel);
        if (nextLabel < 0) {
            process.exit();
        }
    }
    run();
    onEachLine(input => {
        result.instance.exports.setReadValue(parseInt(input));
        run();
    });
}).catch(e => {
    console.error(e);
});