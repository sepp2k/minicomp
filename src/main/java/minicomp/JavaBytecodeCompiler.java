package minicomp;

import java.util.*;
import org.antlr.v4.runtime.*;
import org.objectweb.asm.*;
import static org.objectweb.asm.Opcodes.*;
import minicomp.MiniLangParser.*;

public class JavaBytecodeCompiler extends Compiler.Base<Void> {
    ClassWriter classWriter = new ClassWriter(ClassWriter.COMPUTE_MAXS | ClassWriter.COMPUTE_FRAMES);
    MethodVisitor methodWriter;

    @Override
    public byte[] getGeneratedCode() {
        return classWriter.toByteArray();
    }

    private Map<String, Integer> variableIndices = new HashMap<String, Integer>();

    private static int SCANNER_INDEX = 0;
    private int nextVariableIndex = 1;

    @Override
    protected void addVariable(String name) {
        if(!variableIndices.containsKey(name)) {
            variableIndices.put(name, nextVariableIndex++);
        }
    }

    @Override
    public Void visitProg(ProgContext prog) {
        classWriter.visit(V1_8, ACC_SUPER, "Main", null, "java/lang/Object", null);
        classWriter.visitSource("Main.java", null);
        methodWriter = classWriter.visitMethod(ACC_PUBLIC | ACC_STATIC, "main", "([Ljava/lang/String;)V", null, null);
        methodWriter.visitCode();
        methodWriter.visitTypeInsn(NEW, "java/util/Scanner");
        methodWriter.visitInsn(DUP);
        methodWriter.visitFieldInsn(GETSTATIC, "java/lang/System", "in", "Ljava/io/InputStream;");
        methodWriter.visitMethodInsn(INVOKESPECIAL, "java/util/Scanner", "<init>", "(Ljava/io/InputStream;)V", false);
        methodWriter.visitVarInsn(ASTORE, SCANNER_INDEX);
        visitChildren(prog);
        methodWriter.visitInsn(RETURN);
        methodWriter.visitMaxs(-1, -1);
        methodWriter.visitEnd();
        classWriter.visitEnd();
        return null;
    }

    @Override
    public Void visitAssignment(AssignmentContext assignment) {
        visit(assignment.exp());
        methodWriter.visitVarInsn(ISTORE, variableIndices.get(assignment.ID().getText()));
        return null;
    }

    @Override
    public Void visitVariableExpression(VariableExpressionContext var) {
        String name = var.ID().getText();
        if (variableIndices.containsKey(name)) {
            methodWriter.visitVarInsn(ILOAD, variableIndices.get(name));
        } else {
            error(var.start.getLine(), var.start.getCharPositionInLine(), "Undefined variable: " + name);
        }
        return null;
    }

    @Override
    public Void visitIntegerExpression(IntegerExpressionContext exp) {
        methodWriter.visitLdcInsn(Integer.valueOf(exp.INT().getText()));
        return null;
    }

    static private Map<String, Integer> operators = new HashMap<>();
    static {
        operators.put("+", IADD);
        operators.put("-", ISUB);
        operators.put("*", IMUL);
        operators.put("/", IDIV);
        operators.put("%", IREM);
    }

    private void binOp(Token op, ExpContext lhs, ExpContext rhs) {
        visit(lhs);
        visit(rhs);
        methodWriter.visitInsn(operators.get(op.getText()));
    }

    @Override
    public Void visitAdditiveExpression(AdditiveExpressionContext exp) {
        binOp(exp.op, exp.lhs, exp.rhs);
        return null;
    }

    @Override
    public Void visitMultiplicativeExpression(MultiplicativeExpressionContext exp) {
        binOp(exp.op, exp.lhs, exp.rhs);
        return null;
    }

    @Override
    public Void visitUnaryExpression(UnaryExpressionContext ctx) {
        visit(ctx.exp());
        String operator = ctx.op.getText();
        if (operator.equals("+")) {
            // do nothing
        } else {
            if (operator.equals("-")) {
                methodWriter.visitInsn(INEG);
            } else if (operator.equals("!")) {
                Label falseLabel = new Label();
                Label endLabel = new Label();
                methodWriter.visitJumpInsn(IFEQ, falseLabel);
                methodWriter.visitLdcInsn(0);
                methodWriter.visitJumpInsn(GOTO, endLabel);
                methodWriter.visitLabel(falseLabel);
                methodWriter.visitLdcInsn(1);
                methodWriter.visitLabel(endLabel);
            } else {
                throw new IllegalStateException("Unknown unary operator");
            }
        }
        return null;
    }

    @Override
    public Void visitParenthesizedExpression(ParenthesizedExpressionContext ctx) {
        return visit(ctx.exp());
    }

    private static Map<String, Integer> comparisons = new HashMap<>();
    static {
        comparisons.put("==", IF_ICMPEQ);
        comparisons.put("!=", IF_ICMPNE);
        comparisons.put(">", IF_ICMPGT);
        comparisons.put(">=", IF_ICMPGE);
        comparisons.put("<=", IF_ICMPLE);
        comparisons.put("<", IF_ICMPLT);
    }

