package minicomp;

import java.util.*;
import org.antlr.v4.runtime.*;
import minicomp.MiniLangParser.*;

public class LlvmCompiler extends Compiler.Base<String> {
    private static String llvmHeader =
        "@out_fmt = constant [4 x i8] c\"%d\\0A\\00\", align 1\n" +
        "@in_fmt = constant [3 x i8] c\"%d\\00\", align 1\n" +
        "declare i32 @printf(i8*, ...)\n" +
        "declare i32 @scanf(i8*, ...)\n" +
        "define i32 @main() {\n";
    private static String llvmFooter =
        "  ret i32 0\n" +
        "}\n";

    private int idCounter = 0;

    private String makeId() {
        // All generated IDs contain a dollar sign, so that they can't conflict with variable
        // names (which can't contain dollar signs)
        return "$" + idCounter++;
    }

    private StringBuilder llvm = new StringBuilder();

    @Override
    public byte[] getGeneratedCode() { return llvm.toString().getBytes(); }

    private void emitLabel(String name) {
        llvm.append(" " + name + ":\n");
    }

    private void emit(String instr) {
        llvm.append("  " + instr + "\n");
    }

    Set<String> variables = new HashSet<String>();

    @Override
    protected void addVariable(String name) {
        variables.add(name);
    }

    @Override
    public String visitProg(ProgContext prog) {
        llvm.append(llvmHeader);
        for(String var: variables) {
            emit("%" + var + " = alloca i32");
        }
        visitChildren(prog);
        llvm.append(llvmFooter);
        return null;
    }

    @Override
    public String visitAssignment(AssignmentContext assignment) {
        String rhs = visit(assignment.exp());
        emit("store i32 " + rhs + ", i32* %" + assignment.ID().getText());
        return null;
    }

    private String readVar(String name) {
        String register = "%" + makeId();
        emit(register + " = load i32, i32* %" + name);
        return register;
    }

    @Override
    public String visitVariableExpression(VariableExpressionContext var) {
        String name = var.ID().getText();
        if (!variables.contains(name)) {
            error(var.start.getLine(), var.start.getCharPositionInLine(), "Undefined variable: " + name);
        }
        // If the variable was undefined, this will create LLVM code that accesses an undefined
        // register, so the LLVM code will not be valid. Since we already signalled an error,
        // that's fine as we won't output the generated code if there's been an error, so no
        // one is going to see the invalid code.
        return readVar(name);
    }

    @Override
    public String visitIntegerExpression(IntegerExpressionContext exp) {
        return exp.INT().getText();
    }

    static private Map<String, String> operators = new HashMap<>();
    static {
        operators.put("+", "add");
        operators.put("-", "sub");
        operators.put("*", "mul");
        operators.put("/", "sdiv");
        operators.put("%", "srem");
        operators.put("==", "icmp eq");
        operators.put("!=", "icmp ne");
        operators.put(">", "icmp sgt");
        operators.put(">=", "icmp sge");
        operators.put("<=", "icmp sle");
        operators.put("<", "icmp slt");
    }

    private String binOp(Token op, ExpContext lhs, ExpContext rhs) {
        String register = "%" + makeId();
        String opCode = operators.get(op.getText());
        String lhsReg = visit(lhs);
        String rhsReg = visit(rhs);
        emit(register + " = " + opCode + " i32 " + lhsReg + ", " + rhsReg);
        return register;
    }

    @Override
    public String visitAdditiveExpression(AdditiveExpressionContext exp) {
        return binOp(exp.op, exp.lhs, exp.rhs);
    }

    @Override
    public String visitMultiplicativeExpression(MultiplicativeExpressionContext exp) {
        return binOp(exp.op, exp.lhs, exp.rhs);
    }

    @Override
    public String visitUnaryExpression(UnaryExpressionContext ctx) {
        String operand = visit(ctx.exp());
        String operator = ctx.op.getText();
        if (operator.equals("+")) {
            return operand;
        } else {
            String register = "%" + makeId();
            if (operator.equals("-")) {
                emit(register + " = sub i32 0, " + operand);
            } else if (operator.equals("!")) {
                String boolReg = "%" + makeId();
                emit(boolReg + " = icmp eq i32 0, " + operand);
                emit(register + " = zext i1 " + boolReg + " to i32");
            } else {
                throw new IllegalStateException("Unknown unary operator");
            }
            return register;
        }
    }

    @Override
    public String visitParenthesizedExpression(ParenthesizedExpressionContext ctx) {
        return visit(ctx.exp());
    }

    @Override
    public String visitComparison(ComparisonContext exp) {
        String register = "%" + makeId();
        String boolResult = binOp(exp.op, exp.lhs, exp.rhs);
        emit(register + " = zext i1 " + boolResult + " to i32");
        return register;
    }

