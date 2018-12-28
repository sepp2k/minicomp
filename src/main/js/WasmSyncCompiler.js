'use strict';

const Binaryen = require('binaryen');
const WasmBaseCompiler = require('./WasmBaseCompiler').WasmBaseCompiler;

class WasmSyncCompiler extends WasmBaseCompiler {
    constructor() {
        super();
        this.variableIndices = {};
        this.variableTypes = [];
        this.nextVariableIndex = 0;
    }

    addVariable(name) {
        this.variableIndices[name] = this.nextVariableIndex++;
        this.variableTypes.push(Binaryen.i32);
    }

    createTemporary() {
        this.variableTypes.push(Binaryen.i32);
        return this.nextVariableIndex++;
    }

    createMain(prog) {
        const readType = this.module.addFunctionType('intFun', Binaryen.i32, []);
        this.module.addFunctionImport("read", "stdlib", "read", readType);

        const body = this.visitBlock(prog.body);

        const mainType = this.module.addFunctionType('voidFun', Binaryen.void, []);
        this.module.addFunction("main", mainType, this.variableTypes, body);
        this.module.addFunctionExport("main", "main");
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

    visitVariableExpression(variable) {
        const name = variable.ID().getText();
        const index = this.variableIndices[name];
        if(index === undefined) {
            this.error(variable.start, "Undefined variable: " + name);
        }
        return this.module.getLocal(index, Binaryen.i32);
    }

    visitPrintStatement(stat) {
        const arg = this.visit(stat.exp());
        return this.module.call("print", [arg], Binaryen.void);
    }

    visitReadExpression() {
        return this.module.call("read", [], Binaryen.i32);
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
        const exitCondition = this.not(cond);
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

exports.compile = (source) => WasmSyncCompiler.compile(source);