'use strict';

const Binaryen = require('binaryen');
const MiniLangParser = require('../../../target/generated-sources/antlr4-js/MiniLangParser').MiniLangParser;
const MiniLangLexer = require('../../../target/generated-sources/antlr4-js/MiniLangLexer').MiniLangLexer;
const MiniLangVisitor = require('../../../target/generated-sources/antlr4-js/MiniLangVisitor').MiniLangVisitor;
const MiniLangListener = require('../../../target/generated-sources/antlr4-js/MiniLangListener').MiniLangListener;
const antlr4 = require('antlr4');

const operators = {
    '+': 'add',
    '-': 'sub',
    '*': 'mul',
    '/': 'div_s',
    '%': 'rem_s',
    '==': 'eq',
    '!=': 'ne',
    '<': 'lt_s',
    '<=': 'le_s',
    '>': 'gt_s',
    '>=': 'ge_s'
};

class WasmBaseCompiler extends MiniLangVisitor {
    constructor() {
        super();
        this.errors = [];
        this.module = new Binaryen.Module();
        this.tempCounter = 0;
    }

    error(token, message) {
        // For simplicity we assume that all errors only concern one token as that's all we need
        // We also assume that tokens can't span multiple lines (which they can't in out language)
        this.errors.push({
            line: token.line,
            startColumn: token.column,
            endColumn: token.column + token.text.length,
            message: message,
            toString: () => "line " + token.line + ":" + token.column + " " + message
        });
    }

    get hasErrors() { return this.errors.length > 0; }

    freshID(name) {
        return name + this.tempCounter++;
    }

    freshLabel() {
        return this.freshID("l");
    }

    static compile(source) {
        const input = antlr4.CharStreams.fromString(source);
        const lexer = new MiniLangLexer(input);
        const tokens = new antlr4.CommonTokenStream(lexer);
        const parser = new MiniLangParser(tokens);
        const compiler = new this();
        parser.removeErrorListeners();
        parser.addErrorListener({
            syntaxError(recognizer, offendingSymbol, line, column, msg) {
                compiler.error(offendingSymbol, msg);
            }
        });
        const prog = parser.prog();
        if (compiler.hasErrors) return compiler; // Don't try to generate code when there were syntax errors
        const variableFinder = new MiniLangListener()
        variableFinder.enterAssignment = (assignment) => compiler.addVariable(assignment.ID().getText());
        variableFinder.enterForLoop = (loop) => compiler.addVariable(loop.ID().getText());
        antlr4.tree.ParseTreeWalker.DEFAULT.walk(variableFinder, prog);
        compiler.visit(prog);
        return compiler;
    }

    visitProg(prog) {
        this.voidIntFun = this.module.addFunctionType('voidIntFun', Binaryen.void, [Binaryen.i32]);
        this.module.addFunctionImport("print", "stdlib", "print", this.voidIntFun);

        this.createMain(prog);

        if (!this.hasErrors) {
            this.module.validate();
            this.generatedCode = this.module.emitBinary();
            this.generatedText = this.module.emitText();
        }
        this.module.dispose();
    }

    visitParenthesizedExpression(exp) {
        return this.visit(exp.exp());
    }

    visitIntegerExpression(int) {
        return this.module.i32.const(parseInt(int.INT().getText()));
    }

    visitAdditiveExpression(exp) {
        return this.binOp(exp.op, exp.lhs, exp.rhs);
    }

    visitMultiplicativeExpression(exp) {
        return this.binOp(exp.op, exp.lhs, exp.rhs);
    }

    visitComparison(exp) {
        return this.binOp(exp.op, exp.lhs, exp.rhs);
    }

    binOp(op, lhs, rhs) {
        lhs = this.visit(lhs);
        rhs = this.visit(rhs);
        return this.module.i32[operators[op.text]](lhs, rhs);
    }

    not(arg) {
        return this.module.i32.eq(this.module.i32.const(0), arg);
    }

    visitUnaryExpression(exp) {
        const arg = this.visit(exp.exp());
        switch(exp.op.text) {
            case '+': return arg;
            case '-': return this.module.i32.sub(this.module.i32.const(0), arg);
            case '!': return this.not(arg);
        }
    }
}

exports.WasmBaseCompiler = WasmBaseCompiler;