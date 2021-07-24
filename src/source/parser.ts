import { ScriptCode } from './scriptcode';
import { eScriptNode, ScriptNode, sToken } from './scriptnode';
import {
  TXT_AUTO_NOT_ALLOWED,
  TXT_EXPECTED_CONSTANT,
  TXT_EXPECTED_DATA_TYPE,
  TXT_EXPECTED_EXPRESSION_VALUE,
  TXT_EXPECTED_IDENTIFIER,
  TXT_EXPECTED_METHOD_OR_PROPERTY,
  TXT_EXPECTED_ONE_OF,
  TXT_EXPECTED_OPERATOR,
  TXT_EXPECTED_POST_OPERATOR,
  TXT_EXPECTED_PRE_OPERATOR,
  TXT_EXPECTED_s,
  TXT_EXPECTED_STRING,
  TXT_EXPECTED_s_OR_s,
  TXT_IDENTIFIER_s_NOT_DATA_TYPE,
  TXT_INSTEAD_FOUND_IDENTIFIER_s,
  TXT_INSTEAD_FOUND_KEYWORD_s,
  TXT_INSTEAD_FOUND_s,
  TXT_NAMED_ARGS_WITH_OLD_SYNTAX,
  TXT_NONTERMINATED_STRING,
  TXT_UNEXPECTED_END_OF_FILE,
  TXT_UNEXPECTED_TOKEN_s,
  TXT_UNEXPECTED_VAR_DECL,
  TXT_WHILE_PARSING_ARG_LIST,
  TXT_WHILE_PARSING_EXPRESSION,
  TXT_WHILE_PARSING_NAMESPACE,
  TXT_WHILE_PARSING_STATEMENT_BLOCK,
} from './texts';
import {
  ABSTRACT_TOKEN,
  eTokenType,
  EXPLICIT_TOKEN,
  EXTERNAL_TOKEN,
  FINAL_TOKEN,
  FROM_TOKEN,
  FUNCTION_TOKEN,
  GET_TOKEN,
  IF_HANDLE_TOKEN,
  OVERRIDE_TOKEN,
  PROPERTY_TOKEN,
  SET_TOKEN,
  SHARED_TOKEN,
} from './tokendef';
import { asCTokenizer } from './tokenizer';

const format = (fmt: string, ...args: string[]) => {
  return args.reduce((a, b) => a.replace(/%./, b), fmt);
};

export class Message extends Error {
  constructor(
    public text: string,
    public row: number,
    public col: number
  ) {
    super();
  }
}

interface EngineProperties {
	allowImplicitHandleTypes?: boolean
	alterSyntaxNamedArgs?: boolean;
}

interface ParserConfig {
  templateTypes: string[];
  ep: EngineProperties;
}

export class Parser {
  errorWhileParsing: boolean = false;
  isSyntaxError: boolean = false;
  checkValidTypes: boolean = false;
  isParsingAppInterface: boolean = false;

  script: ScriptCode | null = null;
  scriptNode: ScriptNode | null = null;

  tempString: string = '';

  lastToken: sToken | null = null;
  sourcePos: number = 0;

  errors: Message[] = [];
  warnings: Message[] = [];
  infos: Message[] = [];
  config: ParserConfig;

  constructor(
    public tokenizer: asCTokenizer,
    config?: Partial<ParserConfig>,
  ) {
    this.config = {
      ep: {
        allowImplicitHandleTypes: true,
        alterSyntaxNamedArgs: true,
        ...config?.ep,
      },
      templateTypes: ['array'],
      ...config,
    }
  }

  IsTemplateType (str: string): boolean {
    return this.config.templateTypes.some(e => e == str);
  }

  Reset() {
    this.errorWhileParsing = false;
    this.isSyntaxError = false;
    this.checkValidTypes = false;
    this.isParsingAppInterface = false;

    this.sourcePos = 0;
    this.scriptNode = null;
    this.script = null;

    if (this.lastToken) {
      this.lastToken.pos = -1;
    }
  }

  GetScriptNode() {
    return this.scriptNode;
  }

  ParseFunctionDefinition(): ScriptNode;
  ParseFunctionDefinition(
    in_script: ScriptCode,
    in_expectListPattern: boolean
  ): number;
  ParseFunctionDefinition(
    in_script?: ScriptCode,
    in_expectListPattern?: boolean
  ): number | ScriptNode {
    if (in_script && in_expectListPattern) {
      this.Reset();

      // Set flag that permits ? as datatype for parameters
      this.isParsingAppInterface = true;

      this.script = in_script;
      this.scriptNode = this.ParseFunctionDefinition();

      if (in_expectListPattern) {
        if (this.scriptNode) {
          this.scriptNode.AddChildLast(this.ParseListPattern());
        }
      }

      // The declaration should end after the definition
      if (!this.isSyntaxError) {
        let t = this.GetToken();
        if (t.type != eTokenType.ttEnd) {
          this.Error(
            this.ExpectedToken(asCTokenizer.GetDefinition(eTokenType.ttEnd)),
            t
          );
          this.Error(this.InsteadFound(t), t);
          return -1;
        }
      }

      if (this.errorWhileParsing) {
        return -1;
      }

      return 0;
    } else {
      let node = this.CreateNode(eScriptNode.snFunction);

      node.AddChildLast(this.ParseType(true));
      if (this.isSyntaxError) return node;

      node.AddChildLast(this.ParseTypeMod(false));
      if (this.isSyntaxError) return node;

      this.ParseOptionalScope(node);

      node.AddChildLast(this.ParseIdentifier());
      if (this.isSyntaxError) return node;

      node.AddChildLast(this.ParseParameterList());
      if (this.isSyntaxError) return node;

      // Parse an optional 'const' after the function definition (used for object methods)
      let t1 = this.GetToken();
      this.RewindTo(t1);

      if (t1.type == eTokenType.ttConst) {
        node.AddChildLast(this.ParseToken(eTokenType.ttConst));
      }

      // Parse optional attributes
      this.ParseMethodAttributes(node);

      return node;
    }
  }

  CreateNode(type: eScriptNode) {
    return new ScriptNode(type);
  }

  // 152
  ParseDataType(in_script: ScriptCode, in_isReturnType: boolean): number;
  ParseDataType(
    allowVariableType?: boolean,
    allowAuto?: boolean
  ): ScriptNode;
  ParseDataType(
    arg1: ScriptCode | boolean = false,
    arg2: boolean = false
  ): ScriptNode | number {
    if (arg1 instanceof ScriptCode) {
      const in_script = arg1;
      const in_isReturnType = arg2;

      this.Reset();

      this.script = in_script;

      this.scriptNode = this.CreateNode(eScriptNode.snDataType);
      if (this.scriptNode == null) return -1;

      this.scriptNode.AddChildLast(this.ParseType(true));
      if (this.isSyntaxError) return -1;

      if (in_isReturnType) {
        this.scriptNode.AddChildLast(this.ParseTypeMod(false));
        if (this.isSyntaxError) return -1;
      }

      // The declaration should end after the type
      let t = this.GetToken();

      if (t.type != eTokenType.ttEnd) {
        this.Error(
          this.ExpectedToken(asCTokenizer.GetDefinition(eTokenType.ttEnd)),
          t
        );
        this.Error(this.InsteadFound(t), t);
        return -1;
      }

      return 0;
    } else {
      const allowVariableType = arg1;
      const allowAuto = arg2;

      let node = this.CreateNode(eScriptNode.snDataType);

      let t1 = this.GetToken();

      if (
        !this.IsDataType(t1) &&
        !(allowVariableType && t1.type == eTokenType.ttQuestion) &&
        !(allowAuto && t1.type == eTokenType.ttAuto)
      ) {
        if (t1.type === eTokenType.ttIdentifier) {
          if (this.script) {
            let errMsg = format(
              TXT_IDENTIFIER_s_NOT_DATA_TYPE,
              this.script.code.substr(t1.pos, t1.length)
            );
            this.Error(errMsg, t1);
          }
        } else if (t1.type == eTokenType.ttAuto) {
          this.Error(TXT_AUTO_NOT_ALLOWED, t1);
        } else {
          this.Error(TXT_EXPECTED_DATA_TYPE, t1);
          this.Error(this.InsteadFound(t1), t1);
        }
        return node;
      }

      node.SetToken(t1);
      node.UpdateSourcePos(t1.pos, t1.length);

      return node;
    }
  }

  // 188
  ParseTemplateDecl(in_script: ScriptCode) {
    this.Reset();

    this.script = in_script;
    this.scriptNode = this.CreateNode(eScriptNode.snUndefined);
    if (this.scriptNode == null) return -1;

    this.scriptNode.AddChildLast(this.ParseIdentifier());
    if (this.isSyntaxError) return -1;

    let t = this.GetToken();
    if (t.type != eTokenType.ttLessThan) {
      this.Error(
        this.ExpectedToken(asCTokenizer.GetDefinition(eTokenType.ttLessThan)),
        t
      );
      this.Error(this.InsteadFound(t), t);
      return -1;
    }

    // The class token is optional
    t = this.GetToken();
    if (t.type != eTokenType.ttClass) {
      this.RewindTo(t);
    }

    this.scriptNode.AddChildLast(this.ParseIdentifier());
    if (this.isSyntaxError) return -1;

    // There can be multiple sub types
    t = this.GetToken();

    // Parse template types by list separator
    while (t.type == eTokenType.ttListSeparator) {
      t = this.GetToken();
      if (t.type != eTokenType.ttClass) {
        this.RewindTo(t);
      }
      this.scriptNode.AddChildLast(this.ParseIdentifier());

      if (this.isSyntaxError) return -1;
      t = this.GetToken();
    }

    if (t.type != eTokenType.ttGreaterThan) {
      this.Error(
        this.ExpectedToken(asCTokenizer.GetDefinition(eTokenType.ttGreaterThan)),
        t
      );
      this.Error(this.InsteadFound(t), t);
      return -1;
    }

    t = this.GetToken();
    if (t.type != eTokenType.ttEnd) {
      this.Error(
        this.ExpectedToken(asCTokenizer.GetDefinition(eTokenType.ttEnd)),
        t
      );
      this.Error(this.InsteadFound(t), t);
      return -1;
    }

    if (this.errorWhileParsing) return -1;

    return 0;
  }

  // 252
  ParsePropertyDeclaration(in_script: ScriptCode) {
    this.Reset();

    this.script = in_script;

    this.scriptNode = this.CreateNode(eScriptNode.snDeclaration);
    if (this.scriptNode == null) return -1;

    this.scriptNode.AddChildLast(this.ParseType(true));
    if (this.isSyntaxError) return -1;

    // Allow optional '&' to indicate that the property is indirect, i.e. stored as reference
    let t = this.GetToken();
    this.RewindTo(t);

    if (t.type == eTokenType.ttAmp)
      this.scriptNode.AddChildLast(this.ParseToken(eTokenType.ttAmp));

    // Allow optional namespace to be defined before the identifier in case
    // the declaration is to be used for searching for an existing property
    this.ParseOptionalScope(this.scriptNode);

    this.scriptNode.AddChildLast(this.ParseIdentifier());
    if (this.isSyntaxError) return -1;

    // The declaration should end after the identifier
    t = this.GetToken();
    if (t.type != eTokenType.ttEnd) {
      this.Error(
        this.ExpectedToken(asCTokenizer.GetDefinition(eTokenType.ttEnd)),
        t
      );
      this.Error(this.InsteadFound(t), t);
      return -1;
    }

    return 0;
  }

  // 292
  ParseOptionalScope(node: ScriptNode) {
    let scope: ScriptNode = this.CreateNode(eScriptNode.snScope);

    let t1 = this.GetToken();
    let t2 = this.GetToken();

    if (t1.type == eTokenType.ttScope) {
      this.RewindTo(t1);
      scope.AddChildLast(this.ParseToken(eTokenType.ttScope));
      t1 = this.GetToken();
      t2 = this.GetToken();
    }

    while (
      t1.type == eTokenType.ttIdentifier &&
      t2.type == eTokenType.ttScope
    ) {
      this.RewindTo(t1);

      scope.AddChildLast(this.ParseIdentifier());
      scope.AddChildLast(this.ParseToken(eTokenType.ttScope));

      t1 = this.GetToken();
      t2 = this.GetToken();
    }

    // The innermost scope may be a template type
    if (
      t1.type == eTokenType.ttIdentifier &&
      t2.type == eTokenType.ttLessThan
    ) {
      if (this.script) {
        this.tempString = this.script.code.substr(t1.pos, t1.length);
        if (this.IsTemplateType(this.tempString)) {
            this.RewindTo(t1);
            let restore = scope.lastChild;
            scope.AddChildLast(this.ParseIdentifier());
            if (this.ParseTemplTypeList(scope, false)) {
                t2 = this.GetToken();
                if (t2.type == eTokenType.ttScope) {
                    // Template type is part of the scope
                    // Nothing more needs to be done
                    node.AddChildLast(scope);
                    return;
                } else {
                    // The template type is not part of the scope
                    // Rewind to the template type and end the scope
                    this.RewindTo(t1);
                    // Restore the previously parsed node
                    while (scope.lastChild != restore) {
                        const last = scope.lastChild;
                        if (last) {
                            last.DisconnectParent();
                        }
                    } if (scope.lastChild) {
                        node.AddChildLast(scope);
                    }
                    return;
                }
            }
        }
      }
    }

    // The identifier is not part of the scope
    this.RewindTo(t1);

    if (scope.lastChild) {
      node.AddChildLast(scope);
    }
  }

  // 398
  ParseTypeMod(isParam: boolean) {
    let node = this.CreateNode(eScriptNode.snDataType);

    // Parse possible & token
    let t = this.GetToken();
    this.RewindTo(t);
    if (t.type == eTokenType.ttAmp) {
      node.AddChildLast(this.ParseToken(eTokenType.ttAmp));
      if (this.isSyntaxError) return node;

      if (isParam) {
        let t = this.GetToken();
        this.RewindTo(t);

        if (
          t.type == eTokenType.ttIn ||
          t.type == eTokenType.ttOut ||
          t.type == eTokenType.ttInOut
        ) {
          let tokens = [eTokenType.ttIn, eTokenType.ttOut, eTokenType.ttInOut];
          node.AddChildLast(this.ParseOneOf(tokens, 3));
        }
      }
    }

    // Parse possible + token
    t = this.GetToken();
    this.RewindTo(t);
    if (t.type == eTokenType.ttPlus) {
      node.AddChildLast(this.ParseToken(eTokenType.ttPlus));
      if (this.isSyntaxError) return node;
    }

    // Parse possible if_handle_then_const token
    t = this.GetToken();
    this.RewindTo(t);
    if (this.IdentifierIs(t, IF_HANDLE_TOKEN)) {
      node.AddChildLast(this.ParseToken(eTokenType.ttIdentifier));
      if (this.isSyntaxError) return node;
    }

    return node;
  }

