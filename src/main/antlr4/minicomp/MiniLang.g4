grammar MiniLang;

prog: body=stat* EOF;

stat: 'print' exp ';' # PrintStatement
    | 'read' ID ';' # ReadStatement
    | 'if' cond=exp 'then' thenCase+=stat* ('else' elseCase+=stat*)? 'end' # IfStatement
    | 'while' cond=exp 'do' body+=stat* 'end' # WhileLoop
    | 'for' ID '=' start=exp 'to' end=exp ('by' step=exp)? 'do' body+=stat* 'end' # ForLoop
    | ID '=' exp ';' # Assignment
    ;

exp: ID # VariableExpression
   | INT # IntegerExpression
   | '(' exp ')' # ParenthesizedExpression
   | op=('+'|'-'|'!') exp # UnaryExpression
   | lhs=exp op=('*'|'/'|'%') rhs=exp # MultiplicativeExpression
   | lhs=exp op=('+'|'-') rhs=exp # AdditiveExpression
   | lhs=exp op=('=='|'!='|'>'|'>='|'<'|'<=') rhs=exp # Comparison
   | lhs=exp '&&' rhs=exp # AndExpression
   | lhs=exp '||' rhs=exp # OrExpression
   ;

ID: [a-zA-Z_][a-zA-Z_0-9]*;
INT: [0-9]+;
WS: [ \r\t\n]+ -> skip;