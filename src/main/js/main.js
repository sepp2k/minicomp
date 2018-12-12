'use strict';

const process = require('process');
const WasmCompiler = require('./WasmCompiler');
const slurpStdin = require('./util.js').slurpStdin;

slurpStdin().then( source => {
    const result = WasmCompiler.compile(source);
    if (result.hasErrors) {
        for (const error of result.errors) {
            console.error(error);
        }
        process.exit(1);
    }
    process.stdout.write(result.generatedCode);
}).catch(e => {
    console.error(e);
    process.exit(2);
});