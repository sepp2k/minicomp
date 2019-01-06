'use strict';

const Binaryen = require('binaryen');
const WasmBaseCompiler = require('./WasmBaseCompiler').WasmBaseCompiler;

const LABEL_PARAM_INDEX = 0;
const READ_VALUE_VAR_NAME = "$readValue";

class WasmAsyncCompiler extends WasmBaseCompiler {
    constructor() {
        super(1);
        this.currentBlock = [];
        this.finishedBlocks = [];
        this.addedVariables = {};
    }

    createMain(prog) {
        this.module.addGlobal(READ_VALUE_VAR_NAME, Binaryen.i32, true, this.module.i32.const(0));
        this.module.addFunction('setReadValue', this.voidIntFun, [], this.module.setGlobal(READ_VALUE_VAR_NAME, this.module.getLocal(0, Binaryen.i32)));
        this.module.addFunctionExport('setReadValue', 'setReadValue');

        this.repeatLabel = this.freshLabel();
        const startLabel = this.freshLabel();

        this.visitBlock(prog.body);

        this.newBlock();
        const labels = this.finishedBlocks.map(block => block.label);
        labels.unshift(startLabel);

        let body = this.module.block(startLabel, [
            this.module.switch(labels, startLabel, this.module.getLocal(LABEL_PARAM_INDEX, Binaryen.i32))
        ]);
        for(const block of this.finishedBlocks) {
            block.instructions.unshift(body);
            body = this.module.block(block.label, block.instructions);
        }
        body = this.module.loop(this.repeatLabel, this.module.block(null, [
            body,
            this.module.return(this.module.i32.const(-1))
        ]));

        const mainType = this.module.addFunctionType('intIntFun', Binaryen.i32, [Binaryen.i32]);
        this.module.addFunction("main", mainType, [], body);
        this.module.addFunctionExport("main", "main");
    }

    createTemporary() {
        const tempVar = this.freshID("$temp");
        this.module.addGlobal(tempVar, Binaryen.i32, true, this.module.i32.const(0));
        return tempVar;
    }

    newBlock() {
        this.finishedBlocks.push({label: this.freshLabel(), instructions: this.currentBlock});
        this.currentBlock = [];
    }

    get currentBlockIndex() {
        // The index used to jump to the current block (i.e. setting the label variable to this index
        // will make the switch statement jump to the block that is currently being built).
        // Since finishedBlocks contains all the blocks *before* (but not including) the current one,
        // its length will be the current block's index once the block is pushed. Since the switch statement
        // will contain the switch-block before the blocks in finishedBlocks, this index will actually be
        // the index of the previous block, causing the switch to break out of the block and into the current
        // block.
        return this.finishedBlocks.length;
    }

    generateBranch(block, labelIdx, cond = undefined) {
        block.push(this.module.setLocal(LABEL_PARAM_INDEX, this.module.i32.const(labelIdx), Binaryen.i32));
        block.push(this.module.br(this.repeatLabel, cond));
    }

    addVariable(name) {
        if (!this.addedVariables[name]) {
            this.module.addGlobal(name, Binaryen.i32, true, this.module.i32.const(42));
            this.addedVariables[name] = true;
        }
    }

    visitBlock(statements) {
        for(const statement of statements) {
            this.visit(statement);
        }
    }

    visitAssignment(assignment) {
        const value = this.visit(assignment.exp());
        this.currentBlock.push(this.module.setGlobal(assignment.ID().getText(), value));
    }

    visitVariableExpression(variable) {
        const name = variable.ID().getText();
        if(!this.addedVariables[name]) {
            this.error(variable.start, "Undefined variable: " + name);
        }
        return this.module.getGlobal(name, Binaryen.i32);
    }

    visitPrintStatement(stat) {
        const arg = this.visit(stat.exp());
        this.currentBlock.push(this.module.call("print", [arg], Binaryen.void));
    }

