import antlr4
import byteasm
import marshal
import dis
from MiniLangLexer import MiniLangLexer
from MiniLangParser import MiniLangParser
from MiniLangVisitor import MiniLangVisitor
from MiniLangListener import MiniLangListener

# The first 2 bytes of the header are the magic bytes identifying this as a Python
# bytecode file. The first byte identifies the Python version (3.7.1) and will need to
# be adjusted for other Python versions. The second byte is the same for all versions.
# The header also contains a timestamp, which is used to check whether the .pyc file
# is older than the corresponding .py file and needs to be recompiled. Since there is
# no corresponding .py file in our case, the timestamp does not matter to us and we
# can just set it to 0.
PYC_HEADER = b'\x42\x0d\x0d\x0a\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00'

class ByteCodeCompiler(MiniLangVisitor):
    operators = {
        '+': 'binary_add',
        '-': 'binary_subtract',
        '*': 'binary_multiply',
        '/': 'binary_floor_divide',
        '%': 'binary_modulo',
        '==': 'compare_eq',
        '!=': 'compare_ne',
        '<': 'compare_lt',
        '<=': 'compare_le',
        '>=': 'compare_ge',
        '>': 'compare_gt'
    }

    def __init__(self):
        self.errors = []
        self.variables = []
        self.fb = byteasm.FunctionBuilder()

    def error(self, line: int, column: int, message: str):
        self.errors.append('line {}:{} {}'.format(line, column, message))

    def visitProg(self, prog):
        self.visitChildren(prog)
        self.fb.emit_load_const(None)
        self.fb.emit_return_value()
        f = self.fb.make('f')
        bytecode = dis.Bytecode(f)
        self.generated_text = bytecode.dis()
        self.generated_code = PYC_HEADER + marshal.dumps(bytecode.codeobj)

    def visitPrintStatement(self, stat):
        self.fb.emit_load_global("print")
        self.visit(stat.exp())
        self.fb.emit_call_function(1)

    def visitIntegerExpression(self, exp):
        self.fb.emit_load_const(int(exp.INT().getText()))

    def visitReadExpression(self, read):
        self.fb.emit_load_global("int")
        self.fb.emit_load_global("input")
        self.fb.emit_call_function(0)
        self.fb.emit_call_function(1)

    def visitVariableExpression(self, var):
        name = var.ID().getText()
        if name in self.variables:
            self.fb.emit_load_fast(name)
        else:
            self.error(var.start.line, var.start.column, 'Undefined variable: {}'.format(name))

    def visitAssignment(self, stat):
        self.visit(stat.exp())
        self.fb.emit_store_fast(stat.ID().getText())

    def bin_op(self, exp):
        self.visit(exp.lhs)
        self.visit(exp.rhs)
        getattr(self.fb, 'emit_' + ByteCodeCompiler.operators[exp.op.text])()

    def visitAdditiveExpression(self, exp):
        self.bin_op(exp)

    def visitMultiplicativeExpression(self, exp):
        self.bin_op(exp)

    def visitComparison(self, exp):
        self.fb.emit_load_global('int')
        self.bin_op(exp)
        self.fb.emit_call_function(1)

    def visitUnaryExpression(self, exp):
        if exp.op.text == '+':
            self.visit(exp.exp())
        elif exp.op.text == '-':
            self.visit(exp.exp())
            self.fb.emit_unary_negative()
        elif exp.op.text == '!':
            self.fb.emit_load_global("int")
            self.visit(exp.exp())
            self.fb.emit_unary_not()
            self.fb.emit_call_function(1)

def compile(source: str):
    lexer = MiniLangLexer(source)
    stream = antlr4.CommonTokenStream(lexer)
    parser = MiniLangParser(stream)
    parser.removeErrorListeners()
    compiler = ByteCodeCompiler()
    class ErrorListener(antlr4.error.ErrorListener.ErrorListener):
        def syntaxError(self, recognizer, offendingSymbol, line, column, message, e):
            compiler.error(line, column, message)
    parser.addErrorListener(ErrorListener())
    prog = parser.prog()
    class VariableListener(MiniLangListener):
        def enterAssignment(self, assignment):
            compiler.variables.append(assignment.ID().getText())
        def enterForLoop(self, loop):
            compiler.variables.append(loop.ID().getText())
    antlr4.tree.Tree.ParseTreeWalker.DEFAULT.walk(VariableListener(), prog)
    compiler.visitProg(prog)
    return compiler