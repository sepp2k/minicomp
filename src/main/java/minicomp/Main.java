package minicomp;

import java.io.IOException;
import org.antlr.v4.runtime.*;

public class Main {
    public static void main(String[] args) {
        try {
            CharStream input;
            if (args.length == 0) {
                input = CharStreams.fromStream(System.in);
            } else if (args.length == 1) {
                input = CharStreams.fromFileName(args[0]);
            } else {
                System.err.println("Too many arguments");
                System.exit(1);
                return;
            }
            Compiler compiler = new LlvmCompiler();
            compiler.compile(input);
            if (compiler.hasErrors()) {
                for (String error: compiler.getErrors()) {
                    System.err.println(error);
                }
                System.exit(2);
            } else {
                System.out.write(compiler.getGeneratedCode());
            }
        } catch(IOException e) {
            e.printStackTrace();
            System.exit(3);
        }
    }
}