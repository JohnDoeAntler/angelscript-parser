import test from 'ava';
import { asCParser } from './parser';
import { asCScriptCode } from './scriptcode';
import { eScriptNode } from './scriptnode';
import { asCTokenizer } from './tokenizer';

const tokenizer = new asCTokenizer();
const parser = new asCParser(tokenizer);
const code = new asCScriptCode();

test('parse function', (t) => {
	code.SetCode(`void id () {}`);
	parser.ParseScript(code);

	t.deepEqual(parser.getErrors(), []);

	const script = parser.GetScriptNode();
	const functionDeclaration = script?.firstChild;
	const datatype = functionDeclaration?.firstChild;
	const typemod = datatype?.next;
	const identifier = typemod?.next;
	const parameterList = identifier?.next;
	const statementBlock = parameterList?.next;
	const end = statementBlock?.next;

	t.is(script?.nodeType, eScriptNode.snScript);
	t.is(functionDeclaration?.nodeType, eScriptNode.snFunction);
	t.is(datatype?.nodeType, eScriptNode.snDataType);
	t.is(typemod?.nodeType, eScriptNode.snDataType);
	t.is(identifier?.nodeType, eScriptNode.snIdentifier);
	t.is(parameterList?.nodeType, eScriptNode.snParameterList);
	t.is(statementBlock?.nodeType, eScriptNode.snStatementBlock);
	t.is(end?.nodeType, undefined);
});

test('parse constant', (t) => {
	code.SetCode(`"hello world."`);
	parser['Reset']();
	parser['script'] = code;
	const stringLiteral = parser['ParseConstant']();

	t.deepEqual(parser.getErrors(), []);
	t.is(stringLiteral.nodeType, eScriptNode.snConstant);
	t.is(
		code.code.substr(stringLiteral.tokenPos, stringLiteral.tokenLength),
		'"hello world."'
	);
});

// test('snDataType', (t) => {
//
// });

// test('snIdentifier', (t) => {

// });

// test('snParameterList', (t) => {

// });

// test('snStatementBlock', (t) => {

// });

test('parse declaration', (t) => {
	parser['Reset']();
	code.SetCode(`int a = "hello world.";`);
	parser.ParseScript(code);

	t.deepEqual(parser.getErrors(), []);

	const script = parser.GetScriptNode();
	const variableDeclaration = script?.firstChild;
	const datatype = variableDeclaration?.firstChild;
	const identifier = datatype?.next;
	const superficialAssignment = identifier?.next;
	const end = superficialAssignment?.next;

	t.is(script?.nodeType, eScriptNode.snScript);
	t.is(variableDeclaration?.nodeType, eScriptNode.snDeclaration);
	t.is(datatype?.nodeType, eScriptNode.snDataType);
	t.is(identifier?.nodeType, eScriptNode.snIdentifier);
	t.is(superficialAssignment?.nodeType, eScriptNode.snAssignment);
	t.is(end?.nodeType, undefined);

	if (superficialAssignment) {
		parser.ParseVarInit(code, superficialAssignment);

		const assignment = parser.GetScriptNode();
		const condition = assignment?.firstChild;
		const expression = condition?.firstChild;
		const expressionTerm = expression?.firstChild;
		const expressionValue = expressionTerm?.firstChild;
		const stringLiteral = expressionValue?.firstChild;

		t.is(assignment?.nodeType, eScriptNode.snAssignment);
		t.is(condition?.nodeType, eScriptNode.snCondition);
		t.is(expression?.nodeType, eScriptNode.snExpression);
		t.is(expressionTerm?.nodeType, eScriptNode.snExprTerm);
		t.is(expressionValue?.nodeType, eScriptNode.snExprValue);
		t.is(stringLiteral?.nodeType, eScriptNode.snConstant);
	}
});

// test('snExpressionStatement', (t) => {

// });

// test('snIf', (t) => {

// });

// test('snFor', (t) => {

// });

// test('snWhile', (t) => {

// });

// test('snReturn', (t) => {

// });

// test('snExpression', (t) => {

// });

// test('snExprTerm', (t) => {

// });

// test('snFunctionCall', (t) => {

// });

// test('snConstructCall', (t) => {

// });

// test('snArgList', (t) => {

// });

// test('snExprPreOp', (t) => {

// });

// test('snExprPostOp', (t) => {

// });

// test('snExprOperator', (t) => {

// });

// test('snExprValue', (t) => {

// });

// test('snBreak', (t) => {

// });

// test('snContinue', (t) => {

// });

// test('snDoWhile', (t) => {

// });

// test('snAssignment', (t) => {

// });

// test('snCondition', (t) => {

// });

// test('snSwitch', (t) => {

// });

// test('snCase', (t) => {

// });

// test('snImport', (t) => {

// });

// test('snClass', (t) => {

// });

// test('snInitList', (t) => {

// });

// test('snInterface', (t) => {

// });

// test('snEnum', (t) => {

// });

// test('snTypedef', (t) => {

// });

// test('snCast', (t) => {

// });

// test('snVariableAccess', (t) => {

// });

// test('snFuncDef', (t) => {

// });

// test('snVirtualProperty', (t) => {

// });

// test('snNamespace', (t) => {

// });

// test('snMixin', (t) => {

// });

// test('snListPattern', (t) => {

// });

// test('snNamedArgument', (t) => {

// });

// test('snScope', (t) => {

// });

// test('snTryCatch', (t) => {

// });
