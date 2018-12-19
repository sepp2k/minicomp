import antlr4
import sys
import os

sys.path.append(os.path.join(os.path.dirname(__file__), '../../../target/generated-sources/antlr4-py'))

import bytecode_compiler

if len(sys.argv) == 2:
    source = antlr4.FileStream(sys.argv[1])
elif len(sys.argv) == 1:
    source = antlr4.InputStream(sys.stdin.read())
else:
    print("Usage: ", sys.argv[0], " [filename.minilang]", file = sys.stderr)
    sys.exit(1)

result = bytecode_compiler.compile(source)
if result.errors:
    for error in result.errors:
        print(error, file = sys.stderr)
    sys.exit(2)
sys.stdout.buffer.write(result.generated_code)