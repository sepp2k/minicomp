package minicomp;

import java.io.IOException;
import org.antlr.v4.runtime.*;

public class Main {
    private static void usage() {
        System.err.println("Usage: java -jar minicomp.jar {--llvm|--jvm} [sourcefile.minilang]");
        System.exit(1);
    }

    public static void main(String[] args) {
        try {
            CharStream input;
            if (args.length == 1) {
                input = CharStreams.fromStream(System.in);
            } else if (args.length == 2) {
                input = CharStreams.fromFileName(args[1]);
            } else {
                usage();
                return;
            }
            Compiler compiler;
            if (args[0].equals("--llvm")) {
                compiler = new LlvmCompiler();
            } else if (args[0].equals("--jvm")) {
                compiler = new JavaBytecodeCompiler();
            } else {
                usage();
                return;
            }
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