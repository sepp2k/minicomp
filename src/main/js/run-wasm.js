const process = require('process');
const fs = require('fs');
const slurpStdin = require('./util.js').slurpStdin;

const buf = fs.readFileSync(process.argv[2]);

// Note that all input will be read before the application actually starts running because Node.JS
// does not support synchronously reading from stdin (and our language does not support asynchronous
// input).
slurpStdin().then(input => {
    // This will put a NaN at the end of the array if the input ends with a newline or other whitespace,
    // but we don't care because reading more elements from the input than the input contained integers
    // invokes UB anyway. Same applies if the input contains non-integers.
    const ints = input.split(/\s/).map(i => parseInt(i));
    let readIndex = 0;
    const stdlib = {
        read() {
            return ints[readIndex++];
        },
        print(i) {
            console.log(i);
        }
    };
    WebAssembly.instantiate(new Uint8Array(buf), {stdlib: stdlib}).then(result => {
        result.instance.exports.main();
    }).catch(e => {
        console.error(e);
    });
});