  // 448
  ParseType(
    allowConst: boolean,
    allowVariableType: boolean = false,
    allowAuto: boolean = false
  ) {
    let node = this.CreateNode(eScriptNode.snDataType);

    let t;

    if (allowConst) {
      t = this.GetToken();
      this.RewindTo(t);

      if (t.type == eTokenType.ttConst) {
        node.AddChildLast(this.ParseToken(eTokenType.ttConst));
        if (this.isSyntaxError) return node;
      }
    }

    // Parse scope prefix
    this.ParseOptionalScope(node);

    // Parse the actual type
    node.AddChildLast(this.ParseDataType(allowVariableType, allowAuto));
    if (this.isSyntaxError) return node;

    // If the datatype is a template type, then parse the subtype within the < >
    t = this.GetToken();
    this.RewindTo(t);
    let type = node.lastChild;

    if (this.script && type) {
        this.tempString = this.script.code.substr(type.tokenPos, type.tokenLength);

        if (this.IsTemplateType(this.tempString) && t.type == eTokenType.ttLessThan) {
            this.ParseTemplTypeList(node);
            if (this.isSyntaxError) return node;
        }
    }

    // Parse [] and @
    t = this.GetToken();
    this.RewindTo(t);

    while (
      t.type == eTokenType.ttOpenBracket ||
      t.type == eTokenType.ttHandle
    ) {
      if (t.type == eTokenType.ttOpenBracket) {
        node.AddChildLast(this.ParseToken(eTokenType.ttOpenBracket));
        if (this.isSyntaxError) return node;

        t = this.GetToken();
        if (t.type != eTokenType.ttCloseBracket) {
          this.Error(this.ExpectedToken(']'), t);
          this.Error(this.InsteadFound(t), t);
          return node;
        }
      } else {
        node.AddChildLast(this.ParseToken(eTokenType.ttHandle));
        if (this.isSyntaxError) return node;

        t = this.GetToken();
        this.RewindTo(t);

        if (t.type == eTokenType.ttConst) {
          node.AddChildLast(this.ParseToken(eTokenType.ttConst));
          if (this.isSyntaxError) return node;
        }
      }

      t = this.GetToken();
      this.RewindTo(t);
    }

    return node;
  }

  // 527
  ParseTemplTypeList(node: ScriptNode, required: boolean = true) {
    let t;
    let isValid = true;

    // Remember the last child, so we can restore the state if needed
    let last = node.lastChild;

    // Starts with '<'
    t = this.GetToken();
    if (t.type != eTokenType.ttLessThan) {
      if (required) {
        this.Error(
          this.ExpectedToken(asCTokenizer.GetDefinition(eTokenType.ttLessThan)),
          t
        );
        this.Error(this.InsteadFound(t), t);
      }
      return false;
    }

    // At least one type
    // TODO: child funcdef: Make this work with !required
    node.AddChildLast(this.ParseType(true, false));
    if (this.isSyntaxError) return false;

    t = this.GetToken();

    // Parse template types by list separator
    while (t.type == eTokenType.ttListSeparator) {
      // TODO: child funcdef: Make this work with !required
      node.AddChildLast(this.ParseType(true, false));
      if (this.isSyntaxError) return false;
      t = this.GetToken();
    }

    // End with '>'
    // Accept >> and >>> tokens too. But then force the tokenizer to move
    // only 1 character ahead (thus splitting the token in two).
    if (this.script?.code[t.pos] != '>') {
      if (required) {
        this.Error(
          this.ExpectedToken(asCTokenizer.GetDefinition(eTokenType.ttGreaterThan)),
          t
        );
        this.Error(this.InsteadFound(t), t);
      } else {
        isValid = false;
      }
    } else {
      // Break the token so that only the first > is parsed
      this.SetPos(t.pos + 1);
    }

    if (!required && !isValid) {
      // Restore the original state before returning
      while (node.lastChild != last) {
        let n = node.lastChild;

        if (n) {
          n.DisconnectParent();
        }
      }

      return false;
    }

    // The template type list was parsed OK
    return true;
  }

  // 599
  ParseToken(token: number) {
    let node = this.CreateNode(eScriptNode.snUndefined);

    let t1 = this.GetToken();
    if (t1.type != token) {
      this.Error(this.ExpectedToken(asCTokenizer.GetDefinition(token)), t1);
      this.Error(this.InsteadFound(t1), t1);
      return node;
    }

    node.SetToken(t1);
    node.UpdateSourcePos(t1.pos, t1.length);

    return node;
  }

  // 620
  ParseOneOf(tokens: number[], count: number) {
    let node = this.CreateNode(eScriptNode.snUndefined);

    const t1 = this.GetToken();

    let n = tokens.findIndex((e) => e == t1.type);

    if (n == count) {
      this.Error(this.ExpectedOneOf(tokens, count), t1);
      this.Error(this.InsteadFound(t1), t1);
      return node;
    }

    node.SetToken(t1);
    node.UpdateSourcePos(t1.pos, t1.length);

    return node;
  }

  // 684
  ParseRealType() {
    let node = this.CreateNode(eScriptNode.snDataType);

    const t1 = this.GetToken();
    if (this.IsRealType(t1.type)) {
      this.Error(TXT_EXPECTED_DATA_TYPE, t1);
      this.Error(this.InsteadFound(t1), t1);
      return node;
    }

    node.SetToken(t1);
    node.UpdateSourcePos(t1.pos, t1.length);

    return node;
  }

  // 705
  ParseIdentifier() {
    let node = this.CreateNode(eScriptNode.snIdentifier);

    const t1 = this.GetToken();

    if (t1.type != eTokenType.ttIdentifier) {
      this.Error(TXT_EXPECTED_IDENTIFIER, t1);
      this.Error(this.InsteadFound(t1), t1);
      return node;
    }

    node.SetToken(t1);
    node.UpdateSourcePos(t1.pos, t1.length);

    return node;
  }

  ParseParameterList() {
    let node = this.CreateNode(eScriptNode.snParameterList);

    let t1 = this.GetToken();

    if (t1.type != eTokenType.ttOpenParanthesis) {
      this.Error(this.ExpectedToken('('), t1);
      this.Error(this.InsteadFound(t1), t1);
      return node;
    }

    node.UpdateSourcePos(t1.pos, t1.length);

    t1 = this.GetToken();

    if (t1.type == eTokenType.ttCloseParanthesis) {
      node.UpdateSourcePos(t1.pos, t1.length);

      // Statement block is finished
      return node;
    } else {
      // If the parameter list is just (void) then the void token should be ignored
      if (t1.type == eTokenType.ttVoid) {
        let t2 = this.GetToken();
        if (t2.type == eTokenType.ttCloseParanthesis) {
          node.UpdateSourcePos(t2.pos, t2.length);
          return node;
        }
      }

      this.RewindTo(t1);

      for (;;) {
        // Parse data type
        node.AddChildLast(this.ParseType(true, this.isParsingAppInterface));
        if (this.isSyntaxError) return node;

        node.AddChildLast(this.ParseTypeMod(true));
        if (this.isSyntaxError) return node;

        // Parse optional identifier
        t1 = this.GetToken();

        if (t1.type == eTokenType.ttIdentifier) {
          this.RewindTo(t1);

          node.AddChildLast(this.ParseIdentifier());
          if (this.isSyntaxError) return node;

          t1 = this.GetToken();
        }

        // Parse optional expression for the default arg
        if (t1.type == eTokenType.ttAssignment) {
          // Do a superficial parsing of the default argument
          // The actual parsing will be done when the argument is compiled for a function call
          node.AddChildLast(this.SuperficiallyParseExpression());
          if (this.isSyntaxError) return node;

          t1 = this.GetToken();
        }

        // Check if list continues
        if (t1.type == eTokenType.ttCloseParanthesis) {
          node.UpdateSourcePos(t1.pos, t1.length);

          return node;
        } else if (t1.type == eTokenType.ttListSeparator) {
          continue;
        } else {
          this.Error(this.ExpectedTokens(')', ','), t1);
          this.Error(this.InsteadFound(t1), t1);
          return node;
        }
      }
    }
  }

  // 820
  SuperficiallyParseExpression() {
    let node = this.CreateNode(eScriptNode.snExpression);

    // Simply parse everything until the first , or ), whichever comes first.
    // Keeping in mind that () and {} can group expressions.

    let start = this.GetToken();
    this.RewindTo(start);

    let stack = [];
    let t: sToken;
    for (;;) {
      t = this.GetToken();

      if (t.type == eTokenType.ttOpenParanthesis) {
        stack.push('(');
      } else if (t.type == eTokenType.ttCloseParanthesis) {
        if (!stack.length) {
          // Expression has ended. This token is not part of expression
          this.RewindTo(t);
          break;
        } else if (stack[stack.length - 1] == '(') {
          // Group has ended
          stack.pop();
        } else {
          // Wrong syntax
          this.RewindTo(t);
          this.Error(format(TXT_UNEXPECTED_TOKEN_s, ')'), t);
          return node;
        }
      } else if (t.type == eTokenType.ttListSeparator) {
        if (!stack.length) {
          // Expression has ended. This token is not part of expression
          this.RewindTo(t);
          break;
        }
      } else if (t.type == eTokenType.ttStartStatementBlock) {
        stack.push('{');
      } else if (t.type == eTokenType.ttEndStatementBlock) {
        if (!stack.length || stack[stack.length - 1] != '{') {
          // Wrong syntax
          this.RewindTo(t);
          this.Error(format(TXT_UNEXPECTED_TOKEN_s, '}'), t);
          return node;
        } else {
          // Group has ended
          stack.pop();
        }
      } else if (t.type == eTokenType.ttEndStatement) {
        // Wrong syntax (since we're parsing a default arg expression)
        this.RewindTo(t);
        this.Error(format(TXT_UNEXPECTED_TOKEN_s, ';'), t);
        return node;
      } else if (t.type == eTokenType.ttNonTerminatedStringConstant) {
        this.RewindTo(t);
        this.Error(TXT_NONTERMINATED_STRING, t);
        return node;
      } else if (t.type == eTokenType.ttEnd) {
        // Wrong syntax
        this.RewindTo(t);
        this.Error(TXT_UNEXPECTED_END_OF_FILE, t);
        this.Info(TXT_WHILE_PARSING_EXPRESSION, start);
        return node;
      }

      // Include the token in the node
      node.UpdateSourcePos(t.pos, t.length);
    }

    return node;
  }

  // 922
  GetToken(): sToken {
    let token: sToken = new sToken(eTokenType.ttUnrecognizedToken, 0, 0);

    // Check if the token has already been parsed
    if (this.lastToken?.pos == this.sourcePos) {
      token = this.lastToken;
      this.sourcePos += token.length;

      if (
        token.type == eTokenType.ttWhiteSpace ||
        token.type == eTokenType.ttOnelineComment ||
        token.type == eTokenType.ttMultilineComment
      ) {
        token = this.GetToken();
      }
      return token;
    }

    // Parse new token
    let sourceLength = this.script?.code.length || 0;

    do {
      if (this.sourcePos >= sourceLength) {
        token.type = eTokenType.ttEnd;
        token.length = 0;
      } else {
        const tmp = this.tokenizer.GetToken(
          this.script?.code.substr(this.sourcePos) || ''
        );

        token.type = tmp.tokenType;
        token.length = tmp.length;
      }

      token.pos = this.sourcePos;

      // Update state
      this.sourcePos += token.length;
    } while (
      token.type == eTokenType.ttWhiteSpace ||
      token.type == eTokenType.ttOnelineComment ||
      token.type == eTokenType.ttMultilineComment
    );

    return token;
  }

  SetPos(pos: number) {
    if (this.lastToken) {
      this.lastToken.pos = -1;
    }
    this.sourcePos = pos;
  }

  // 965
  RewindTo(token: sToken) {
    // Store the token so it doesn't have to be tokenized again
    this.lastToken = token;
    this.sourcePos = token.pos;
  }

  // 978
  Error(text: string, token: sToken) {
    this.RewindTo(token);

    this.isSyntaxError = true;
    this.errorWhileParsing = true;

    if (this.script) {
      let { row, col } = this.script.ConvertPosToRowCol(token.pos);

      this.errors.push(new Message(text, row, col));
    }
  }

  // 994
  Warning(text: string, token: sToken) {
    if (this.script) {
      let { row, col } = this.script.ConvertPosToRowCol(token.pos);

      this.warnings.push(new Message(text, row, col));
    }
  }

  // 1003
  Info(text: string, token: sToken) {
    this.RewindTo(token);

    this.isSyntaxError = true;
    this.errorWhileParsing = true;

    if (this.script) {
      let { row, col } = this.script.ConvertPosToRowCol(token.pos);

      this.infos.push(new Message(text, row, col));
    }
  }

  // 1017
  IsRealType(tokenType: number) {
    if (
      tokenType == eTokenType.ttVoid ||
      tokenType == eTokenType.ttInt ||
      tokenType == eTokenType.ttInt8 ||
      tokenType == eTokenType.ttInt16 ||
      tokenType == eTokenType.ttInt64 ||
      tokenType == eTokenType.ttUInt ||
      tokenType == eTokenType.ttUInt8 ||
      tokenType == eTokenType.ttUInt16 ||
      tokenType == eTokenType.ttUInt64 ||
      tokenType == eTokenType.ttFloat ||
      tokenType == eTokenType.ttBool ||
      tokenType == eTokenType.ttDouble
    ) {
      return true;
    }

    return false;
  }

  // 1036
  IsDataType(token: sToken) {
    if (token.type == eTokenType.ttIdentifier) {
      /** #ifndef AS_NO_COMPILER
                    if (this.checkValidTypes) {
                        // Check if this is an existing type, regardless of namespace
                        if (this.script) {
                            if(!this.builder.DoesTypeExist(this.script.code.substr(token.pos, token.length)))
                                return false;
                        }
                    }
            #endif */
      return true;
    }

    if (this.IsRealType(token.type)) {
      return true;
    }

    return false;
  }

  // 1058
  ExpectedToken(token: string): string {
    return format(TXT_EXPECTED_s, token);
  }

  // 1067
  ExpectedTokens(t1: string, t2: string) {
    return format(TXT_EXPECTED_s_OR_s, t1, t2);
  }

  // 1076
  ExpectedOneOf(tokens: number[], count: number): string;
  ExpectedOneOf(tokens: string[], count: number): string;
  ExpectedOneOf(tokens: (string | number)[], count: number): string {
    let str = TXT_EXPECTED_ONE_OF;

    for (let n = 0; n < count; n++) {
      let tmp = tokens[n];
      if (typeof tmp === 'number') {
        str += asCTokenizer.GetDefinition(tmp);
      } else {
        str += tmp;
      }
      if (n < count - 1) {
        str += ', ';
      }
    }

    return str;
  }

  // 1106
  InsteadFound(t: sToken) {
    if (t.type == eTokenType.ttIdentifier) {
      if (this.script) {
        let id = this.script.code.substr(t.pos, t.length);
        return format(TXT_INSTEAD_FOUND_IDENTIFIER_s, id);
      }
    } else if (t.type >= eTokenType.ttIf) {
      return format(
        TXT_INSTEAD_FOUND_KEYWORD_s,
        asCTokenizer.GetDefinition(t.type)
      );
    }

    return format(TXT_INSTEAD_FOUND_s, asCTokenizer.GetDefinition(t.type));
  }

