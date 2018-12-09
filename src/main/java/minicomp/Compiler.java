package minicomp;

import java.util.*;
import org.antlr.v4.runtime.*;
import org.antlr.v4.runtime.tree.ParseTreeWalker;
import minicomp.MiniLangParser.*;

public interface Compiler {
    public Iterable<String> getErrors();
    public boolean hasErrors();
    public byte[] getGeneratedCode();

    public void compile(CharStream input);

    public static abstract class Base<T> extends MiniLangBaseVisitor<T> implements Compiler {
        private int idCounter = 0;

        protected String makeId() {
            // All generated IDs contain a dollar sign, so that they can't conflict with variable
            // names (which can't contain dollar signs)
            return "$" + idCounter++;
        }

        private List<String> errors = new ArrayList<String>();

        protected void error(int line, int column, String message) {
            errors.add("line " + line + ":" + column + " " + message);
        }

        public Iterable<String> getErrors() { return errors; }

        public boolean hasErrors() { return !errors.isEmpty(); }

        protected abstract void addVariable(String name);

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
            ProgContext prog = parser.prog();
            ParseTreeWalker.DEFAULT.walk(new MiniLangBaseListener() {
                @Override
                public void enterAssignment(AssignmentContext assignment) {
                    addVariable(assignment.ID().getText());
                }
    
                @Override
                public void enterReadStatement(ReadStatementContext read) {
                    addVariable(read.ID().getText());
                }
    
                @Override
                public void enterForLoop(ForLoopContext loop) {
                    addVariable(loop.ID().getText());
                }
            }, prog);
            visit(prog);
        }
    }
}