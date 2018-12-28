'use strict';

const process = require('process');
const WasmSyncCompiler = require('./WasmSyncCompiler');
const WasmAsyncCompiler = require('./WasmAsyncCompiler');
const slurpStdin = require('./util.js').slurpStdin;

let compiler;
if (process.argv.length == 3 && process.argv[2] == "--async") {
    compiler = WasmAsyncCompiler;
} else if (process.argv.length == 2) {
    compiler = WasmSyncCompiler;
} else {
    console.error(`Usage: ${process.argv0} [--async]`);
    process.exit(3);
}

slurpStdin().then( source => {
    const result = compiler.compile(source);
    if (result.hasErrors) {
        for (const error of result.errors) {
            console.error(error.toString());
        }
        process.exit(1);
    }
    process.stdout.write(result.generatedCode);
}).catch(e => {
    console.error(e);
    process.exit(2);
});