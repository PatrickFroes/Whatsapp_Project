/**
 * SafeEvaluator.js - Avaliador de expressões seguro para FlowEngine
 *
 * Replaces expr-eval with a whitelist-based evaluator
 * Prevents code injection in user-provided conditional expressions
 *
 * Supported features:
 * - Logical operators: and, or, not
 * - Comparison operators: ==, !=, <, >, <=, >=
 * - Variables: data_xxx format only
 * - Parentheses for grouping
 * - No function calls, property access, or complex operations
 *
 * Examples:
 * - "data_age > 18 and data_status == 'active'"
 * - "data_count >= 5 or data_type == 'premium'"
 * - "not data_deleted"
 */

class SafeEvaluator {
  /**
   * Tokenize expression into safe tokens
   */
  static tokenize(expr) {
    // Whitelist of valid token patterns
    const patterns = {
      WHITESPACE: /^\s+/,
      NUMBER: /^\d+(\.\d+)?/,
      STRING: /^(['"])(?:(?=(\\?))\2.)*?\1/,
      IDENTIFIER: /^[a-zA-Z_][a-zA-Z0-9_]*/,
      OPERATOR: /^(===|!==|==|!=|<=|>=|<|>|&&|\|\||and|or|not|\(|\))/,
      ASSIGNMENT: /^(=|:=|:)/,
      PAREN: /^[()]/
    };

    const tokens = [];
    let pos = 0;
    const input = expr;

    while (pos < input.length) {
      let matched = false;

      for (const [type, pattern] of Object.entries(patterns)) {
        const match = input.substring(pos).match(pattern);
        if (match) {
          const value = match[0];

          // Skip whitespace
          if (type !== 'WHITESPACE') {
            tokens.push({ type, value, pos });
          }

          pos += value.length;
          matched = true;
          break;
        }
      }

      if (!matched) {
        throw new Error(`SafeEvaluator: Invalid character '${input[pos]}' at position ${pos}`);
      }
    }

    return tokens;
  }

  /**
   * Validate expression for safety
   * - No assignment operators
   * - No function calls
   * - Only allowed variables (data_xxx, numbers, strings)
   */
  static validate(tokens) {
    const forbidden = ['ASSIGNMENT'];

    for (const token of tokens) {
      if (forbidden.includes(token.type)) {
        throw new Error(`SafeEvaluator: Assignment operators are not allowed: "${token.value}"`);
      }

      // Check for function-like calls (identifier followed by parenthesis)
      const index = tokens.indexOf(token);
      if (
        token.type === 'IDENTIFIER' &&
        !['and', 'or', 'not'].includes(token.value) &&
        index + 1 < tokens.length &&
        tokens[index + 1].value === '('
      ) {
        throw new Error(`SafeEvaluator: Function calls are not allowed: "${token.value}()"`);
      }

      // Only allow data_xxx variables (prefix protection)
      if (
        token.type === 'IDENTIFIER' &&
        !['and', 'or', 'not'].includes(token.value) &&
        !token.value.startsWith('data_')
      ) {
        throw new Error(
          `SafeEvaluator: Unknown variable "${token.value}". Only data_xxx variables allowed.`
        );
      }
    }
  }

  /**
   * Parse tokenized expression into AST
   */
  static parse(tokens) {
    let pos = 0;

    const peek = () => tokens[pos];
    const consume = () => tokens[pos++];
    const expect = (value) => {
      const token = peek();
      if (!token || token.value !== value) {
        throw new Error(`SafeEvaluator: Expected "${value}" but got "${token?.value}"`);
      }
      return consume();
    };

    const parseExpression = () => parseOr();

    const parseOr = () => {
      let left = parseAnd();

      while (peek() && ['or', '||'].includes(peek().value)) {
        consume();
        const right = parseAnd();
        left = { type: 'BinaryOp', op: 'or', left, right };
      }

      return left;
    };

    const parseAnd = () => {
      let left = parseNot();

      while (peek() && ['and', '&&'].includes(peek().value)) {
        consume();
        const right = parseNot();
        left = { type: 'BinaryOp', op: 'and', left, right };
      }

      return left;
    };

    const parseNot = () => {
      if (peek() && peek().value === 'not') {
        consume();
        const expr = parseComparison();
        return { type: 'UnaryOp', op: 'not', expr };
      }

      return parseComparison();
    };

    const parseComparison = () => {
      let left = parsePrimary();

      const comparisonOps = ['==', '===', '!=', '!==', '<', '>', '<=', '>='];
      while (peek() && comparisonOps.includes(peek().value)) {
        const op = consume().value;
        const right = parsePrimary();
        left = { type: 'BinaryOp', op, left, right };
      }

      return left;
    };

    const parsePrimary = () => {
      const token = peek();

      if (!token) {
        throw new Error('SafeEvaluator: Unexpected end of expression');
      }

      if (token.value === '(') {
        expect('(');
        const expr = parseExpression();
        expect(')');
        return expr;
      }

      if (token.type === 'NUMBER') {
        return {
          type: 'Literal',
          value: parseFloat(consume().value)
        };
      }

      if (token.type === 'STRING') {
        const str = consume().value;
        // Remove quotes
        return {
          type: 'Literal',
          value: str.slice(1, -1)
        };
      }

      if (token.type === 'IDENTIFIER') {
        return {
          type: 'Variable',
          name: consume().value
        };
      }

      throw new Error(`SafeEvaluator: Unexpected token: "${token.value}" at position ${token.pos}`);
    };

    const ast = parseExpression();

    if (pos < tokens.length) {
      throw new Error(`SafeEvaluator: Unexpected token after expression: "${peek().value}"`);
    }

    return ast;
  }

  /**
   * Evaluate AST with provided variables
   */
  static evaluateAST(ast, variables) {
    if (ast.type === 'Literal') {
      return ast.value;
    }

    if (ast.type === 'Variable') {
      if (!(ast.name in variables)) {
        throw new Error(`SafeEvaluator: Undefined variable "${ast.name}"`);
      }
      return variables[ast.name];
    }

    if (ast.type === 'UnaryOp') {
      const expr = SafeEvaluator.evaluateAST(ast.expr, variables);
      if (ast.op === 'not') {
        return !expr;
      }
      throw new Error(`SafeEvaluator: Unknown unary operator: "${ast.op}"`);
    }

    if (ast.type === 'BinaryOp') {
      const left = SafeEvaluator.evaluateAST(ast.left, variables);
      const right = SafeEvaluator.evaluateAST(ast.right, variables);

      switch (ast.op) {
        case 'and':
        case '&&':
          return left && right;
        case 'or':
        case '||':
          return left || right;
        case '==':
        case '===':
          return left === right;
        case '!=':
        case '!==':
          return left !== right;
        case '<':
          return left < right;
        case '>':
          return left > right;
        case '<=':
          return left <= right;
        case '>=':
          return left >= right;
        default:
          throw new Error(`SafeEvaluator: Unknown binary operator: "${ast.op}"`);
      }
    }

    throw new Error(`SafeEvaluator: Unknown AST node type: "${ast.type}"`);
  }

  /**
   * Evaluate expression with variables
   * Main entry point
   */
  static evaluate(expr, variables = {}) {
    try {
      // Guard: empty expression
      if (!expr || expr.trim().length === 0) {
        return true; // Default to true for empty conditions
      }

      // Step 1: Tokenize
      const tokens = SafeEvaluator.tokenize(expr);

      // Step 2: Validate for safety
      SafeEvaluator.validate(tokens);

      // Step 3: Parse into AST
      const ast = SafeEvaluator.parse(tokens);

      // Step 4: Evaluate with variables
      const result = SafeEvaluator.evaluateAST(ast, variables);

      return !!result;
    } catch (error) {
      logger.error(`[SafeEvaluator] Error evaluating expression: "${expr}"`, error.message);
      throw error;
    }
  }
}

module.exports = SafeEvaluator;