  ParseListPattern() {
    let node = this.CreateNode(eScriptNode.snListPattern);

    let t1 = this.GetToken();
    if (t1.type != eTokenType.ttStartStatementBlock) {
      this.Error(this.ExpectedToken('{'), t1);
      this.Error(this.InsteadFound(t1), t1);
      return node;
    }

    node.UpdateSourcePos(t1.pos, t1.length);

    let start = t1;

    let isBeginning = true;
    let afterType = false;

    while (!this.isSyntaxError) {
      t1 = this.GetToken();
      if (t1.type == eTokenType.ttEndStatementBlock) {
        if (!afterType) {
          this.Error(TXT_EXPECTED_DATA_TYPE, t1);
          this.Error(this.InsteadFound(t1), t1);
        }
        break;
      } else if (t1.type == eTokenType.ttStartStatementBlock) {
        if (afterType) {
          this.Error(this.ExpectedTokens(',', '}'), t1);
          this.Error(this.InsteadFound(t1), t1);
        }
        this.RewindTo(t1);
        node.AddChildLast(this.ParseListPattern());
        afterType = true;
      } else if (
        t1.type == eTokenType.ttIdentifier &&
        (this.IdentifierIs(t1, 'repeat') ||
          this.IdentifierIs(t1, 'repeat_same'))
      ) {
        if (!isBeginning) {
          if (this.script) {
            const msg = format(
              TXT_UNEXPECTED_TOKEN_s,
              this.script.code.substr(t1.pos, t1.length)
            );
            this.Error(msg, t1);
          }
        }
        this.RewindTo(t1);
        node.AddChildLast(this.ParseIdentifier());
      } else if (t1.type == eTokenType.ttEnd) {
        this.Error(TXT_UNEXPECTED_END_OF_FILE, t1);
        this.Info(TXT_WHILE_PARSING_STATEMENT_BLOCK, start);
        break;
      } else if (t1.type == eTokenType.ttListSeparator) {
        if (!afterType) {
          this.Error(TXT_EXPECTED_DATA_TYPE, t1);
          this.Error(this.InsteadFound(t1), t1);
        }
        afterType = false;
      } else {
        if (afterType) {
          this.Error(this.ExpectedTokens(',', '}'), t1);
          this.Error(this.InsteadFound(t1), t1);
        }
        this.RewindTo(t1);
        node.AddChildLast(this.ParseType(true, true));
        afterType = true;
      }

      isBeginning = false;
    }

    node.UpdateSourcePos(t1.pos, t1.length);

    return node;
  }

  // 1213
  IdentifierIs(t: sToken, str: string) {
    if (t.type != eTokenType.ttIdentifier) {
      return false;
    }

    return this.script && this.script.code.substr(t.pos, t.length) === str;
  }

  // 1221
  ParseMethodAttributes(funcNode: ScriptNode) {
    let t1: sToken;

    for (;;) {
      t1 = this.GetToken();
      this.RewindTo(t1);

      if (
        this.IdentifierIs(t1, FINAL_TOKEN) ||
        this.IdentifierIs(t1, OVERRIDE_TOKEN) ||
        this.IdentifierIs(t1, EXPLICIT_TOKEN) ||
        this.IdentifierIs(t1, PROPERTY_TOKEN)
      )
        funcNode.AddChildLast(this.ParseIdentifier());
      else break;
    }
  }

  // 1245
  IsType() {
    let ret = null;

    // Set a rewind point
    let t = this.GetToken();

    // A type can start with a const
    let t1 = t;

    if (t1.type == eTokenType.ttConst) {
      t1 = this.GetToken();
    }

    let t2;
    if (t1.type != eTokenType.ttAuto) {
      // The type may be initiated with the scope operator
      if (t1.type == eTokenType.ttScope) {
        t1 = this.GetToken();
      }

      // The type may be preceded with a multilevel scope
      t2 = this.GetToken();
      while (t1.type == eTokenType.ttIdentifier) {
        if (t2.type == eTokenType.ttScope) {
          t1 = this.GetToken();
          t2 = this.GetToken();
          continue;
        } else if (t2.type == eTokenType.ttLessThan) {
          // Template types can also be used as scope identifiers
          this.RewindTo(t2);
          if (this.CheckTemplateType(t1)) {
            let t3 = this.GetToken();
            if (t3.type == eTokenType.ttScope) {
              t1 = this.GetToken();
              t2 = this.GetToken();
              continue;
            }
          }
        }
        break;
      }
      this.RewindTo(t2);
    }

    // We don't validate if the identifier is an actual declared type at this moment
    // as it may wrongly identify the statement as a non-declaration if the user typed
    // the name incorrectly. The real type is validated in ParseDeclaration where a
    // proper error message can be given.
    if (
      !this.IsRealType(t1.type) &&
      t1.type != eTokenType.ttIdentifier &&
      t1.type != eTokenType.ttAuto
    ) {
      this.RewindTo(t);
      return ret;
    }

    if (!this.CheckTemplateType(t1)) {
      this.RewindTo(t);
      return ret;
    }

    // Object handles can be interleaved with the array brackets
    // Even though declaring variables with & is invalid we'll accept
    // it here to give an appropriate error message later
    t2 = this.GetToken();
    while (
      t2.type == eTokenType.ttHandle ||
      t2.type == eTokenType.ttAmp ||
      t2.type == eTokenType.ttOpenBracket
    ) {
      if (t2.type == eTokenType.ttHandle) {
        // A handle can optionally be read-only
        let t3 = this.GetToken();
        if (t3.type != eTokenType.ttConst) {
          this.RewindTo(t3);
        }
      } else if (t2.type == eTokenType.ttOpenBracket) {
        t2 = this.GetToken();
        if (t2.type != eTokenType.ttCloseBracket) {
          this.RewindTo(t);
          return ret;
        }
      }

      t2 = this.GetToken();
    }

    // Return the next token so the caller can jump directly to it if desired
    ret = t2;

    // Rewind to start point
    this.RewindTo(t);

    return ret;
  }

  CheckTemplateType(t: sToken) {
    // Is this a template type?

    if (
      this.script && this.IsTemplateType(this.script.code.substr(t.pos, t.length))
    ) {
      // If the next token is a < then parse the sub-type too
      let t1 = this.GetToken();
      if (t1.type != eTokenType.ttLessThan) {
        this.RewindTo(t1);
        return true;
      }

      for (;;) {
        // There might optionally be a 'const'
        t1 = this.GetToken();
        if (t1.type == eTokenType.ttConst) {
          t1 = this.GetToken();
        }

        // The type may be initiated with the scope operator
        if (t1.type == eTokenType.ttScope) {
          t1 = this.GetToken();
        }

        // There may be multiple levels of scope operators
        let t2 = this.GetToken();

        while (
          t1.type == eTokenType.ttIdentifier &&
          t2.type == eTokenType.ttScope
        ) {
          t1 = this.GetToken();
          t2 = this.GetToken();
        }
        this.RewindTo(t2);

        // Now there must be a data type
        if (!this.IsDataType(t1)) {
          return false;
        }

        if (!this.CheckTemplateType(t1)) {
          return false;
        }

        t1 = this.GetToken();

        // Is it a handle or array?
        while (
          t1.type == eTokenType.ttHandle ||
          t1.type == eTokenType.ttOpenBracket
        ) {
          if (t1.type == eTokenType.ttOpenBracket) {
            t1 = this.GetToken();
            if (t1.type != eTokenType.ttCloseBracket) {
              return false;
            }
          }

          t1 = this.GetToken();
        }

        // Was this the last template subtype?
        if (t1.type != eTokenType.ttListSeparator) {
          break;
        }
      }

      // Accept >> and >>> tokens too. But then force the tokenizer to move
      // only 1 character ahead (thus splitting the token in two).
      if (this.script.code.charAt(t1.pos) != '>') {
        return false;
      } else if (t1.length != 1) {
        this.SetPos(t1.pos + 1);
      }
    }

    return true;
  }

  // 1428
  ParseCast() {
    let node = this.CreateNode(eScriptNode.snCast);

    let t1 = this.GetToken();

    if (t1.type != eTokenType.ttCast) {
      this.Error(this.ExpectedToken('cast'), t1);
      this.Error(this.InsteadFound(t1), t1);
      return node;
    }

    node.UpdateSourcePos(t1.pos, t1.length);

    t1 = this.GetToken();
    if (t1.type != eTokenType.ttLessThan) {
      this.Error(this.ExpectedToken('<'), t1);
      this.Error(this.InsteadFound(t1), t1);
      return node;
    }

    // Parse the data type
    node.AddChildLast(this.ParseType(true));
    if (this.isSyntaxError) return node;

    t1 = this.GetToken();
    if (t1.type != eTokenType.ttGreaterThan) {
      this.Error(this.ExpectedToken('>'), t1);
      this.Error(this.InsteadFound(t1), t1);
      return node;
    }

    t1 = this.GetToken();

    if (t1.type != eTokenType.ttOpenParanthesis) {
      this.Error(this.ExpectedToken('('), t1);
      this.Error(this.InsteadFound(t1), t1);
      return node;
    }

    node.AddChildLast(this.ParseAssignment());
    if (this.isSyntaxError) return node;

    t1 = this.GetToken();
    if (t1.type != eTokenType.ttCloseParanthesis) {
      this.Error(this.ExpectedToken(')'), t1);
      this.Error(this.InsteadFound(t1), t1);
      return node;
    }

    node.UpdateSourcePos(t1.pos, t1.length);

    return node;
  }

  // 1489
  ParseExprValue() {
    let node = this.CreateNode(eScriptNode.snExprValue);

    let t1 = this.GetToken();
    let t2 = this.GetToken();
    this.RewindTo(t1);

    // 'void' is a special expression that doesn't do anything (normally used for skipping output arguments)
    if (t1.type == eTokenType.ttVoid) {
      node.AddChildLast(this.ParseToken(eTokenType.ttVoid));
    } else if (this.IsRealType(t1.type)) {
      node.AddChildLast(this.ParseConstructCall());
    } else if (
      t1.type == eTokenType.ttIdentifier ||
      t1.type == eTokenType.ttScope
    ) {
      // Check if the expression is an anonymous function
      if (this.IsLambda()) {
        node.AddChildLast(this.ParseLambda());
      } else {
        // Determine the last identifier in order to check if it is a type
        let t: sToken;
        if (t1.type == eTokenType.ttScope) {
          t = t2;
        } else {
          t = t1;
        }
        this.RewindTo(t);
        t2 = this.GetToken();
        while (t.type == eTokenType.ttIdentifier) {
          t2 = t;
          t = this.GetToken();
          if (t.type == eTokenType.ttScope) {
            t = this.GetToken();
          } else {
            break;
          }
        }

        let isDataType = this.IsDataType(t2);
        let isTemplateType = false;
        if (isDataType) {
          // Is this a template type?
          if (this.script) {
            if(this.IsTemplateType(this.script.code.substr(t2.pos, t2.length))) {
                isTemplateType = true;
            }
          }
        }

        t2 = this.GetToken();

        // Rewind so the real parsing can be done, after deciding what to parse
        this.RewindTo(t1);

        // Check if this is a construct call
        // Just 'type()' isn't considered a construct call, because type may just be a function/method name.
        // The compiler will have to sort this out, since the parser doesn't have enough information.
        if (
          isDataType &&
          t.type == eTokenType.ttOpenBracket &&
          t2.type == eTokenType.ttCloseBracket
        ) {
          // type[]()
          node.AddChildLast(this.ParseConstructCall());
        } else if (isTemplateType && t.type == eTokenType.ttLessThan) {
          // type<t>()
          node.AddChildLast(this.ParseConstructCall());
        } else if (this.IsFunctionCall()) {
          node.AddChildLast(this.ParseFunctionCall());
        } else {
          node.AddChildLast(this.ParseVariableAccess());
        }
      }
    } else if (t1.type == eTokenType.ttCast) {
      node.AddChildLast(this.ParseCast());
    } else if (this.IsConstant(t1.type)) {
      node.AddChildLast(this.ParseConstant());
    } else if (t1.type == eTokenType.ttOpenParanthesis) {
      t1 = this.GetToken();
      node.UpdateSourcePos(t1.pos, t1.length);
      node.AddChildLast(this.ParseAssignment());

      if (this.isSyntaxError) return node;

      t1 = this.GetToken();
      if (t1.type != eTokenType.ttCloseParanthesis) {
        this.Error(this.ExpectedToken(')'), t1);
        this.Error(this.InsteadFound(t1), t1);
      }

      node.UpdateSourcePos(t1.pos, t1.length);
    } else {
      this.Error(TXT_EXPECTED_EXPRESSION_VALUE, t1);
      this.Error(this.InsteadFound(t1), t1);
    }

    return node;
  }

