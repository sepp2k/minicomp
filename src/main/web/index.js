import $ from 'jquery';
import Prism from 'prismjs';
import 'prismjs/components/prism-wasm';
import 'prismjs/themes/prism.css';
import CM from 'codemirror';
import 'codemirror/lib/codemirror.css';
import 'codemirror/addon/edit/matchbrackets';
import './minilang-codemirror-mode';
import WasmSyncCompiler from '../js/WasmSyncCompiler';
import WasmAsyncCompiler from '../js/WasmAsyncCompiler';
import './style.css';
import './index.html';

let markers = [];
function clearErrors() {
    for(const marker of markers) {
        marker.clear();
    }
    markers = [];
    $('#errors').text('');
    for(const element of $('.error-marker')) {
        element.removeAttr('title');
    }
}

const stdlib = {
    print(i) {
        $('#output').append(i + '<br>');
    },
    read() {
        return prompt('Please enter a number');
    }
};

$(document).ready(() => {
    const editor = CM.fromTextArea($('#source')[0], {
        lineNumbers: true,
        autofocus: true,
        matchBracket: true,
        mode: 'text/x-minilang',
        gutters: ['errors']
    });
    let wasm;
    let async;

    function compile() {
        clearErrors();
        $('#output').text('');
        const src = editor.getValue();
        const compiler = async ? WasmAsyncCompiler : WasmSyncCompiler;
        const result = compiler.compile(src);
        if (result.hasErrors) {
            $('#compilationResult').css('display', 'none');
            let errorID = 0;
            for(const error of result.errors) {
                $('#errors').append(error + '<br>');
                errorID++;
                markers.push(editor.markText(
                    {line: error.line-1, ch: error.startColumn},
                    {line: error.line-1, ch: error.endColumn},
                    {className: 'error-marker error-marker-' + errorID}
                ));
                $('.error-marker-'+errorID).attr('title', error.message);
            }
            return;
        }
        wasm = result.generatedCode;
        const wat = result.generatedText;
        $('#assembly').text(wat.replace(/\s+\)/g, ")"));
        Prism.highlightElement($('#assembly')[0]);
        $('#compilationResult').css('display', 'block');
    }

    $('#compileSyncButton').click(() => {
        async = false;
        compile();
    });
    $('#compileAsyncButton').click(() => {
        async = true;
        compile();
    });
    let prog;
    let nextLabel = 0;
    function run() {
        nextLabel = prog.instance.exports.main(nextLabel);
        if (nextLabel < 0) {
            $('#input').css('display', 'none');
        }
    }
    $('#input button').click(() => {
        prog.instance.exports.setReadValue(parseInt($('#input input').val()));
        console.log($('#input input').val());
        $('#input input').val(0);
        run();
    });
    $('#runButton').click(() => {
        $('#output').text('');
        WebAssembly.instantiate(wasm, {stdlib: stdlib}).then(result => {
            prog = result;
            if (async) {
                $('#input').css('display', 'block');
                run();
            } else {
                $('#input').css('display', 'none');
                prog.instance.exports.main();
            }
        });
    });
});