    @Override
    public Void visitComparison(ComparisonContext exp) {
        Label trueLabel = new Label();
        Label endLabel = new Label();
        visit(exp.lhs);
        visit(exp.rhs);
        methodWriter.visitJumpInsn(comparisons.get(exp.op.getText()), trueLabel);
        methodWriter.visitLdcInsn(0);
        methodWriter.visitJumpInsn(GOTO, endLabel);
        methodWriter.visitLabel(trueLabel);
        methodWriter.visitLdcInsn(1);
        methodWriter.visitLabel(endLabel);
        return null;
    }

    @Override
    public Void visitPrintStatement(PrintStatementContext stat) {
        methodWriter.visitFieldInsn(GETSTATIC, "java/lang/System", "out", "Ljava/io/PrintStream;");
        visit(stat.exp());
        methodWriter.visitMethodInsn(INVOKEVIRTUAL, "java/io/PrintStream", "println", "(I)V", false);
        return null;
    }

    @Override
    public Void visitReadExpression(ReadExpressionContext read) {
        methodWriter.visitVarInsn(ALOAD, SCANNER_INDEX);
        methodWriter.visitMethodInsn(INVOKEVIRTUAL, "java/util/Scanner", "nextInt", "()I", false);
        return null;
    }

    @Override
    public Void visitIfStatement(IfStatementContext ifStatement) {
        boolean hasElse = ifStatement.elseCase != null;
        Label endLabel = new Label();
        Label elseLabel = hasElse ? new Label() : endLabel;
        visit(ifStatement.cond);
        methodWriter.visitJumpInsn(IFEQ, elseLabel);
        for(StatContext stat: ifStatement.thenCase) {
            visit(stat);
        }
        methodWriter.visitJumpInsn(GOTO, endLabel);
        if(hasElse) {
            methodWriter.visitLabel(elseLabel);
            for(StatContext stat: ifStatement.elseCase) {
                visit(stat);
            }
        }
        methodWriter.visitLabel(endLabel);
        return null;
    }

    @Override
    public Void visitWhileLoop(WhileLoopContext loop) {
        Label condLabel = new Label();
        Label endLabel = new Label();
        methodWriter.visitLabel(condLabel);
        visit(loop.cond);
        methodWriter.visitJumpInsn(IFEQ, endLabel);
        for(StatContext stat: loop.body) {
            visit(stat);
        }
        methodWriter.visitJumpInsn(GOTO, condLabel);
        methodWriter.visitLabel(endLabel);
        return null;
    }

    @Override
    public Void visitForLoop(ForLoopContext loop) {
        Label condLabel = new Label();
        Label endLabel = new Label();
        int loopVar = variableIndices.get(loop.ID().getText());
        visit(loop.start); // Stack = start
        methodWriter.visitInsn(DUP); // start, start
        methodWriter.visitVarInsn(ISTORE, loopVar); // start
        visit(loop.end); // stop, start
        if (loop.step == null) {
            methodWriter.visitLdcInsn(1);  // 1, stop, start
        } else {
            visit(loop.step); // inc, stop, start
        }
        methodWriter.visitInsn(SWAP); // stop, inc, start
        methodWriter.visitInsn(DUP2_X1); // stop, inc, start, stop, inc
        methodWriter.visitInsn(POP2); // start, stop, inc
        methodWriter.visitLabel(condLabel);
        // Entry condition: Stack = index, stop, inc
        methodWriter.visitInsn(SWAP); // stop, index, inc
        methodWriter.visitInsn(DUP_X1); // stop, index, stop, inc
        methodWriter.visitJumpInsn(IF_ICMPGT, endLabel); // stop, inc
        for(StatContext stat: loop.body) {
            visit(stat);
        }
        // stop, inc
        methodWriter.visitInsn(SWAP); // inc, stop
        methodWriter.visitInsn(DUP_X1); // inc, stop, inc
        methodWriter.visitVarInsn(ILOAD, loopVar); // index, inc, stop, inc
        methodWriter.visitInsn(IADD); // index + inc, stop, inc
        methodWriter.visitInsn(DUP); // index + inc, index + inc, stop, inc
        methodWriter.visitVarInsn(ISTORE, loopVar); // index + inc, stop, inc
        methodWriter.visitJumpInsn(GOTO, condLabel);
        methodWriter.visitLabel(endLabel);
        methodWriter.visitInsn(POP2);
        return null;
    }

    private void visitLogicalExpression(ExpContext lhs, ExpContext rhs, int ifOp) {
        Label endLabel = new Label();
        visit(lhs);
        methodWriter.visitInsn(DUP);
        methodWriter.visitJumpInsn(ifOp, endLabel);
        methodWriter.visitInsn(POP);
        visit(rhs);
        methodWriter.visitLabel(endLabel);
    }

    @Override
    public Void visitAndExpression(AndExpressionContext exp) {
        visitLogicalExpression(exp.lhs, exp.rhs, IFEQ);
        return null;
    }

    @Override
    public Void visitOrExpression(OrExpressionContext exp) {
        visitLogicalExpression(exp.lhs, exp.rhs, IFNE);
        return null;
    }
}