  // 1590
  ParseConstant() {
    let node = this.CreateNode(eScriptNode.snConstant);

    let t = this.GetToken();
    if (!this.IsConstant(t.type)) {
      this.Error(TXT_EXPECTED_CONSTANT, t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.SetToken(t);
    node.UpdateSourcePos(t.pos, t.length);

    // We want to gather a list of string constants to concatenate as children
    if (
      t.type == eTokenType.ttStringConstant ||
      t.type == eTokenType.ttMultilineStringConstant ||
      t.type == eTokenType.ttHeredocStringConstant
    ) {
      this.RewindTo(t);
    }

    while (
      t.type == eTokenType.ttStringConstant ||
      t.type == eTokenType.ttMultilineStringConstant ||
      t.type == eTokenType.ttHeredocStringConstant
    ) {
      node.AddChildLast(this.ParseStringConstant());

      t = this.GetToken();
      this.RewindTo(t);
    }

    return node;
  }

  // 1622
  IsLambda() {
    let isLambda = false;
    let t = this.GetToken();
    if (
      t.type == eTokenType.ttIdentifier &&
      this.IdentifierIs(t, FUNCTION_TOKEN)
    ) {
      let t2 = this.GetToken();
      if (t2.type == eTokenType.ttOpenParanthesis) {
        // Skip until )
        while (
          t2.type != eTokenType.ttCloseParanthesis &&
          t2.type != eTokenType.ttEnd
        ) {
          t2 = this.GetToken();
        }

        // The next token must be a {
        t2 = this.GetToken();
        if (t2.type == eTokenType.ttStartStatementBlock) {
          isLambda = true;
        }
      }
    }

    this.RewindTo(t);
    return isLambda;
  }

  // 1649
  ParseLambda() {
    let node = this.CreateNode(eScriptNode.snFunction);

    let t: sToken | null = this.GetToken();
    if (
      t.type != eTokenType.ttIdentifier ||
      !this.IdentifierIs(t, FUNCTION_TOKEN)
    ) {
      this.Error(this.ExpectedToken('function'), t);
      return node;
    }

    t = this.GetToken();
    if (t.type != eTokenType.ttOpenParanthesis) {
      this.Error(this.ExpectedToken('('), t);
      return node;
    }

    // Parse optional type before parameter name
    t = this.IsType();
    if (t) {
      if (t.type == eTokenType.ttAmp || t.type == eTokenType.ttIdentifier) {
        node.AddChildLast(this.ParseType(true));
        if (this.isSyntaxError) return node;
        node.AddChildLast(this.ParseTypeMod(true));
        if (this.isSyntaxError) return node;
      }
    }

    t = this.GetToken();

    if (t.type == eTokenType.ttIdentifier) {
      this.RewindTo(t);
      node.AddChildLast(this.ParseIdentifier());
      if (this.isSyntaxError) return node;

      t = this.GetToken();
      while (t.type == eTokenType.ttListSeparator) {
        // Parse optional type before parameter name
        t = this.IsType();

        if (t) {
          if (t.type == eTokenType.ttAmp || t.type == eTokenType.ttIdentifier) {
            node.AddChildLast(this.ParseType(true));
            if (this.isSyntaxError) return node;
            node.AddChildLast(this.ParseTypeMod(true));
            if (this.isSyntaxError) return node;
          }
        }

        node.AddChildLast(this.ParseIdentifier());
        if (this.isSyntaxError) return node;

        t = this.GetToken();
      }
    }

    if (t.type != eTokenType.ttCloseParanthesis) {
      this.Error(this.ExpectedToken(')'), t);
      return node;
    }

    // We should just find the end of the statement block here. The statements
    // will be parsed on request by the compiler once it starts the compilation.
    node.AddChildLast(this.SuperficiallyParseStatementBlock());

    return node;
  }

  // 1718
  ParseStringConstant() {
    let node = this.CreateNode(eScriptNode.snConstant);

    let t = this.GetToken();

    if (
      t.type != eTokenType.ttStringConstant &&
      t.type != eTokenType.ttMultilineStringConstant &&
      t.type != eTokenType.ttHeredocStringConstant
    ) {
      this.Error(TXT_EXPECTED_STRING, t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.SetToken(t);
    node.UpdateSourcePos(t.pos, t.length);

    return node;
  }

  // 1739
  ParseFunctionCall() {
    let node = this.CreateNode(eScriptNode.snFunctionCall);

    // Parse scope prefix
    this.ParseOptionalScope(node);

    // Parse the function name followed by the argument list
    node.AddChildLast(this.ParseIdentifier());
    if (this.isSyntaxError) return node;

    node.AddChildLast(this.ParseArgList());

    return node;
  }

  // 1757
  ParseVariableAccess() {
    let node = this.CreateNode(eScriptNode.snVariableAccess);

    // Parse scope prefix
    this.ParseOptionalScope(node);

    // Parse the variable name
    node.AddChildLast(this.ParseIdentifier());

    return node;
  }

  // 1771
  ParseConstructCall() {
    let node = this.CreateNode(eScriptNode.snConstructCall);

    node.AddChildLast(this.ParseType(false));
    if (this.isSyntaxError) return node;

    node.AddChildLast(this.ParseArgList());

    return node;
  }

  // 1786
  ParseArgList(withParenthesis: boolean = true) {
    let node = this.CreateNode(eScriptNode.snArgList);

    let t1: sToken;
    if (withParenthesis) {
      t1 = this.GetToken();
      if (t1.type != eTokenType.ttOpenParanthesis) {
        this.Error(this.ExpectedToken('('), t1);
        this.Error(this.InsteadFound(t1), t1);
        return node;
      }

      node.UpdateSourcePos(t1.pos, t1.length);
    }

    t1 = this.GetToken();
    if (
      t1.type == eTokenType.ttCloseParanthesis ||
      t1.type == eTokenType.ttCloseBracket
    ) {
      if (withParenthesis) {
        if (t1.type == eTokenType.ttCloseParanthesis) {
          node.UpdateSourcePos(t1.pos, t1.length);
        } else {
          const str = format(
            TXT_UNEXPECTED_TOKEN_s,
            asCTokenizer.GetDefinition(eTokenType.ttCloseBracket)
          );

          this.Error(str, t1);
        }
      } else {
        this.RewindTo(t1);
      }

      // Argument list has ended
      return node;
    } else {
      this.RewindTo(t1);

      for (;;) {
        // Determine if this is a named argument
        let tl = this.GetToken();
        let t2 = this.GetToken();
        this.RewindTo(tl);

        // Named arguments uses the syntax: arg : expr
        // This avoids confusion when the argument has the same name as a local variable, i.e. var = expr
        // It also avoids conflict with expressions to that creates anonymous objects initialized with lists, i.e. type = {...}
        // The alternate syntax: arg = expr, is supported to provide backwards compatibility with 2.29.0
        // TODO: 3.0.0: Remove the alternate syntax
        if (tl.type == eTokenType.ttIdentifier && (t2.type == eTokenType.ttColon || (this.config.ep.alterSyntaxNamedArgs && t2.type == eTokenType.ttAssignment))) {
            const named = this.CreateNode(eScriptNode.snNamedArgument);

            node.AddChildLast(named);

            named.AddChildLast(this.ParseIdentifier());
            t2 = this.GetToken();

            if (this.config.ep.alterSyntaxNamedArgs && t2.type == eTokenType.ttAssignment)
                this.Warning(TXT_NAMED_ARGS_WITH_OLD_SYNTAX, t2);

            named.AddChildLast(this.ParseAssignment());
        } else {
            node.AddChildLast(this.ParseAssignment());
        }

        if (this.isSyntaxError) return node;

        // Check if list continues
        t1 = this.GetToken();
        if (t1.type == eTokenType.ttListSeparator) {
            continue;
        } else {
          if (withParenthesis) {
            if (t1.type == eTokenType.ttCloseParanthesis) {
              node.UpdateSourcePos(t1.pos, t1.length);
            } else {
              this.Error(this.ExpectedTokens(')', ','), t1);
              this.Error(this.InsteadFound(t1), t1);
            }
          } else {
            this.RewindTo(t1);
          }
          return node;
        }
      }
    }
  }

  // 1887
  IsFunctionCall() {
    let s;
    let t1, t2;

    s = this.GetToken();
    t1 = s;

    // A function call may be prefixed with scope resolution
    if (t1.type == eTokenType.ttScope) {
      t1 = this.GetToken();
    }
    t2 = this.GetToken();

    while (
      t1.type == eTokenType.ttIdentifier &&
      t2.type == eTokenType.ttScope
    ) {
      t1 = this.GetToken();
      t2 = this.GetToken();
    }

    // A function call starts with an identifier followed by an argument list
    // The parser doesn't have enough information about scope to determine if the
    // identifier is a datatype, so even if it happens to be the parser will
    // identify the expression as a function call rather than a construct call.
    // The compiler will sort this out later
    if (t1.type != eTokenType.ttIdentifier) {
      this.RewindTo(s);
      return false;
    }

    if (t2.type == eTokenType.ttOpenParanthesis) {
      this.RewindTo(s);
      return true;
    }

    this.RewindTo(s);
    return false;
  }

  ParseAssignment() {
    let node = this.CreateNode(eScriptNode.snAssignment);

    node.AddChildLast(this.ParseCondition());
    if (this.isSyntaxError) return node;

    let t = this.GetToken();
    this.RewindTo(t);

    if (this.IsAssignOperator(t.type)) {
      node.AddChildLast(this.ParseAssignOperator());
      if (this.isSyntaxError) return node;

      node.AddChildLast(this.ParseAssignment());
      if (this.isSyntaxError) return node;
    }

    return node;
  }

  // 1953
  ParseCondition() {
    let node = this.CreateNode(eScriptNode.snCondition);

    node.AddChildLast(this.ParseExpression());
    if (this.isSyntaxError) return node;

    let t = this.GetToken();
    if (t.type == eTokenType.ttQuestion) {
      node.AddChildLast(this.ParseAssignment());
      if (this.isSyntaxError) return node;

      t = this.GetToken();
      if (t.type != eTokenType.ttColon) {
        this.Error(this.ExpectedToken(':'), t);
        this.Error(this.InsteadFound(t), t);
        return node;
      }

      node.AddChildLast(this.ParseAssignment());
      if (this.isSyntaxError) return node;
    } else {
      this.RewindTo(t);
    }

    return node;
  }

  ParseExpression(): ScriptNode;
  ParseExpression(in_script: ScriptCode): number;
  ParseExpression(in_script?: ScriptCode): ScriptNode | number {
    if (!in_script) {
      // 1986
      let node = this.CreateNode(eScriptNode.snExpression);

      node.AddChildLast(this.ParseExprTerm());
      if (this.isSyntaxError) return node;

      for (;;) {
        let t = this.GetToken();
        this.RewindTo(t);

        if (!this.IsOperator(t.type)) return node;

        node.AddChildLast(this.ParseExprOperator());
        if (this.isSyntaxError) return node;

        node.AddChildLast(this.ParseExprTerm());
        if (this.isSyntaxError) return node;
      }
    } else {
      // 2311
      this.Reset();

      this.script = in_script;

      this.checkValidTypes = true;

      this.scriptNode = this.ParseExpression();
      if (this.errorWhileParsing) {
        return -1;
      }

      return 0;
    }
  }

  // 2013
  ParseExprTerm() {
    let node = this.CreateNode(eScriptNode.snExprTerm);

    // Check if the expression term is an initialization of a temp object with init list, i.e. type = {...}
    let t = this.GetToken();
    let t2 = t;
    let t3;

    if (this.IsDataType(t2) && this.CheckTemplateType(t2)) {
      // The next token must be a = followed by a {
      t2 = this.GetToken();
      t3 = this.GetToken();
      if (
        t2.type == eTokenType.ttAssignment &&
        t3.type == eTokenType.ttStartStatementBlock
      ) {
        // It is an initialization, now parse it for real
        this.RewindTo(t);
        node.AddChildLast(this.ParseType(false));
        t2 = this.GetToken();
        node.AddChildLast(this.ParseInitList());
        return node;
      }
    } else if (t.type == eTokenType.ttStartStatementBlock) {
      // Or an anonymous init list, i.e. {...}
      this.RewindTo(t);
      node.AddChildLast(this.ParseInitList());
      return node;
    }

    // It wasn't an initialization, so it must be an ordinary expression term
    this.RewindTo(t);

    for (;;) {
      t = this.GetToken();
      this.RewindTo(t);
      if (!this.IsPreOperator(t.type)) {
        break;
      }

      node.AddChildLast(this.ParseExprPreOp());
      if (this.isSyntaxError) return node;
    }

    node.AddChildLast(this.ParseExprValue());
    if (this.isSyntaxError) return node;

    for (;;) {
      t = this.GetToken();
      this.RewindTo(t);
      if (!this.IsPostOperator(t.type)) {
        return node;
      }

      node.AddChildLast(this.ParseExprPostOp());
      if (this.isSyntaxError) return node;
    }
  }

  // 2077
  ParseExprPreOp() {
    let node = this.CreateNode(eScriptNode.snExprPreOp);

    const t = this.GetToken();
    if (!this.IsPreOperator(t.type)) {
      this.Error(TXT_EXPECTED_PRE_OPERATOR, t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.SetToken(t);
    node.UpdateSourcePos(t.pos, t.length);

    return node;
  }

  // 2098
  ParseExprPostOp() {
    let node = this.CreateNode(eScriptNode.snExprPostOp);

    let t = this.GetToken();
    if (!this.IsPostOperator(t.type)) {
      this.Error(TXT_EXPECTED_POST_OPERATOR, t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.SetToken(t);
    node.UpdateSourcePos(t.pos, t.length);

    if (t.type == eTokenType.ttDot) {
      let t1 = this.GetToken();
      let t2 = this.GetToken();
      this.RewindTo(t1);
      if (t2.type == eTokenType.ttOpenParanthesis) {
        node.AddChildLast(this.ParseFunctionCall());
      } else {
        node.AddChildLast(this.ParseIdentifier());
      }
    } else if (t.type == eTokenType.ttOpenBracket) {
      node.AddChildLast(this.ParseArgList(false));

      t = this.GetToken();
      if (t.type != eTokenType.ttCloseBracket) {
        this.Error(this.ExpectedToken(']'), t);
        this.Error(this.InsteadFound(t), t);
        return node;
      }

      node.UpdateSourcePos(t.pos, t.length);
    } else if (t.type == eTokenType.ttOpenParanthesis) {
      this.RewindTo(t);
      node.AddChildLast(this.ParseArgList());
    }

    return node;
  }

  // 2154
  ParseExprOperator() {
    let node = this.CreateNode(eScriptNode.snExprOperator);

    let t = this.GetToken();
    if (!this.IsOperator(t.type)) {
      this.Error(TXT_EXPECTED_OPERATOR, t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.SetToken(t);
    node.UpdateSourcePos(t.pos, t.length);

    return node;
  }

  // 2175
  ParseAssignOperator() {
    let node = this.CreateNode(eScriptNode.snExprOperator);

    let t = this.GetToken();
    if (!this.IsAssignOperator(t.type)) {
      this.Error(TXT_EXPECTED_OPERATOR, t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.SetToken(t);
    node.UpdateSourcePos(t.pos, t.length);

    return node;
  }

  // 2195
  IsOperator(tokenType: number) {
    return (
      tokenType == eTokenType.ttPlus ||
      tokenType == eTokenType.ttMinus ||
      tokenType == eTokenType.ttStar ||
      tokenType == eTokenType.ttSlash ||
      tokenType == eTokenType.ttPercent ||
      tokenType == eTokenType.ttStarStar ||
      tokenType == eTokenType.ttAnd ||
      tokenType == eTokenType.ttOr ||
      tokenType == eTokenType.ttXor ||
      tokenType == eTokenType.ttEqual ||
      tokenType == eTokenType.ttNotEqual ||
      tokenType == eTokenType.ttLessThan ||
      tokenType == eTokenType.ttLessThanOrEqual ||
      tokenType == eTokenType.ttGreaterThan ||
      tokenType == eTokenType.ttGreaterThanOrEqual ||
      tokenType == eTokenType.ttAmp ||
      tokenType == eTokenType.ttBitOr ||
      tokenType == eTokenType.ttBitXor ||
      tokenType == eTokenType.ttBitShiftLeft ||
      tokenType == eTokenType.ttBitShiftRight ||
      tokenType == eTokenType.ttBitShiftRightArith ||
      tokenType == eTokenType.ttIs ||
      tokenType == eTokenType.ttNotIs
    );
  }

  // 2225
  IsAssignOperator(tokenType: number) {
    return (
      tokenType == eTokenType.ttAssignment ||
      tokenType == eTokenType.ttAddAssign ||
      tokenType == eTokenType.ttSubAssign ||
      tokenType == eTokenType.ttMulAssign ||
      tokenType == eTokenType.ttDivAssign ||
      tokenType == eTokenType.ttModAssign ||
      tokenType == eTokenType.ttPowAssign ||
      tokenType == eTokenType.ttAndAssign ||
      tokenType == eTokenType.ttOrAssign ||
      tokenType == eTokenType.ttXorAssign ||
      tokenType == eTokenType.ttShiftLeftAssign ||
      tokenType == eTokenType.ttShiftRightLAssign ||
      tokenType == eTokenType.ttShiftRightAAssign
    );
  }

  // 2245
  IsPreOperator(tokenType: number) {
    return (
      tokenType == eTokenType.ttMinus ||
      tokenType == eTokenType.ttPlus ||
      tokenType == eTokenType.ttNot ||
      tokenType == eTokenType.ttInc ||
      tokenType == eTokenType.ttDec ||
      tokenType == eTokenType.ttBitNot ||
      tokenType == eTokenType.ttHandle
    );
  }

  // 2258
  IsPostOperator(tokenType: number) {
    return (
      tokenType == eTokenType.ttInc ||
      tokenType == eTokenType.ttDec ||
      tokenType == eTokenType.ttDot ||
      tokenType == eTokenType.ttOpenBracket ||
      tokenType == eTokenType.ttOpenParanthesis
    );
  }

  // 2269
  IsConstant(tokenType: number) {
    return (
      tokenType == eTokenType.ttIntConstant ||
      tokenType == eTokenType.ttFloatConstant ||
      tokenType == eTokenType.ttDoubleConstant ||
      tokenType == eTokenType.ttStringConstant ||
      tokenType == eTokenType.ttMultilineStringConstant ||
      tokenType == eTokenType.ttHeredocStringConstant ||
      tokenType == eTokenType.ttTrue ||
      tokenType == eTokenType.ttFalse ||
      tokenType == eTokenType.ttBitsConstant ||
      tokenType == eTokenType.ttNull
    );
  }

  // 2286
  ParseScript(in_script: ScriptCode): number;
  // 2395
  ParseScript(inBlock: boolean): ScriptNode;
  ParseScript(arg: ScriptCode | boolean): number | ScriptNode {
    if (arg instanceof ScriptCode) {
      const in_script = arg;

      this.Reset();

      this.script = in_script;

      this.scriptNode = this.ParseScript(false);

      if (this.errorWhileParsing) {
        return -1;
      }

      return 0;
    } else {
      const inBlock = arg;
      let node = this.CreateNode(eScriptNode.snScript);

      // Determine type of node
      for (;;) {
        while (!this.isSyntaxError) {
          let tStart = this.GetToken();

          // Optimize by skipping tokens 'shared', 'external', 'final', 'abstract' so they don't have to be checked in every condition
          let t1 = tStart;
          while (
            this.IdentifierIs(t1, SHARED_TOKEN) ||
            this.IdentifierIs(t1, EXTERNAL_TOKEN) ||
            this.IdentifierIs(t1, FINAL_TOKEN) ||
            this.IdentifierIs(t1, ABSTRACT_TOKEN)
          ) {
            t1 = this.GetToken();
          }
          this.RewindTo(tStart);

          if (t1.type == eTokenType.ttImport) {
            node.AddChildLast(this.ParseImport());
          } else if (t1.type == eTokenType.ttEnum) {
            node.AddChildLast(this.ParseEnumeration()); // Handle enumerations
          } else if (t1.type == eTokenType.ttTypedef) {
            node.AddChildLast(this.ParseTypedef()); // Handle primitive typedefs
          } else if (t1.type == eTokenType.ttClass) {
            node.AddChildLast(this.ParseClass());
          } else if (t1.type == eTokenType.ttMixin) {
            node.AddChildLast(this.ParseMixin());
          } else if (t1.type == eTokenType.ttInterface) {
            node.AddChildLast(this.ParseInterface());
          } else if (t1.type == eTokenType.ttFuncDef) {
            node.AddChildLast(this.ParseFuncDef());
          } else if (
            t1.type == eTokenType.ttConst ||
            t1.type == eTokenType.ttScope ||
            t1.type == eTokenType.ttAuto ||
            this.IsDataType(t1)
          ) {
            if (this.IsVirtualPropertyDecl()) {
              node.AddChildLast(this.ParseVirtualPropertyDecl(false, false));
            } else if (this.IsVarDecl()) {
              node.AddChildLast(this.ParseDeclaration(false, true));
            } else {
              node.AddChildLast(this.ParseFunction());
            }
          } else if (t1.type == eTokenType.ttEndStatement) {
            // Ignore a semicolon by itself
            t1 = this.GetToken();
          } else if (t1.type == eTokenType.ttNamespace) {
            node.AddChildLast(this.ParseNamespace());
          } else if (t1.type == eTokenType.ttEnd) {
            return node;
          } else if (inBlock && t1.type == eTokenType.ttEndStatementBlock) {
            return node;
          } else {
            let t = asCTokenizer.GetDefinition(t1.type);
            if (!t) {
              t = '<unknown token>';
            }

            this.Error(format(TXT_UNEXPECTED_TOKEN_s, t), t1);
          }
        }

        if (this.isSyntaxError) {
          // Search for either ';' or '{' or end
          let t1 = this.GetToken();
          while (
            t1.type != eTokenType.ttEndStatement &&
            t1.type != eTokenType.ttEnd &&
            t1.type != eTokenType.ttStartStatementBlock
          ) {
            t1 = this.GetToken();
          }

          if (t1.type == eTokenType.ttStartStatementBlock) {
            // Find the end of the block and skip nested blocks
            let level = 1;
            while (level > 0) {
              t1 = this.GetToken();
              if (t1.type == eTokenType.ttStartStatementBlock) level++;
              if (t1.type == eTokenType.ttEndStatementBlock) level--;
              if (t1.type == eTokenType.ttEnd) break;
            }
          }

          this.isSyntaxError = false;
        }
      }
    }
  }

  // 2327
  ParseImport() {
    let node = this.CreateNode(eScriptNode.snImport);

    let t = this.GetToken();

    if (t.type != eTokenType.ttImport) {
      this.Error(
        this.ExpectedToken(asCTokenizer.GetDefinition(eTokenType.ttImport)),
        t
      );
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.SetToken(t);
    node.UpdateSourcePos(t.pos, t.length);

    node.AddChildLast(this.ParseFunctionDefinition());
    if (this.isSyntaxError) return node;

    t = this.GetToken();
    if (t.type != eTokenType.ttIdentifier) {
      this.Error(this.ExpectedToken(FROM_TOKEN), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    if (this.script && this.script.code.substr(t.pos, t.length) != FROM_TOKEN) {
      this.Error(this.ExpectedToken(FROM_TOKEN), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.UpdateSourcePos(t.pos, t.length);

    t = this.GetToken();
    if (t.type != eTokenType.ttStringConstant) {
      this.Error(TXT_EXPECTED_STRING, t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    let mod = this.CreateNode(eScriptNode.snConstant);

    node.AddChildLast(mod);

    mod.SetToken(t);
    mod.UpdateSourcePos(t.pos, t.length);

    t = this.GetToken();
    if (t.type != eTokenType.ttEndStatement) {
      this.Error(
        this.ExpectedToken(asCTokenizer.GetDefinition(eTokenType.ttEndStatement)),
        t
      );
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.UpdateSourcePos(t.pos, t.length);

    return node;
  }

  // 2492
  ParseNamespace() {
    let node = this.CreateNode(eScriptNode.snNamespace);

    let t1 = this.GetToken();

    if (t1.type == eTokenType.ttNamespace) {
      node.UpdateSourcePos(t1.pos, t1.length);
    } else {
      this.Error(
        this.ExpectedToken(asCTokenizer.GetDefinition(eTokenType.ttNamespace)),
        t1
      );
      this.Error(this.InsteadFound(t1), t1);
    }

    node.AddChildLast(this.ParseIdentifier());
    if (this.isSyntaxError) return node;

    let lowestNode = node;
    t1 = this.GetToken();
    while (t1.type == eTokenType.ttScope) {
      lowestNode.UpdateSourcePos(t1.pos, t1.length);

      let scopeNode = this.CreateNode(eScriptNode.snScript);
      lowestNode.AddChildLast(scopeNode);

      lowestNode = this.CreateNode(eScriptNode.snNamespace);

      scopeNode.AddChildLast(lowestNode);
      lowestNode.AddChildLast(this.ParseIdentifier());
      if (this.isSyntaxError) return node;

      t1 = this.GetToken();
    }

    if (t1.type == eTokenType.ttStartStatementBlock) {
      node.UpdateSourcePos(t1.pos, t1.length);
    } else {
      this.Error(
        this.ExpectedToken(
          asCTokenizer.GetDefinition(eTokenType.ttStartStatementBlock)
        ),
        t1
      );
      this.Error(this.InsteadFound(t1), t1);
      return node;
    }

    let start = t1;

    lowestNode.AddChildLast(this.ParseScript(true));

    if (!this.isSyntaxError) {
      t1 = this.GetToken();
      if (t1.type == eTokenType.ttEndStatementBlock) {
        node.UpdateSourcePos(t1.pos, t1.length);
      } else {
        if (t1.type == eTokenType.ttEnd) {
          this.Error(TXT_UNEXPECTED_END_OF_FILE, t1);
        } else {
          this.Error(
            this.ExpectedToken(
              asCTokenizer.GetDefinition(eTokenType.ttEndStatementBlock)
            ),
            t1
          );
          this.Error(this.InsteadFound(t1), t1);
        }
        this.Info(TXT_WHILE_PARSING_NAMESPACE, start);
        return node;
      }
    }

    return node;
  }

  // 2569
  ParseStatementBlock(): ScriptNode;
  ParseStatementBlock(in_script: ScriptCode, in_block: ScriptNode): number;
  ParseStatementBlock(
    in_script?: ScriptCode,
    in_block?: ScriptNode
  ): ScriptNode | number {
    if (in_script && in_block) {
      this.Reset();

      // Tell the parser to validate the identifiers as valid types
      this.checkValidTypes = true;

      this.script = in_script;
      this.sourcePos = in_block.tokenPos;

      this.scriptNode = this.ParseStatementBlock();

      if (this.isSyntaxError || this.errorWhileParsing) {
        return -1;
      }

      return 0;
    } else {
      let node = this.CreateNode(eScriptNode.snStatementBlock);

      let t1 = this.GetToken();
      if (t1.type != eTokenType.ttStartStatementBlock) {
        this.Error(this.ExpectedToken('{'), t1);
        this.Error(this.InsteadFound(t1), t1);
        return node;
      }

      let start = t1;

      node.UpdateSourcePos(t1.pos, t1.length);

      for (;;) {
        while (!this.isSyntaxError) {
          t1 = this.GetToken();
          if (t1.type == eTokenType.ttEndStatementBlock) {
            node.UpdateSourcePos(t1.pos, t1.length);

            // Statement block is finished
            return node;
          } else {
            this.RewindTo(t1);

            if (this.IsVarDecl()) {
              node.AddChildLast(this.ParseDeclaration());
            } else {
              const tmp = this.ParseStatement();
              if (tmp) {
                node.AddChildLast(tmp);
              }
            }
          }
        }

        if (this.isSyntaxError) {
          // Search for either ';', '{', '}', or end
          t1 = this.GetToken();
          while (
            t1.type != eTokenType.ttEndStatement &&
            t1.type != eTokenType.ttEnd &&
            t1.type != eTokenType.ttStartStatementBlock &&
            t1.type != eTokenType.ttEndStatementBlock
          ) {
            t1 = this.GetToken();
          }

          // Skip this statement block
          if (t1.type == eTokenType.ttStartStatementBlock) {
            // Find the end of the block and skip nested blocks
            let level = 1;
            while (level > 0) {
              t1 = this.GetToken();
              if (t1.type == eTokenType.ttStartStatementBlock) level++;
              if (t1.type == eTokenType.ttEndStatementBlock) level--;
              if (t1.type == eTokenType.ttEnd) break;
            }
          } else if (t1.type == eTokenType.ttEndStatementBlock) {
            this.RewindTo(t1);
          } else if (t1.type == eTokenType.ttEnd) {
            this.Error(TXT_UNEXPECTED_END_OF_FILE, t1);
            this.Info(TXT_WHILE_PARSING_STATEMENT_BLOCK, start);
            return node;
          }

          this.isSyntaxError = false;
        }
      }
    }
  }

  // 2590
  ParseEnumeration() {
    let ident: ScriptNode;
    let dataType: ScriptNode;

    let node = this.CreateNode(eScriptNode.snEnum);

    // Optional 'shared' and 'external' token
    let token = this.GetToken();

    while (
      this.IdentifierIs(token, SHARED_TOKEN) ||
      this.IdentifierIs(token, EXTERNAL_TOKEN)
    ) {
      this.RewindTo(token);
      node.AddChildLast(this.ParseIdentifier());
      if (this.isSyntaxError) return node;

      token = this.GetToken();
    }

    // Check for enum
    if (token.type != eTokenType.ttEnum) {
      this.Error(
        this.ExpectedToken(asCTokenizer.GetDefinition(eTokenType.ttEnum)),
        token
      );
      this.Error(this.InsteadFound(token), token);
      return node;
    }

    node.SetToken(token);
    node.UpdateSourcePos(token.pos, token.length);

    // Get the identifier
    token = this.GetToken();
    if (eTokenType.ttIdentifier != token.type) {
      this.Error(TXT_EXPECTED_IDENTIFIER, token);
      this.Error(this.InsteadFound(token), token);
      return node;
    }

    dataType = this.CreateNode(eScriptNode.snDataType);

    node.AddChildLast(dataType);

    ident = this.CreateNode(eScriptNode.snIdentifier);

    ident.SetToken(token);
    ident.UpdateSourcePos(token.pos, token.length);
    dataType.AddChildLast(ident);

    // External shared declarations are ended with ';'
    token = this.GetToken();
    if (token.type == eTokenType.ttEndStatement) {
      this.RewindTo(token);
      node.AddChildLast(this.ParseToken(eTokenType.ttEndStatement));
      return node;
    }

    // check for the start of the declaration block
    if (token.type != eTokenType.ttStartStatementBlock) {
      this.RewindTo(token);
      const tokens = [
        eTokenType.ttStartStatementBlock,
        eTokenType.ttEndStatement,
      ];
      this.Error(this.ExpectedOneOf(tokens, 2), token);
      this.Error(this.InsteadFound(token), token);
      return node;
    }

    // typescript error: token.type != eTokenType.ttEnd
    while (true) {
      token = this.GetToken();

      if (token.type == eTokenType.ttEndStatementBlock) {
        this.RewindTo(token);
        break;
      }

      if (token.type == eTokenType.ttIdentifier) {
        this.Error(TXT_EXPECTED_IDENTIFIER, token);
        this.Error(this.InsteadFound(token), token);
        return node;
      }

      // Add the enum element
      ident = this.CreateNode(eScriptNode.snIdentifier);

      ident.SetToken(token);
      ident.UpdateSourcePos(token.pos, token.length);
      node.AddChildLast(ident);

      token = this.GetToken();

      if (token.type == eTokenType.ttAssignment) {
        this.RewindTo(token);

        let tmp = this.SuperficiallyParseVarInit();

        node.AddChildLast(tmp);
        if (this.isSyntaxError) return node;

        token = this.GetToken();
      }

      if (token.type != eTokenType.ttListSeparator) {
        this.RewindTo(token);
        break;
      }
    }

    // check for the end of the declaration block
    token = this.GetToken();
    if (token.type != eTokenType.ttEndStatementBlock) {
      this.RewindTo(token);
      this.Error(this.ExpectedToken('}'), token);
      this.Error(this.InsteadFound(token), token);
      return node;
    }

    return node;
  }

  // 2723
  IsVarDecl() {
    // Set start point so that we can rewind
    let t = this.GetToken();
    this.RewindTo(t);

    // A class property decl can be preceded by 'private' or 'protected'
    let t1: sToken | null = this.GetToken();
    if (t1.type != eTokenType.ttPrivate && t1.type != eTokenType.ttProtected) {
      this.RewindTo(t1);
    }

    // A variable decl starts with the type
    t1 = this.IsType();
    if (!t1) {
      this.RewindTo(t);
      return false;
    }

    // Jump to the token after the type
    this.RewindTo(t1);
    t1 = this.GetToken();

    // The declaration needs to have a name
    if (t1.type != eTokenType.ttIdentifier) {
      this.RewindTo(t);
      return false;
    }

    // It can be followed by an initialization
    t1 = this.GetToken();
    if (
      t1.type == eTokenType.ttEndStatement ||
      t1.type == eTokenType.ttAssignment ||
      t1.type == eTokenType.ttListSeparator
    ) {
      this.RewindTo(t);
      return true;
    }

    if (t1.type == eTokenType.ttOpenParanthesis) {
      // If the closing parenthesis is followed by a statement block,
      // function decorator, or end-of-file, then treat it as a function.
      // A function decl may have nested parenthesis so we need to check
      // for this too.
      let nest = 0;
      while (t1.type != eTokenType.ttEnd) {
        if (t1.type == eTokenType.ttOpenParanthesis) {
          nest++;
        } else if (t1.type == eTokenType.ttCloseParanthesis) {
          nest--;
          if (nest == 0) {
            break;
          }
        }
        t1 = this.GetToken();
      }

      if (t1.type == eTokenType.ttEnd) {
        this.RewindTo(t);
        return false;
      } else {
        t1 = this.GetToken();
        this.RewindTo(t);
        if (
          t1.type == eTokenType.ttStartStatementBlock ||
          t1.type == eTokenType.ttIdentifier ||
          t1.type == eTokenType.ttEnd
        ) {
          return false;
        }
      }

      this.RewindTo(t);
      return true;
    }

    this.RewindTo(t);
    return false;
  }

  // 2804
  IsVirtualPropertyDecl() {
    // Set start point so that we can rewind
    let t = this.GetToken();
    this.RewindTo(t);

    // A class property decl can be preceded by 'private' or 'protected'
    let t1: sToken | null = this.GetToken();
    if (t1.type != eTokenType.ttPrivate && t1.type != eTokenType.ttProtected) {
      this.RewindTo(t1);
    }

    // A variable decl starts with the type
    t1 = this.IsType();
    if (!t1) {
      this.RewindTo(t);
      return false;
    }

    // Move to the token after the type
    this.RewindTo(t1);
    t1 = this.GetToken();

    // The decl must have an identifier
    if (t1.type != eTokenType.ttIdentifier) {
      this.RewindTo(t);
      return false;
    }

    // To be a virtual property it must also have a block for the get/set functions
    t1 = this.GetToken();
    if (t1.type == eTokenType.ttStartStatementBlock) {
      this.RewindTo(t);
      return true;
    }

    this.RewindTo(t);
    return false;
  }

  // 2847
  IsFuncDecl(isMethod: boolean) {
    // Set start point so that we can rewind
    let t = this.GetToken();
    this.RewindTo(t);

    if (isMethod) {
      // A class method decl can be preceded by 'private' or 'protected'
      let t1 = this.GetToken();
      if (
        t1.type != eTokenType.ttPrivate &&
        t1.type != eTokenType.ttProtected
      ) {
        this.RewindTo(t1);
      }

      // A class constructor starts with identifier followed by parenthesis
      // A class destructor starts with the ~ token
      t1 = this.GetToken();
      let t2 = this.GetToken();
      this.RewindTo(t1);
      if (
        (t1.type == eTokenType.ttIdentifier &&
          t2.type == eTokenType.ttOpenParanthesis) ||
        t1.type == eTokenType.ttBitNot
      ) {
        this.RewindTo(t);
        return true;
      }
    }

    // A function decl starts with a type
    let t1 = this.IsType();
    if (!t1) {
      this.RewindTo(t);
      return false;
    }

    // Move to the token after the type
    this.RewindTo(t1);
    t1 = this.GetToken();

    // There can be an ampersand if the function returns a reference
    if (t1.type == eTokenType.ttAmp) {
      this.RewindTo(t);
      return true;
    }

    if (t1.type != eTokenType.ttIdentifier) {
      this.RewindTo(t);
      return false;
    }

    t1 = this.GetToken();
    if (t1.type == eTokenType.ttOpenParanthesis) {
      // If the closing parenthesis is not followed by a
      // statement block then it is not a function.
      // It's possible that there are nested parenthesis due to default
      // arguments so this should be checked for.
      let nest = 0;
      t1 = this.GetToken();
      while (
        (nest || t1.type != eTokenType.ttCloseParanthesis) &&
        t1.type != eTokenType.ttEnd
      ) {
        if (t1.type == eTokenType.ttOpenParanthesis) {
          nest++;
        }
        if (t1.type == eTokenType.ttCloseParanthesis) {
          nest--;
        }

        t1 = this.GetToken();
      }

      if (t1.type == eTokenType.ttEnd) {
        return false;
      } else {
        if (isMethod) {
          // A class method can have a 'const' token after the parameter list
          t1 = this.GetToken();
          if (t1.type != eTokenType.ttConst) this.RewindTo(t1);
        }

        // A function may also have any number of additional attributes
        for (;;) {
          t1 = this.GetToken();
          if (
            !this.IdentifierIs(t1, FINAL_TOKEN) &&
            !this.IdentifierIs(t1, OVERRIDE_TOKEN) &&
            !this.IdentifierIs(t1, EXPLICIT_TOKEN) &&
            !this.IdentifierIs(t1, PROPERTY_TOKEN)
          ) {
            this.RewindTo(t1);
            break;
          }
        }

        t1 = this.GetToken();
        this.RewindTo(t);
        if (t1.type == eTokenType.ttStartStatementBlock) {
          return true;
        }
      }

      this.RewindTo(t);
      return false;
    }

    this.RewindTo(t);
    return false;
  }

  // 2959
  ParseFuncDef() {
    let node = this.CreateNode(eScriptNode.snFuncDef);

    // Allow keywords 'external' and 'shared' before 'interface'
    let t1 = this.GetToken();
    while (
      this.IdentifierIs(t1, SHARED_TOKEN) ||
      this.IdentifierIs(t1, EXTERNAL_TOKEN)
    ) {
      this.RewindTo(t1);
      node.AddChildLast(this.ParseIdentifier());
      if (this.isSyntaxError) return node;

      t1 = this.GetToken();
    }

    if (t1.type != eTokenType.ttFuncDef) {
      this.Error(asCTokenizer.GetDefinition(eTokenType.ttFuncDef), t1);
      return node;
    }

    node.SetToken(t1);

    node.AddChildLast(this.ParseType(true));
    if (this.isSyntaxError) return node;

    node.AddChildLast(this.ParseTypeMod(false));
    if (this.isSyntaxError) return node;

    node.AddChildLast(this.ParseIdentifier());
    if (this.isSyntaxError) return node;

    node.AddChildLast(this.ParseParameterList());
    if (this.isSyntaxError) return node;

    t1 = this.GetToken();
    if (t1.type != eTokenType.ttEndStatement) {
      this.Error(
        this.ExpectedToken(asCTokenizer.GetDefinition(eTokenType.ttEndStatement)),
        t1
      );
      this.Error(this.InsteadFound(t1), t1);
      return node;
    }

    node.UpdateSourcePos(t1.pos, t1.length);

    return node;
  }

  // 3011
  ParseFunction(isMethod: boolean = false) {
    let node = this.CreateNode(eScriptNode.snFunction);

    let t1 = this.GetToken();
    if (!isMethod) {
      // A global function can be marked as shared and external
      while (t1.type == eTokenType.ttIdentifier) {
        if (
          this.IdentifierIs(t1, SHARED_TOKEN) ||
          this.IdentifierIs(t1, EXTERNAL_TOKEN)
        ) {
          this.RewindTo(t1);
          node.AddChildLast(this.ParseIdentifier());
          if (this.isSyntaxError) return node;
        } else {
          break;
        }

        t1 = this.GetToken();
      }
    }

    // A class method can start with 'private' or 'protected'
    if (isMethod && t1.type == eTokenType.ttPrivate) {
      this.RewindTo(t1);
      node.AddChildLast(this.ParseToken(eTokenType.ttPrivate));
      t1 = this.GetToken();
    } else if (isMethod && t1.type == eTokenType.ttProtected) {
      this.RewindTo(t1);
      node.AddChildLast(this.ParseToken(eTokenType.ttProtected));
      t1 = this.GetToken();
    }
    if (this.isSyntaxError) return node;

    // If it is a global function, or a method, except constructor and destructor, then the return type is parsed
    let t2 = this.GetToken();
    this.RewindTo(t1);
    if (
      !isMethod ||
      (t1.type != eTokenType.ttBitNot &&
        t2.type != eTokenType.ttOpenParanthesis)
    ) {
      node.AddChildLast(this.ParseType(true));
      if (this.isSyntaxError) return node;

      node.AddChildLast(this.ParseTypeMod(false));
      if (this.isSyntaxError) return node;
    }

    // If this is a class destructor then it starts with ~, and no return type is declared
    if (isMethod && t1.type == eTokenType.ttBitNot) {
      node.AddChildLast(this.ParseToken(eTokenType.ttBitNot));
      if (this.isSyntaxError) return node;
    }

    node.AddChildLast(this.ParseIdentifier());
    if (this.isSyntaxError) return node;

    node.AddChildLast(this.ParseParameterList());
    if (this.isSyntaxError) return node;

    if (isMethod) {
      t1 = this.GetToken();
      this.RewindTo(t1);

      // Is the method a const?
      if (t1.type == eTokenType.ttConst)
        node.AddChildLast(this.ParseToken(eTokenType.ttConst));
    }

    // TODO: Should support abstract methods, in which case no statement block should be provided
    this.ParseMethodAttributes(node);
    if (this.isSyntaxError) return node;

    // External shared functions must be ended with ';'
    t1 = this.GetToken();
    this.RewindTo(t1);
    if (t1.type == eTokenType.ttEndStatement) {
      node.AddChildLast(this.ParseToken(eTokenType.ttEndStatement));
      return node;
    }

    // We should just find the end of the statement block here. The statements
    // will be parsed on request by the compiler once it starts the compilation.
    node.AddChildLast(this.SuperficiallyParseStatementBlock());

    return node;
  }

  // 3109
  ParseInterfaceMethod() {
    let node = this.CreateNode(eScriptNode.snFunction);

    node.AddChildLast(this.ParseType(true));
    if (this.isSyntaxError) return node;

    node.AddChildLast(this.ParseTypeMod(false));
    if (this.isSyntaxError) return node;

    node.AddChildLast(this.ParseIdentifier());
    if (this.isSyntaxError) return node;

    node.AddChildLast(this.ParseParameterList());
    if (this.isSyntaxError) return node;

    // Parse an optional const after the method definition
    let t1 = this.GetToken();
    this.RewindTo(t1);
    if (t1.type == eTokenType.ttConst) {
      node.AddChildLast(this.ParseToken(eTokenType.ttConst));
    }

    t1 = this.GetToken();
    if (t1.type != eTokenType.ttEndStatement) {
      this.Error(this.ExpectedToken(';'), t1);
      this.Error(this.InsteadFound(t1), t1);
      return node;
    }

    node.UpdateSourcePos(t1.pos, t1.length);

    return node;
  }

  ParseVirtualPropertyDecl(isMethod: boolean, isInterface: boolean) {
    let node = this.CreateNode(eScriptNode.snVirtualProperty);

    let t1 = this.GetToken();
    // unused variable: let t2 = this.GetToken();
    this.GetToken();
    this.RewindTo(t1);

    // A class method can start with 'private' or 'protected'
    if (isMethod && t1.type == eTokenType.ttPrivate) {
      node.AddChildLast(this.ParseToken(eTokenType.ttPrivate));
    } else if (isMethod && t1.type == eTokenType.ttProtected) {
      node.AddChildLast(this.ParseToken(eTokenType.ttProtected));
    }
    if (this.isSyntaxError) return node;

    node.AddChildLast(this.ParseType(true));
    if (this.isSyntaxError) return node;

    node.AddChildLast(this.ParseTypeMod(false));
    if (this.isSyntaxError) return node;

    node.AddChildLast(this.ParseIdentifier());
    if (this.isSyntaxError) return node;

    t1 = this.GetToken();
    if (t1.type != eTokenType.ttStartStatementBlock) {
      this.Error(this.ExpectedToken('{'), t1);
      this.Error(this.InsteadFound(t1), t1);
      return node;
    }

    for (;;) {
      t1 = this.GetToken();
      let accessorNode = null;

      if (
        this.IdentifierIs(t1, GET_TOKEN) ||
        this.IdentifierIs(t1, SET_TOKEN)
      ) {
        accessorNode = this.CreateNode(eScriptNode.snVirtualProperty);

        node.AddChildLast(accessorNode);

        this.RewindTo(t1);
        accessorNode.AddChildLast(this.ParseIdentifier());

        if (isMethod) {
          t1 = this.GetToken();
          this.RewindTo(t1);
          if (t1.type == eTokenType.ttConst) {
            accessorNode.AddChildLast(this.ParseToken(eTokenType.ttConst));
          }

          if (!isInterface) {
            this.ParseMethodAttributes(accessorNode);
            if (this.isSyntaxError) return node;
          }
        }

        if (!isInterface) {
          t1 = this.GetToken();
          if (t1.type == eTokenType.ttStartStatementBlock) {
            this.RewindTo(t1);
            accessorNode.AddChildLast(this.SuperficiallyParseStatementBlock());
            if (this.isSyntaxError) return node;
          } else if (t1.type != eTokenType.ttEndStatement) {
            this.Error(this.ExpectedTokens(';', '{'), t1);
            this.Error(this.InsteadFound(t1), t1);
            return node;
          }
        } else {
          t1 = this.GetToken();
          if (t1.type != eTokenType.ttEndStatement) {
            this.Error(this.ExpectedToken(';'), t1);
            this.Error(this.InsteadFound(t1), t1);
            return node;
          }
        }
      } else if (t1.type == eTokenType.ttEndStatementBlock) {
        break;
      } else {
        const tokens = [
          GET_TOKEN,
          SET_TOKEN,
          asCTokenizer.GetDefinition(eTokenType.ttEndStatementBlock),
        ];
        this.Error(this.ExpectedOneOf(tokens, 3), t1);
        this.Error(this.InsteadFound(t1), t1);
        return node;
      }
    }

    return node;
  }

  // 3252
  ParseInterface() {
    let node = this.CreateNode(eScriptNode.snInterface);

    // Allow keywords 'external' and 'shared' before 'interface'
    let t = this.GetToken();

    while (
      this.IdentifierIs(t, SHARED_TOKEN) ||
      this.IdentifierIs(t, EXTERNAL_TOKEN)
    ) {
      this.RewindTo(t);
      node.AddChildLast(this.ParseIdentifier());
      if (this.isSyntaxError) return node;

      t = this.GetToken();
    }

    if (t.type != eTokenType.ttInterface) {
      this.Error(this.ExpectedToken('interface'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.SetToken(t);
    node.AddChildLast(this.ParseIdentifier());

    // External shared declarations are ended with ';'
    t = this.GetToken();
    if (t.type == eTokenType.ttEndStatement) {
      this.RewindTo(t);
      node.AddChildLast(this.ParseToken(eTokenType.ttEndStatement));
      return node;
    }

    // Can optionally have a list of interfaces that are inherited
    if (t.type == eTokenType.ttColon) {
      let inherit = this.CreateNode(eScriptNode.snIdentifier);
      node.AddChildLast(inherit);

      this.ParseOptionalScope(inherit);
      inherit.AddChildLast(this.ParseIdentifier());
      t = this.GetToken();

      while (t.type == eTokenType.ttListSeparator) {
        inherit = this.CreateNode(eScriptNode.snIdentifier);
        node.AddChildLast(inherit);

        this.ParseOptionalScope(inherit);
        inherit.AddChildLast(this.ParseIdentifier());
        t = this.GetToken();
      }
    }

    if (t.type != eTokenType.ttStartStatementBlock) {
      this.Error(this.ExpectedToken('{'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    // Parse interface methods
    t = this.GetToken();
    this.RewindTo(t);

    while (
      t.type != eTokenType.ttEndStatementBlock &&
      t.type != eTokenType.ttEnd
    ) {
      if (this.IsVirtualPropertyDecl()) {
        node.AddChildLast(this.ParseVirtualPropertyDecl(true, true));
      } else if (t.type == eTokenType.ttEndStatement) {
        // Skip empty declarations
        t = this.GetToken();
      } else {
        // Parse the method signature
        node.AddChildLast(this.ParseInterfaceMethod());
      }

      if (this.isSyntaxError) return node;

      t = this.GetToken();
      this.RewindTo(t);
    }

    t = this.GetToken();

    if (t.type != eTokenType.ttEndStatementBlock) {
      this.Error(this.ExpectedToken('}'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.UpdateSourcePos(t.pos, t.length);

    return node;
  }

  ParseMixin() {
    let node = this.CreateNode(eScriptNode.snMixin);

    let t = this.GetToken();

    if (t.type != eTokenType.ttMixin) {
      this.Error(this.ExpectedToken('mixin'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.SetToken(t);

    // A mixin token must be followed by a class declaration
    node.AddChildLast(this.ParseClass());

    return node;
  }

  // 3375
  ParseClass() {
    let node = this.CreateNode(eScriptNode.snClass);

    let t = this.GetToken();

    // Allow the keywords 'shared', 'abstract', 'final', and 'external' before 'class'
    while (
      this.IdentifierIs(t, SHARED_TOKEN) ||
      this.IdentifierIs(t, ABSTRACT_TOKEN) ||
      this.IdentifierIs(t, FINAL_TOKEN) ||
      this.IdentifierIs(t, EXTERNAL_TOKEN)
    ) {
      this.RewindTo(t);
      node.AddChildLast(this.ParseIdentifier());
      t = this.GetToken();
    }

    if (t.type != eTokenType.ttClass) {
      this.Error(this.ExpectedToken('class'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.SetToken(t);

    if (this.config.ep.allowImplicitHandleTypes) {
      // Parse 'implicit handle class' construct
      t = this.GetToken();

      if (t.type == eTokenType.ttHandle) {
        node.SetToken(t);
      } else {
        this.RewindTo(t);
      }
    }

    node.AddChildLast(this.ParseIdentifier());

    // External shared declarations are ended with ';'
    t = this.GetToken();
    if (t.type == eTokenType.ttEndStatement) {
      this.RewindTo(t);
      node.AddChildLast(this.ParseToken(eTokenType.ttEndStatement));
      return node;
    }

    // Optional list of interfaces that are being implemented and classes that are being inherited
    if (t.type == eTokenType.ttColon) {
      let inherit = this.CreateNode(eScriptNode.snIdentifier);
      node.AddChildLast(inherit);

      this.ParseOptionalScope(inherit);
      inherit.AddChildLast(this.ParseIdentifier());
      t = this.GetToken();
      while (t.type == eTokenType.ttListSeparator) {
        inherit = this.CreateNode(eScriptNode.snIdentifier);
        node.AddChildLast(inherit);

        this.ParseOptionalScope(inherit);
        inherit.AddChildLast(this.ParseIdentifier());
        t = this.GetToken();
      }
    }

    if (t.type != eTokenType.ttStartStatementBlock) {
      this.Error(this.ExpectedToken('{'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    // Parse properties
    t = this.GetToken();
    this.RewindTo(t);

    while (
      t.type != eTokenType.ttEndStatementBlock &&
      t.type != eTokenType.ttEnd
    ) {
      // Is it a property or a method?
      if (t.type == eTokenType.ttFuncDef) {
        node.AddChildLast(this.ParseFuncDef());
      } else if (this.IsFuncDecl(true)) {
        node.AddChildLast(this.ParseFunction(true));
      } else if (this.IsVirtualPropertyDecl()) {
        node.AddChildLast(this.ParseVirtualPropertyDecl(true, false));
      } else if (this.IsVarDecl()) {
        node.AddChildLast(this.ParseDeclaration(true));
      } else if (t.type == eTokenType.ttEndStatement) {
        // Skip empty declarations
        t = this.GetToken();
      } else {
        this.Error(TXT_EXPECTED_METHOD_OR_PROPERTY, t);
        this.Error(this.InsteadFound(t), t);
        return node;
      }

      if (this.isSyntaxError) {
        return node;
      }

      t = this.GetToken();
      this.RewindTo(t);
    }

    t = this.GetToken();
    if (t.type != eTokenType.ttEndStatementBlock) {
      this.Error(this.ExpectedToken('}'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }
    node.UpdateSourcePos(t.pos, t.length);

    return node;
  }

  // 3495
  ParseVarInit(in_script: ScriptCode, in_init: ScriptNode) {
    this.Reset();

    // Tell the parser to validate the identifiers as valid types
    this.checkValidTypes = true;

    this.script = in_script;
    this.sourcePos = in_init.tokenPos;

    // If next token is assignment, parse expression
    let t = this.GetToken();

    if (t.type == eTokenType.ttAssignment) {
      t = this.GetToken();
      this.RewindTo(t);

      if (t.type == eTokenType.ttStartStatementBlock) {
        this.scriptNode = this.ParseInitList();
      } else {
        this.scriptNode = this.ParseAssignment();
      }
    } else if (t.type == eTokenType.ttOpenParanthesis) {
      this.RewindTo(t);
      this.scriptNode = this.ParseArgList();
    } else {
      const tokens = [eTokenType.ttAssignment, eTokenType.ttOpenParanthesis];
      this.Error(this.ExpectedOneOf(tokens, 2), t);
      this.Error(this.InsteadFound(t), t);
    }

    // Don't allow any more tokens after the expression
    t = this.GetToken();
    if (
      t.type != eTokenType.ttEnd &&
      t.type != eTokenType.ttEndStatement &&
      t.type != eTokenType.ttListSeparator &&
      t.type != eTokenType.ttEndStatementBlock
    ) {
      let msg = format(TXT_UNEXPECTED_TOKEN_s, asCTokenizer.GetDefinition(t.type));
      this.Error(msg, t);
    }

    if (this.isSyntaxError || this.errorWhileParsing) {
      return -1;
    }

    return 0;
  }

  // 3544
  SuperficiallyParseVarInit() {
    let node = this.CreateNode(eScriptNode.snAssignment);

    let t = this.GetToken();
    node.UpdateSourcePos(t.pos, t.length);

    if (t.type == eTokenType.ttAssignment) {
      t = this.GetToken();
      let start = t;

      // Find the end of the expression
      let indentParan = 0;
      let indentBrace = 0;

      while (
        indentParan ||
        indentBrace ||
        (t.type != eTokenType.ttListSeparator &&
          t.type != eTokenType.ttEndStatement &&
          t.type != eTokenType.ttEndStatementBlock)
      ) {
        if (t.type == eTokenType.ttOpenParanthesis) {
          indentParan++;
        } else if (t.type == eTokenType.ttCloseParanthesis) {
          indentParan--;
        } else if (t.type == eTokenType.ttStartStatementBlock) {
          indentBrace++;
        } else if (t.type == eTokenType.ttEndStatementBlock) {
          indentBrace--;
        } else if (t.type == eTokenType.ttNonTerminatedStringConstant) {
          this.Error(TXT_NONTERMINATED_STRING, t);
          break;
        } else if (t.type == eTokenType.ttEnd) {
          this.Error(TXT_UNEXPECTED_END_OF_FILE, t);
          this.Info(TXT_WHILE_PARSING_EXPRESSION, start);
          break;
        }
        t = this.GetToken();
      }

      // Rewind so that the next token read is the list separator, end statement, or end statement block
      this.RewindTo(t);
    } else if (t.type == eTokenType.ttOpenParanthesis) {
      let start = t;

      // Find the end of the argument list
      let indent = 1;
      while (indent) {
        t = this.GetToken();
        if (t.type == eTokenType.ttOpenParanthesis) {
          indent++;
        } else if (t.type == eTokenType.ttCloseParanthesis) {
          indent--;
        } else if (t.type == eTokenType.ttNonTerminatedStringConstant) {
          this.Error(TXT_NONTERMINATED_STRING, t);
          break;
        } else if (t.type == eTokenType.ttEnd) {
          this.Error(TXT_UNEXPECTED_END_OF_FILE, t);
          this.Info(TXT_WHILE_PARSING_ARG_LIST, start);
          break;
        }
      }
    } else {
      const tokens = [eTokenType.ttAssignment, eTokenType.ttOpenParanthesis];
      this.Error(this.ExpectedOneOf(tokens, 2), t);
      this.Error(this.InsteadFound(t), t);
    }

    return node;
  }

  // 3624
  SuperficiallyParseStatementBlock() {
    let node = this.CreateNode(eScriptNode.snStatementBlock);

    // This function will only superficially parse the statement block in order to find the end of it
    let t1 = this.GetToken();
    if (t1.type != eTokenType.ttStartStatementBlock) {
      this.Error(this.ExpectedToken('{'), t1);
      this.Error(this.InsteadFound(t1), t1);
      return node;
    }

    node.UpdateSourcePos(t1.pos, t1.length);

    let start = t1;

    let level = 1;

    while (level > 0 && !this.isSyntaxError) {
      t1 = this.GetToken();
      if (t1.type == eTokenType.ttEndStatementBlock) {
        level--;
      } else if (t1.type == eTokenType.ttStartStatementBlock) {
        level++;
      } else if (t1.type == eTokenType.ttNonTerminatedStringConstant) {
        this.Error(TXT_NONTERMINATED_STRING, t1);
        break;
      } else if (t1.type == eTokenType.ttEnd) {
        this.Error(TXT_UNEXPECTED_END_OF_FILE, t1);
        this.Info(TXT_WHILE_PARSING_STATEMENT_BLOCK, start);
        break;
      }
    }

    node.UpdateSourcePos(t1.pos, t1.length);

    return node;
  }

  // 3754
  ParseInitList() {
    let node = this.CreateNode(eScriptNode.snInitList);

    let t1 = this.GetToken();
    if (t1.type != eTokenType.ttStartStatementBlock) {
      this.Error(this.ExpectedToken('{'), t1);
      this.Error(this.InsteadFound(t1), t1);
      return node;
    }

    node.UpdateSourcePos(t1.pos, t1.length);

    t1 = this.GetToken();
    if (t1.type == eTokenType.ttEndStatementBlock) {
      node.UpdateSourcePos(t1.pos, t1.length);

      // Statement block is finished
      return node;
    } else {
      this.RewindTo(t1);
      for (;;) {
        t1 = this.GetToken();
        if (t1.type == eTokenType.ttListSeparator) {
          // No expression
          node.AddChildLast(this.CreateNode(eScriptNode.snUndefined));
          if (node.lastChild) {
            node.lastChild.UpdateSourcePos(t1.pos, 1);
          }

          t1 = this.GetToken();
          if (t1.type == eTokenType.ttEndStatementBlock) {
            // No expression
            node.AddChildLast(this.CreateNode(eScriptNode.snUndefined));
            if (node.lastChild) {
              node.lastChild.UpdateSourcePos(t1.pos, 1);
            }
            node.UpdateSourcePos(t1.pos, t1.length);
            return node;
          }
          this.RewindTo(t1);
        } else if (t1.type == eTokenType.ttEndStatementBlock) {
          // No expression
          node.AddChildLast(this.CreateNode(eScriptNode.snUndefined));
          if (node.lastChild) {
            node.lastChild.UpdateSourcePos(t1.pos, 1);
          }
          node.UpdateSourcePos(t1.pos, t1.length);

          // Statement block is finished
          return node;
        } else if (t1.type == eTokenType.ttStartStatementBlock) {
          this.RewindTo(t1);
          node.AddChildLast(this.ParseInitList());
          if (this.isSyntaxError) return node;

          t1 = this.GetToken();
          if (t1.type == eTokenType.ttListSeparator) {
            continue;
          } else if (t1.type == eTokenType.ttEndStatementBlock) {
            node.UpdateSourcePos(t1.pos, t1.length);

            // Statement block is finished
            return node;
          } else {
            this.Error(this.ExpectedTokens('}', ','), t1);
            this.Error(this.InsteadFound(t1), t1);
            return node;
          }
        } else {
          this.RewindTo(t1);
          node.AddChildLast(this.ParseAssignment());
          if (this.isSyntaxError) return node;

          t1 = this.GetToken();
          if (t1.type == eTokenType.ttListSeparator) {
            continue;
          } else if (t1.type == eTokenType.ttEndStatementBlock) {
            node.UpdateSourcePos(t1.pos, t1.length);

            // Statement block is finished
            return node;
          } else {
            this.Error(this.ExpectedTokens('}', ','), t1);
            this.Error(this.InsteadFound(t1), t1);
            return node;
          }
        }
      }
    }
  }

  // 3865
  ParseDeclaration(isClassProp: boolean = false, isGlobalVar: boolean = false) {
    let node = this.CreateNode(eScriptNode.snDeclaration);

    let t = this.GetToken();
    this.RewindTo(t);

    // A class property can be preceeded by private
    if (t.type == eTokenType.ttPrivate && isClassProp) {
      node.AddChildLast(this.ParseToken(eTokenType.ttPrivate));
    } else if (t.type == eTokenType.ttProtected && isClassProp) {
      node.AddChildLast(this.ParseToken(eTokenType.ttProtected));
    }

    // Parse data type
    node.AddChildLast(this.ParseType(true, false, !isClassProp));
    if (this.isSyntaxError) return node;

    for (;;) {
      // Parse identifier
      node.AddChildLast(this.ParseIdentifier());
      if (this.isSyntaxError) return node;

      if (isClassProp || isGlobalVar) {
        // Only superficially parse the initialization info for the class property
        t = this.GetToken();
        this.RewindTo(t);
        if (
          t.type == eTokenType.ttAssignment ||
          t.type == eTokenType.ttOpenParanthesis
        ) {
          node.AddChildLast(this.SuperficiallyParseVarInit());
          if (this.isSyntaxError) return node;
        }
      } else {
        // If next token is assignment, parse expression
        t = this.GetToken();
        if (t.type == eTokenType.ttOpenParanthesis) {
          this.RewindTo(t);
          node.AddChildLast(this.ParseArgList());
          if (this.isSyntaxError) return node;
        } else if (t.type == eTokenType.ttAssignment) {
          t = this.GetToken();
          this.RewindTo(t);
          if (t.type == eTokenType.ttStartStatementBlock) {
            node.AddChildLast(this.ParseInitList());
            if (this.isSyntaxError) return node;
          } else {
            node.AddChildLast(this.ParseAssignment());
            if (this.isSyntaxError) return node;
          }
        } else {
          this.RewindTo(t);
        }
      }

      // continue if list separator, else terminate with end statement
      t = this.GetToken();
      if (t.type == eTokenType.ttListSeparator) {
        continue;
      } else if (t.type == eTokenType.ttEndStatement) {
        node.UpdateSourcePos(t.pos, t.length);

        return node;
      } else {
        this.Error(this.ExpectedTokens(',', ';'), t);
        this.Error(this.InsteadFound(t), t);
        return node;
      }
    }
  }

  // 3951
  ParseStatement() {
    const t1 = this.GetToken();
    this.RewindTo(t1);

    if (t1.type == eTokenType.ttIf) {
      return this.ParseIf();
    } else if (t1.type == eTokenType.ttFor) {
      return this.ParseFor();
    } else if (t1.type == eTokenType.ttWhile) {
      return this.ParseWhile();
    } else if (t1.type == eTokenType.ttReturn) {
      return this.ParseReturn();
    } else if (t1.type == eTokenType.ttStartStatementBlock) {
      return this.ParseStatementBlock();
    } else if (t1.type == eTokenType.ttBreak) {
      return this.ParseBreak();
    } else if (t1.type == eTokenType.ttContinue) {
      return this.ParseContinue();
    } else if (t1.type == eTokenType.ttDo) {
      return this.ParseDoWhile();
    } else if (t1.type == eTokenType.ttSwitch) {
      return this.ParseSwitch();
    } else if (t1.type == eTokenType.ttTry) {
      return this.ParseTryCatch();
    } else {
      if (this.IsVarDecl()) {
        this.Error(TXT_UNEXPECTED_VAR_DECL, t1);
        return null;
      }
      return this.ParseExpressionStatement();
    }
  }

  // 3990
  ParseExpressionStatement() {
    let node = this.CreateNode(eScriptNode.snExpressionStatement);

    let t = this.GetToken();
    if (t.type == eTokenType.ttEndStatement) {
      node.UpdateSourcePos(t.pos, t.length);

      return node;
    }

    this.RewindTo(t);

    node.AddChildLast(this.ParseAssignment());
    if (this.isSyntaxError) return node;

    t = this.GetToken();

    if (t.type != eTokenType.ttEndStatement) {
      this.Error(this.ExpectedToken(';'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.UpdateSourcePos(t.pos, t.length);

    return node;
  }

  ParseSwitch() {
    let node = this.CreateNode(eScriptNode.snSwitch);

    let t = this.GetToken();
    if (t.type != eTokenType.ttSwitch) {
      this.Error(this.ExpectedToken('switch'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.UpdateSourcePos(t.pos, t.length);

    t = this.GetToken();

    if (t.type != eTokenType.ttOpenParanthesis) {
      this.Error(this.ExpectedToken('('), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.AddChildLast(this.ParseAssignment());
    if (this.isSyntaxError) return node;

    t = this.GetToken();
    if (t.type != eTokenType.ttCloseParanthesis) {
      this.Error(this.ExpectedToken(')'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    t = this.GetToken();
    if (t.type != eTokenType.ttStartStatementBlock) {
      this.Error(this.ExpectedToken('{'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    while (!this.isSyntaxError) {
      t = this.GetToken();

      if (t.type == eTokenType.ttEndStatementBlock) {
        break;
      }

      this.RewindTo(t);

      if (t.type != eTokenType.ttCase && t.type != eTokenType.ttDefault) {
        const tokens = ['case', 'default'];
        this.Error(this.ExpectedOneOf(tokens, 2), t);
        this.Error(this.InsteadFound(t), t);
        return node;
      }

      node.AddChildLast(this.ParseCase());
      if (this.isSyntaxError) return node;
    }

    if (t.type != eTokenType.ttEndStatementBlock) {
      this.Error(this.ExpectedToken('}'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    return node;
  }

  // 4098
  ParseCase() {
    let node = this.CreateNode(eScriptNode.snCase);

    let t = this.GetToken();
    if (t.type != eTokenType.ttCase && t.type != eTokenType.ttDefault) {
      this.Error(this.ExpectedTokens('case', 'default'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.UpdateSourcePos(t.pos, t.length);

    if (t.type == eTokenType.ttCase) {
      node.AddChildLast(this.ParseExpression());
    }

    t = this.GetToken();
    if (t.type != eTokenType.ttColon) {
      this.Error(this.ExpectedToken(':'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    // Parse statements until we find either of }, case, default, and break
    t = this.GetToken();
    this.RewindTo(t);
    while (
      t.type != eTokenType.ttCase &&
      t.type != eTokenType.ttDefault &&
      t.type != eTokenType.ttEndStatementBlock &&
      t.type != eTokenType.ttBreak
    ) {
      if (this.IsVarDecl()) {
        // Variable declarations are not allowed, but we parse it anyway to give a good error message
        node.AddChildLast(this.ParseDeclaration());
      } else {
        const tmp = this.ParseStatement();
        if (tmp) {
          node.AddChildLast(tmp);
        }
      }

      if (this.isSyntaxError) return node;

      t = this.GetToken();
      this.RewindTo(t);
    }

    // If the case was ended with a break statement, add it to the node
    if (t.type == eTokenType.ttBreak) {
      node.AddChildLast(this.ParseBreak());
    }

    return node;
  }

  // 4154
  ParseIf() {
    let node = this.CreateNode(eScriptNode.snIf);

    let t = this.GetToken();
    if (t.type != eTokenType.ttIf) {
      this.Error(this.ExpectedToken('if'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.UpdateSourcePos(t.pos, t.length);

    t = this.GetToken();
    if (t.type != eTokenType.ttOpenParanthesis) {
      this.Error(this.ExpectedToken('('), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.AddChildLast(this.ParseAssignment());
    if (this.isSyntaxError) return node;

    t = this.GetToken();

    if (t.type != eTokenType.ttCloseParanthesis) {
      this.Error(this.ExpectedToken(')'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    let tmp = this.ParseStatement();

    if (tmp) {
      node.AddChildLast(tmp);
    }

    if (this.isSyntaxError) return node;

    t = this.GetToken();
    if (t.type != eTokenType.ttElse) {
      // No else statement return already
      this.RewindTo(t);
      return node;
    }

    tmp = this.ParseStatement();

    if (tmp) {
      node.AddChildLast(tmp);
    }

    return node;
  }

  //  4206
  ParseTryCatch() {
    let node = this.CreateNode(eScriptNode.snTryCatch);

    let t = this.GetToken();
    if (t.type != eTokenType.ttTry) {
      this.Error(this.ExpectedToken('try'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.UpdateSourcePos(t.pos, t.length);

    node.AddChildLast(this.ParseStatementBlock());

    if (this.isSyntaxError) return node;

    t = this.GetToken();
    if (t.type != eTokenType.ttCatch) {
      this.Error(this.ExpectedToken('catch'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.AddChildLast(this.ParseStatementBlock());
    if (this.isSyntaxError) return node;

    return node;
  }

  // 4240
  ParseFor() {
    let node = this.CreateNode(eScriptNode.snFor);

    let t = this.GetToken();
    if (t.type != eTokenType.ttFor) {
      this.Error(this.ExpectedToken('for'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.UpdateSourcePos(t.pos, t.length);

    t = this.GetToken();
    if (t.type != eTokenType.ttOpenParanthesis) {
      this.Error(this.ExpectedToken('('), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    if (this.IsVarDecl()) {
      node.AddChildLast(this.ParseDeclaration());
    } else {
      node.AddChildLast(this.ParseExpressionStatement());
    }

    if (this.isSyntaxError) return node;

    node.AddChildLast(this.ParseExpressionStatement());
    if (this.isSyntaxError) return node;

    t = this.GetToken();
    if (t.type != eTokenType.ttCloseParanthesis) {
      this.RewindTo(t);

      // Parse N increment statements separated by ,
      for (;;) {
        const n = this.CreateNode(eScriptNode.snExpressionStatement);
        node.AddChildLast(n);
        n.AddChildLast(this.ParseAssignment());
        if (this.isSyntaxError) return node;

        t = this.GetToken();
        if (t.type == eTokenType.ttListSeparator) {
          continue;
        } else if (t.type == eTokenType.ttCloseParanthesis) {
          break;
        } else {
          const tokens = [',', ')'];
          this.Error(this.ExpectedOneOf(tokens, 2), t);
          this.Error(this.InsteadFound(t), t);
          return node;
        }
      }
    }

    const tmp = this.ParseStatement();

    if (tmp) {
      node.AddChildLast(tmp);
    }

    return node;
  }

  // 4308
  ParseWhile() {
    let node = this.CreateNode(eScriptNode.snWhile);

    let t = this.GetToken();

    if (t.type != eTokenType.ttWhile) {
      this.Error(this.ExpectedToken('while'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.UpdateSourcePos(t.pos, t.length);

    t = this.GetToken();
    if (t.type != eTokenType.ttOpenParanthesis) {
      this.Error(this.ExpectedToken('('), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.AddChildLast(this.ParseAssignment());
    if (this.isSyntaxError) return node;

    t = this.GetToken();
    if (t.type != eTokenType.ttCloseParanthesis) {
      this.Error(this.ExpectedToken(')'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    const tmp = this.ParseStatement();

    if (tmp) {
      node.AddChildLast(tmp);
    }

    return node;
  }

  // 4349
  ParseDoWhile() {
    let node = this.CreateNode(eScriptNode.snDoWhile);

    let t = this.GetToken();

    if (t.type != eTokenType.ttDo) {
      this.Error(this.ExpectedToken('do'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.UpdateSourcePos(t.pos, t.length);

    const tmp = this.ParseStatement();

    if (tmp) {
      node.AddChildLast(tmp);
    }

    if (this.isSyntaxError) return node;

    t = this.GetToken();

    if (t.type != eTokenType.ttWhile) {
      this.Error(this.ExpectedToken('while'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    t = this.GetToken();

    if (t.type != eTokenType.ttOpenParanthesis) {
      this.Error(this.ExpectedToken('('), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.AddChildLast(this.ParseAssignment());
    if (this.isSyntaxError) return node;

    t = this.GetToken();

    if (t.type != eTokenType.ttCloseParanthesis) {
      this.Error(this.ExpectedToken(')'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    t = this.GetToken();

    if (t.type != eTokenType.ttEndStatement) {
      this.Error(this.ExpectedToken(';'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.UpdateSourcePos(t.pos, t.length);

    return node;
  }

  // 4408
  ParseReturn() {
    let node = this.CreateNode(eScriptNode.snReturn);

    let t = this.GetToken();

    if (t.type != eTokenType.ttReturn) {
      this.Error(this.ExpectedToken('return'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.UpdateSourcePos(t.pos, t.length);

    t = this.GetToken();

    if (t.type == eTokenType.ttEndStatement) {
      node.UpdateSourcePos(t.pos, t.length);
      return node;
    }

    this.RewindTo(t);

    node.AddChildLast(this.ParseAssignment());

    if (this.isSyntaxError) return node;

    t = this.GetToken();
    if (t.type != eTokenType.ttEndStatement) {
      this.Error(this.ExpectedToken(';'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.UpdateSourcePos(t.pos, t.length);

    return node;
  }

  // 4450
  ParseBreak() {
    let node = this.CreateNode(eScriptNode.snBreak);

    let t = this.GetToken();
    if (t.type != eTokenType.ttBreak) {
      this.Error(this.ExpectedToken('break'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.UpdateSourcePos(t.pos, t.length);

    t = this.GetToken();

    if (t.type != eTokenType.ttEndStatement) {
      this.Error(this.ExpectedToken(';'), t);
      this.Error(this.InsteadFound(t), t);
    }

    node.UpdateSourcePos(t.pos, t.length);

    return node;
  }

  ParseContinue() {
    let node = this.CreateNode(eScriptNode.snContinue);

    let t = this.GetToken();
    if (t.type != eTokenType.ttContinue) {
      this.Error(this.ExpectedToken('continue'), t);
      this.Error(this.InsteadFound(t), t);
      return node;
    }

    node.UpdateSourcePos(t.pos, t.length);

    t = this.GetToken();
    if (t.type != eTokenType.ttEndStatement) {
      this.Error(this.ExpectedToken(';'), t);
      this.Error(this.InsteadFound(t), t);
    }

    node.UpdateSourcePos(t.pos, t.length);

    return node;
  }

  // 4509
  ParseTypedef() {
    // Create the typedef node
    let node = this.CreateNode(eScriptNode.snTypedef);

    let token = this.GetToken();

    if (token.type != eTokenType.ttTypedef) {
      this.Error(
        this.ExpectedToken(asCTokenizer.GetDefinition(eTokenType.ttTypedef)),
        token
      );
      this.Error(this.InsteadFound(token), token);
      return node;
    }

    node.SetToken(token);
    node.UpdateSourcePos(token.pos, token.length);

    // Parse the base type
    token = this.GetToken();
    this.RewindTo(token);

    // Make sure it is a primitive type (except ttVoid)
    if (!this.IsRealType(token.type) || token.type == eTokenType.ttVoid) {
      const str = format(
        TXT_UNEXPECTED_TOKEN_s,
        asCTokenizer.GetDefinition(token.type)
      );
      this.Error(str, token);
      return node;
    }

    node.AddChildLast(this.ParseRealType());
    node.AddChildLast(this.ParseIdentifier());

    // Check for the end of the typedef
    token = this.GetToken();
    if (token.type != eTokenType.ttEndStatement) {
      this.RewindTo(token);
      this.Error(
        this.ExpectedToken(asCTokenizer.GetDefinition(token.type)),
        token
      );
      this.Error(this.InsteadFound(token), token);
    }

    return node;
  }
}
