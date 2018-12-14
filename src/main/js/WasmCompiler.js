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

class WasmCompiler extends MiniLangVisitor {
    constructor() {
        super();
        this.errors = [];
        this.module = new Binaryen.Module();
        this.variableIndices = {};
        this.variableTypes = [];
        this.nextVariableIndex = 0;
        this.nextLabelIndex = 0;
    }

    addVariable(name) {
        this.variableIndices[name] = this.nextVariableIndex++;
        this.variableTypes.push(Binaryen.i32);
    }

    createTemporary() {
        this.variableTypes.push(Binaryen.i32);
        return this.nextVariableIndex++;
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

    freshLabel() {
        return "l" + this.nextLabelIndex++;
    }

    static compile(source) {
        const input = antlr4.CharStreams.fromString(source);
        const lexer = new MiniLangLexer(input);
        const tokens = new antlr4.CommonTokenStream(lexer);
        const parser = new MiniLangParser(tokens);
        const compiler = new WasmCompiler();
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
        const printType = this.module.addFunctionType('voidIntFun', Binaryen.void, [Binaryen.i32]);
        this.module.addFunctionImport("print", "stdlib", "print", printType);
        const readType = this.module.addFunctionType('intFun', Binaryen.i32, []);
        this.module.addFunctionImport("read", "stdlib", "read", readType);

        const body = this.visitBlock(prog.body);

        const mainType = this.module.addFunctionType('voidFun', Binaryen.void, []);
        this.module.addFunction("main", mainType, this.variableTypes, body);
        this.module.addFunctionExport("main", "main");
        this.generatedCode = this.module.emitBinary();
        this.generatedText = this.module.emitText();
        this.module.dispose();
    }

    visitBlock(statements) {
        const stats = statements.map(statement => this.visit(statement));
        return this.module.block(null, stats);
    }

    visitAssignment(assignment) {
        const index = this.variableIndices[assignment.ID().getText()];
        const value = this.visit(assignment.exp());
        return this.module.setLocal(index, value);
    }

    visitParenthesizedExpression(exp) {
        return this.visit(exp.exp());
    }

    visitVariableExpression(variable) {
        const name = variable.ID().getText();
        const index = this.variableIndices[name];
        if(index === undefined) {
            this.error(variable.start, "Undefined variable: " + name);
        }
        return this.module.getLocal(index, Binaryen.i32);
    }

    visitIntegerExpression(int) {
        return this.module.i32.const(parseInt(int.INT().getText()));
    }

    visitPrintStatement(stat) {
        const arg = this.visit(stat.exp());
        return this.module.call("print", [arg], Binaryen.void);
    }

    visitReadExpression() {
        return this.module.call("read", [], Binaryen.i32);
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

    visitUnaryExpression(exp) {
        const arg = this.visit(exp.exp());
        switch(exp.op.text) {
            case '+': return arg;
            case '-': return this.module.i32.sub(this.module.i32.const(0), arg);
            case '!': return this.module.i32.eq(this.module.i32.const(0), arg);
        }
    }

    visitIfStatement(stat) {
        const cond = this.visit(stat.cond);
        const thenBlock = this.visitBlock(stat.thenCase);
        if (stat.elseCase === undefined) {
            return this.module.if(cond, thenBlock);
        } else {
            const elseBlock = this.visitBlock(stat.elseCase);
            return this.module.if(cond, thenBlock, elseBlock);
        }
    }

    visitLogicalExpression(exp, and) {
        const lhs = this.visit(exp.lhs);
        const rhs = this.visit(exp.rhs);
        // Store the value of the left operand in a temporary variable, so it's only calculated once
        const lhsIndex = this.createTemporary();
        const storeLhs = this.module.setLocal(lhsIndex, lhs);
        const readLhs = this.module.getLocal(lhsIndex, Binaryen.i32);
        const ifStatement = and ? this.module.if(readLhs, rhs, readLhs) : this.module.if(readLhs, readLhs, rhs);
        return this.module.block(null, [storeLhs, ifStatement], Binaryen.i32);
    }

    visitAndExpression(exp) {
        return this.visitLogicalExpression(exp, true);
    }

    visitOrExpression(exp) {
        return this.visitLogicalExpression(exp, false);
    }

    visitLoop(cond, body) {
        const loopLabel = this.freshLabel();
        const endLabel = this.freshLabel();
        const exitCondition = this.module.i32.eq(this.module.i32.const(0), cond);
        return this.module.loop(loopLabel, this.module.block(endLabel, [
            this.module.br_if(endLabel, exitCondition),
            body,
            this.module.br(loopLabel)
        ]));
    }

    visitWhileLoop(loop) {
        return this.visitLoop(this.visit(loop.cond), this.visitBlock(loop.body));
    }

    visitForLoop(loop) {
        const loopVariableIndex = this.variableIndices[loop.ID().getText()];
        const initLoopVariable = this.module.setLocal(loopVariableIndex, this.visit(loop.start));
        const readLoopVariable = this.module.getLocal(loopVariableIndex, Binaryen.i32);
        const endVariableIndex = this.createTemporary();
        const initEndVariable = this.module.setLocal(endVariableIndex, this.visit(loop.end));
        const readEndVariable = this.module.getLocal(endVariableIndex, Binaryen.i32);
        const stepVariableIndex = this.createTemporary();
        const step = loop.step ? this.visit(loop.step) : this.module.i32.const(1);
        const initStepVariable = this.module.setLocal(stepVariableIndex, step);
        const readStepVariable = this.module.getLocal(stepVariableIndex, Binaryen.i32);
        const cond = this.module.i32.le_s(readLoopVariable, readEndVariable);
        const body = this.module.block(null, [
            this.visitBlock(loop.body),
            this.module.setLocal(loopVariableIndex, this.module.i32.add(readLoopVariable, readStepVariable))
        ]);
        return this.module.block(null, [
            initLoopVariable,
            initEndVariable,
            initStepVariable,
            this.visitLoop(cond, body)
        ]);
    }
}

exports.compile = (source) => WasmCompiler.compile(source);