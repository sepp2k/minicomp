import $ from 'jquery';
import Prism from 'prismjs';
import 'prismjs/components/prism-wasm';
import 'prismjs/themes/prism.css';
import CM from 'codemirror';
import 'codemirror/lib/codemirror.css';
import 'codemirror/addon/edit/matchbrackets';
import './minilang-codemirror-mode';
import WasmCompiler from '../js/WasmCompiler';
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
        element.removeAttr("title");
    }
}

const stdlib = {
    print(i) {
        $('#output').append(i + "<br>");
    },
    read() {
        return prompt("Please enter a number");
    }
};

$(document).ready(() => {
    const editor = CM.fromTextArea($('#source')[0], {
        lineNumbers: true,
        autofocus: true,
        matchBracket: true,
        mode: "text/x-minilang",
        gutters: ["errors"]
    });
    let wasm;
    $('#compileButton').click(() => {
        clearErrors();
        $('#output').text("");
        const src = editor.getValue();
        const result = WasmCompiler.compile(src);
        if (result.hasErrors) {
            $('#compilationResult').css('display', 'none');
            let errorID = 0;
            for(const error of result.errors) {
                $('#errors').append(error + "<br>");
                errorID++;
                markers.push(editor.markText(
                    {line: error.line-1, ch: error.startColumn},
                    {line: error.line-1, ch: error.endColumn},
                    {className: 'error-marker error-marker-' + errorID}
                ));
                $('.error-marker-'+errorID).attr("title", error.message);
            }
            return;
        }
        wasm = result.generatedCode;
        const wat = result.generatedText;
        $('#assembly').text(wat.replace(/\s+\)/g, ")"));
        Prism.highlightElement($('#assembly')[0]);
        $('#compilationResult').css('display', 'block');
    });
    $('#runButton').click(() => {
        $('#output').text("");
        WebAssembly.instantiate(wasm, {stdlib: stdlib}).then(prog => {
            prog.instance.exports.main();
        });
    });
});