    @Override
    public String visitPrintStatement(PrintStatementContext stat) {
        String argument = visit(stat.exp());
        emit("call i32 (i8*, ...) @printf(i8* getelementptr inbounds ([4 x i8], [4 x i8]* @out_fmt, i32 0, i32 0), i32 " + argument  + ")");
        return null;
    }

    @Override
    public String visitReadExpression(ReadExpressionContext stat) {
        String tempVar = "%" + makeId();
        emit(tempVar + " = alloca i32");
        emit("call i32 (i8*, ...) @scanf(i8* getelementptr inbounds ([3 x i8], [3 x i8]* @in_fmt, i32 0, i32 0), i32* " + tempVar  + ")");
        String result = "%" + makeId();
        emit(result + " = load i32, i32* "+ tempVar);
        return result;
    }

    private String visitCondition(ExpContext condition) {
        String conditionReg = visit(condition);
        String conditionAsBool = "%" + makeId();
        emit(conditionAsBool + " = icmp ne i32 0, " + conditionReg);
        return conditionAsBool;
    }

    @Override
    public String visitIfStatement(IfStatementContext ifStatement) {
        boolean hasElse = ifStatement.elseCase != null;
        String thenLabel = makeId();
        String endLabel = makeId();
        String elseLabel = hasElse ? makeId() : endLabel;
        String cond = visitCondition(ifStatement.cond);
        emit("br i1 " + cond + ", label %" + thenLabel + ", label %" + elseLabel);
        emitLabel(thenLabel);
        for(StatContext stat: ifStatement.thenCase) {
            visit(stat);
        }
        emit("br label %" + endLabel);
        if(hasElse) {
            emitLabel(elseLabel);
            for(StatContext stat: ifStatement.elseCase) {
                visit(stat);
            }
            emit("br label %" + endLabel);
        }
        emitLabel(endLabel);
        return null;
    }

    @Override
    public String visitWhileLoop(WhileLoopContext loop) {
        String condLabel = makeId();
        String bodyLabel = makeId();
        String endLabel = makeId();
        emit("br label %" + condLabel);
        emitLabel(condLabel);
        String cond = visitCondition(loop.cond);
        emit("br i1 " + cond + ", label %" + bodyLabel + ", label %" + endLabel);
        emitLabel(bodyLabel);
        for(StatContext stat: loop.body) {
            visit(stat);
        }
        emit("br label %" + condLabel);
        emitLabel(endLabel);
        return null;
    }

    @Override
    public String visitForLoop(ForLoopContext loop) {
        String condLabel = makeId();
        String bodyLabel = makeId();
        String endLabel = makeId();
        String start = visit(loop.start);
        String end = visit(loop.end);
        String step = loop.step == null ? "1" : visit(loop.step);
        emit("store i32 " + start + ", i32* %" + loop.ID().getText());
        emit("br label %" + condLabel);
        emitLabel(condLabel);
        String condReg = "%" + makeId();
        String indexReg = readVar(loop.ID().getText());
        emit(condReg + " = icmp sle i32 " + indexReg + ", " + end);
        emit("br i1 " + condReg + ", label %" + bodyLabel + ", label %" + endLabel);
        emitLabel(bodyLabel);
        for(StatContext stat: loop.body) {
            visit(stat);
        }
        String indexReg2 = readVar(loop.ID().getText());
        String incrementedIndexReg = "%" + makeId();
        emit(incrementedIndexReg + " = " + "add i32 " + indexReg2 + ", " + step);
        emit("store i32 " + incrementedIndexReg + ", i32* %" + loop.ID().getText());
        emit("br label %" + condLabel);
        emitLabel(endLabel);
        return null;
    }

    private String visitLogicalExpression(ExpContext lhs, ExpContext rhs, boolean and) {
        String lhsReg = visit(lhs);
        String resultMem = "%" + makeId();
        emit(resultMem + " = alloca i32");
        emit("store i32 " + lhsReg + ", i32* " + resultMem);
        String lhsAsBool = "%" + makeId();
        emit(lhsAsBool + " = icmp ne i32 0, " + lhsReg);
        String rhsLabel = makeId();
        String endLabel = makeId();
        if(and) {
            emit("br i1 " + lhsAsBool + ", label %" + rhsLabel + ", label %" + endLabel);
        } else {
            emit("br i1 " + lhsAsBool + ", label %" + endLabel + ", label %" + rhsLabel);
        }
        emitLabel(rhsLabel);
        String rhsReg = visit(rhs);
        emit("store i32 " + rhsReg + ", i32* " + resultMem);
        emit("br label %" + endLabel);
        emitLabel(endLabel);
        String resultReg = "%" + makeId();
        emit(resultReg + " = load i32, i32* " + resultMem);
        return resultReg;
    }

    @Override
    public String visitAndExpression(AndExpressionContext exp) {
        return visitLogicalExpression(exp.lhs, exp.rhs, true);
    }

    @Override
    public String visitOrExpression(OrExpressionContext exp) {
        return visitLogicalExpression(exp.lhs, exp.rhs, false);
    }
}