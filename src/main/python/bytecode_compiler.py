import antlr4
import byteasm
import marshal
import dis
import importlib.util
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
PYC_HEADER = importlib.util.MAGIC_NUMBER + b'\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00'

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
        self.fb.emit_pop_top()

    def visitIntegerExpression(self, exp):
        self.fb.emit_load_const(int(exp.INT().getText()))

    def visitReadExpression(self, read):
        self.fb.emit_load_global("int")
        self.fb.emit_load_global("input")
        self.fb.emit_call_function(0)
        self.fb.emit_call_function(1)

    def visitVariableExpression(self, var):
        name = var.ID().getText()
        if name not in self.variables:
            self.error(var.start.line, var.start.column, 'Undefined variable: {}'.format(name))
        self.fb.emit_load_fast(name)

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

    def visitIfStatement(self, exp):
        end_label = self.fb.make_label()
        else_label = self.fb.make_label() if exp.elseCase else end_label
        self.visit(exp.cond)
        self.fb.emit_pop_jump_if_false(else_label)
        self.visit_block(exp.thenCase)
        self.fb.emit_jump_absolute(end_label)
        if exp.elseCase:
            self.fb.emit_label(else_label)
            self.visit_block(exp.elseCase)
        self.fb.emit_label(end_label)

    def visit_logical_expression(self, exp):
        self.visit(exp.lhs)
        end_label = self.fb.make_label()
        if exp.op.text == '&&':
            self.fb.emit_jump_if_false_or_pop(end_label)
        else:
            self.fb.emit_jump_if_true_or_pop(end_label)
        self.visit(exp.rhs)
        self.fb.emit_label(end_label)

    def visitAndExpression(self, exp):
        self.visit_logical_expression(exp)

    def visitOrExpression(self, exp):
        self.visit_logical_expression(exp)

    def visit_block(self, block):
        for statement in block:
            self.visit(statement)

    def visitWhileLoop(self, loop):
        cond_label = self.fb.make_label()
        end_label = self.fb.make_label()
        self.fb.emit_label(cond_label)
        self.visit(loop.cond)
        self.fb.emit_pop_jump_if_false(end_label)
        self.visit_block(loop.body)
        self.fb.emit_jump_absolute(cond_label)
        self.fb.emit_label(end_label)

    def visitForLoop(self, loop):
        cond_label = self.fb.make_label()
        end_label = self.fb.make_label()
        loop_var = loop.ID().getText()
        self.visit(loop.start)
        self.fb.emit_store_fast(loop_var)
        self.visit(loop.end) # Stack = end
        if loop.step:
            self.visit(loop.step)
        else:
            self.fb.emit_load_const(1)
        # Stack = step, end
        self.fb.emit_rot_two() # Stack = end, step
        self.fb.emit_label(cond_label)
        self.fb.emit_dup_top() # Stack = end, end, step
        self.fb.emit_load_fast(loop_var) # Stack = idx, end, end, step
        self.fb.emit_compare_lt() # Stack = end < idx, end, step
        self.fb.emit_pop_jump_if_true(end_label) # Stack = end, step
        self.visit_block(loop.body)
        self.fb.emit_rot_two() # Stack = step, end
        self.fb.emit_dup_top() # Stack = step, step, end
        self.fb.emit_rot_three() # Stack = step, end, step
        self.fb.emit_load_fast(loop_var) # Stack = idx, step, end, step
        self.fb.emit_binary_add() # Stack = idx+step, end, step
        self.fb.emit_store_fast(loop_var) # Stack = end, step
        self.fb.emit_jump_absolute(cond_label)
        self.fb.emit_label(end_label)
        self.fb.emit_pop_top()
        self.fb.emit_pop_top()

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