    visitReadExpression() {
        const tempVar = this.createTemporary();
        const nextBlockIndex = this.currentBlockIndex + 1;
        this.currentBlock.push(this.module.return(this.module.i32.const(nextBlockIndex)));
        this.newBlock();
        this.currentBlock.push(this.module.setGlobal(tempVar, this.module.getGlobal(READ_VALUE_VAR_NAME, Binaryen.i32)));
        return this.module.getGlobal(tempVar, Binaryen.i32);
    }

    visitIfStatement(stat) {
        const cond = this.visit(stat.cond);
        const condBlock = this.currentBlock;
        this.newBlock();
        this.visitBlock(stat.thenCase);
        const thenBlock = this.currentBlock;
        this.newBlock();
        const elseCaseIndex = this.currentBlockIndex;
        let indexAfterIf = elseCaseIndex;
        if (stat.elseCase !== undefined) {
            this.visitBlock(stat.elseCase);
            this.newBlock();
            indexAfterIf = this.currentBlockIndex;
            this.generateBranch(thenBlock, indexAfterIf);
        }
        this.generateBranch(condBlock, elseCaseIndex, this.not(cond));
    }

    visitLogicalExpression(exp, and) {
        const lhs = this.visit(exp.lhs);
        const resultVar = this.createTemporary();
        this.currentBlock.push(this.module.setGlobal(resultVar, lhs));
        const lhsBlock = this.currentBlock;
        this.newBlock();
        const rhs = this.visit(exp.rhs);
        this.currentBlock.push(this.module.setGlobal(resultVar, rhs));
        this.newBlock();
        const endIndex = this.currentBlockIndex;
        let cond = this.module.getGlobal(resultVar, Binaryen.i32);
        if (and) {
            cond = this.not(cond);
        }
        this.generateBranch(lhsBlock, endIndex, cond);
        return this.module.getGlobal(resultVar, Binaryen.i32);
    }

    visitAndExpression(exp) {
        return this.visitLogicalExpression(exp, true);
    }

    visitOrExpression(exp) {
        return this.visitLogicalExpression(exp, false);
    }

    visitLoop(generateCond, generateBody) {
        this.newBlock();
        const condBlockIndex = this.currentBlockIndex;
        const cond = generateCond();
        const exitCondition = this.not(cond);
        const condBlock = this.currentBlock;
        this.newBlock();
        generateBody();
        this.generateBranch(this.currentBlock, condBlockIndex);
        this.newBlock();
        this.generateBranch(condBlock, this.currentBlockIndex, exitCondition);
    }

    visitWhileLoop(loop) {
        return this.visitLoop(() => this.visit(loop.cond), () => this.visitBlock(loop.body));
    }

    visitForLoop(loop) {
        const loopVariable = loop.ID().getText();
        const start = this.visit(loop.start);
        this.currentBlock.push(this.module.setGlobal(loopVariable, start));
        const readLoopVariable = this.module.getGlobal(loopVariable, Binaryen.i32);

        const endVariable = this.createTemporary();
        const end = this.visit(loop.end);
        this.currentBlock.push(this.module.setGlobal(endVariable, end));
        const readEndVariable = this.module.getGlobal(endVariable, Binaryen.i32);

        const stepVariable = this.createTemporary();
        const step = loop.step ? this.visit(loop.step) : this.module.i32.const(1);
        this.currentBlock.push(this.module.setGlobal(stepVariable, step));
        const readStepVariable = this.module.getGlobal(stepVariable, Binaryen.i32);

        const cond = this.module.i32.le_s(readLoopVariable, readEndVariable);
        const body = () => {
            this.visitBlock(loop.body);
            this.currentBlock.push(this.module.setGlobal(loopVariable, this.module.i32.add(readLoopVariable, readStepVariable)));
        };
        this.visitLoop(() => cond, body);
    }
}

exports.compile = (source) => WasmAsyncCompiler.compile(source);