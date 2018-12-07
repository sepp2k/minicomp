package minicomp;

import java.util.*;
import org.antlr.v4.runtime.*;
import org.antlr.v4.runtime.tree.ParseTreeWalker;
import minicomp.MiniLangParser.*;

public class Compiler extends MiniLangBaseVisitor<String> {
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
    private Set<String> variables = new HashSet<String>();
    private StringBuilder llvm = new StringBuilder();
    private List<String> errors = new ArrayList<String>();

    private void error(int line, int column, String message) {
        errors.add("line " + line + ":" + column + " " + message);
    }

    private String makeId() {
        // All generated IDs contain a dollar sign, so that they can't conflict with variable
        // names (which can't contain dollar signs)
        return "$" + idCounter++;
    }

    private void emitLabel(String name) {
        llvm.append(" " + name + ":\n");
    }

    private void emit(String instr) {
        llvm.append("  " + instr + "\n");
    }

    public Iterable<String> getErrors() { return errors; }
    public boolean hasErrors() { return !errors.isEmpty(); }
    public String getLLVM() { return llvm.toString(); }

    public void compile(CharStream input) {
        MiniLangLexer lexer = new MiniLangLexer(input);
        TokenStream tokens = new CommonTokenStream(lexer);
        MiniLangParser parser = new MiniLangParser(tokens);
        parser.removeErrorListeners();
        parser.addErrorListener(new BaseErrorListener() {
            @Override
            public void syntaxError(Recognizer<?, ?> recognizer, Object offendingSymbol, int line, int column, String msg, RecognitionException e) {
                error(line, column, msg);
            }
        });
        visit(parser.prog());
    }

    @Override
    public String visitProg(ProgContext prog) {
        llvm.append(llvmHeader);
        ParseTreeWalker.DEFAULT.walk(new MiniLangBaseListener() {
            private void allocateVar(String var) {
                if (!variables.contains(var)) {
                    variables.add(var);
                    emit("%" + var + " = alloca i32");
                }
            }

            @Override
            public void enterAssignment(AssignmentContext assignment) {
                allocateVar(assignment.ID().getText());
            }

            @Override
            public void enterReadStatement(ReadStatementContext read) {
                allocateVar(read.ID().getText());
            }

            @Override
            public void enterForLoop(ForLoopContext loop) {
                allocateVar(loop.ID().getText());
            }
        }, prog);
        visitChildren(prog);
        llvm.append(llvmFooter);
        return null;
    }

    @Override
    public String visitAssignment(AssignmentContext assignment) {
        emit("store i32 " + visit(assignment.exp()) + ", i32* %" + assignment.ID().getText());
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
        emit(register + " = " + opCode + " i32 " + visit(lhs) + ", " + visit(rhs));
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
            String opCode;
            if (operator.equals("-")) {
                opCode = "sub i32 0,";
            } else if (operator.equals("!")) {
                opCode = "xor i32 1,";
            } else {
                throw new IllegalStateException("Unknown unary operator");
            }
            emit(register + " = " + opCode + " " + operand);
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
        emit(register + " = zext i1 " + binOp(exp.op, exp.lhs, exp.rhs) + " to i32");
        return register;
    }

    @Override
    public String visitPrintStatement(PrintStatementContext stat) {
        emit("call i32 (i8*, ...) @printf(i8* getelementptr inbounds ([4 x i8], [4 x i8]* @out_fmt, i32 0, i32 0), i32 " + visit(stat.exp())  + ")");
        return null;
    }

    @Override
    public String visitReadStatement(ReadStatementContext stat) {
        emit("call i32 (i8*, ...) @scanf(i8* getelementptr inbounds ([3 x i8], [3 x i8]* @in_fmt, i32 0, i32 0), i32* %" + stat.ID().getText()  + ")");
        return null;
    }

    private String translateCondition(ExpContext condition) {
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
        emit("br i1 " + translateCondition(ifStatement.cond) + ", label %" + thenLabel + ", label %" + elseLabel);
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
        emit("br i1 " + translateCondition(loop.cond) + ", label %" + bodyLabel + ", label %" + endLabel);
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
}