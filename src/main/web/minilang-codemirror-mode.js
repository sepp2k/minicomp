import CodeMirror from 'codemirror';
import 'codemirror/addon/mode/simple';

CodeMirror.defineSimpleMode("minilang", {
  start: [
    {regex: /(?:if|then|else|end|for|to|by|do|while|print)\b/, token: "keyword"},
    {regex: /read/, token: "atom"},
    {regex: /[-+]?\d+/, token: "number"},
    {regex: /#.*/, token: "comment"},
    {regex: /:=|\+|-|\*|\/|&|\||\^|<<|>>|<|>|<=|>=|==|!=/, token: "def"},
    {regex: /[a-zA-Z_]\w*/, token: "variable"}
  ]
});

CodeMirror.defineMIME("text/x-minilang", "minilang");
