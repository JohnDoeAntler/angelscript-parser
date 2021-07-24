import { asETokenClass } from '../lib/angelscript';
import { eTokenType, TokenWord, tokenWords, whiteSpace } from './tokendef';

export class Token {
	constructor(
		public readonly tokenType: eTokenType,
		public readonly length: number,
		public readonly tokenClass: asETokenClass
	) {}
}

export class asCTokenizer {
	GetToken(source: string): Token {
		return this.ParseToken(source);
	}

	static GetDefinition(tokenType: number): string {
		if (tokenType == eTokenType.ttUnrecognizedToken)
			return '<unrecognized token>';
		if (tokenType == eTokenType.ttEnd) return '<end of file>';
		if (tokenType == eTokenType.ttWhiteSpace) return '<white space>';
		if (tokenType == eTokenType.ttOnelineComment)
			return '<one line comment>';
		if (tokenType == eTokenType.ttMultilineComment)
			return '<multiple lines comment>';
		if (tokenType == eTokenType.ttIdentifier) return '<identifier>';
		if (tokenType == eTokenType.ttIntConstant) return '<integer constant>';
		if (tokenType == eTokenType.ttFloatConstant) return '<float constant>';
		if (tokenType == eTokenType.ttDoubleConstant)
			return '<double constant>';
		if (tokenType == eTokenType.ttStringConstant)
			return '<string constant>';
		if (tokenType == eTokenType.ttMultilineStringConstant)
			return '<multiline string constant>';
		if (tokenType == eTokenType.ttNonTerminatedStringConstant)
			return '<nonterminated string constant>';
		if (tokenType == eTokenType.ttBitsConstant) return '<bits constant>';
		if (tokenType == eTokenType.ttHeredocStringConstant)
			return '<heredoc string constant>';

		return tokenWords.find((e) => e.tokenType === tokenType)?.word || '';
	}

	keywordTable = new Map<string, TokenWord[]>();

	constructor() {
		tokenWords.forEach((e) => {
			if (!this.keywordTable.has(e.word[0])) {
				this.keywordTable.set(e.word[0], []);
			}
			this.keywordTable.get(e.word[0])?.push(e);
		});

		Object.keys(this.keywordTable).forEach((e) => {
			this.keywordTable
				.get(e)
				?.sort((a, b) => a.wordLength - b.wordLength);
		});
	}

	ParseToken(source: string): Token {
		let tmp;

		if ((tmp = this.IsWhiteSpace(source)))
			return new Token(
				tmp.tokenType,
				tmp.length,
				asETokenClass.asTC_WHITESPACE
			);
		if ((tmp = this.IsComment(source)))
			return new Token(
				tmp.tokenType,
				tmp.length,
				asETokenClass.asTC_COMMENT
			);
		if ((tmp = this.IsConstant(source)))
			return new Token(
				tmp.tokenType,
				tmp.length,
				asETokenClass.asTC_VALUE
			);
		if ((tmp = this.IsIdentifier(source)))
			return new Token(
				tmp.tokenType,
				tmp.length,
				asETokenClass.asTC_IDENTIFIER
			);
		if ((tmp = this.IsKeyWord(source)))
			return new Token(
				tmp.tokenType,
				tmp.length,
				asETokenClass.asTC_KEYWORD
			);

		// If none of the above this is an unrecognized token
		// We can find the length of the token by advancing
		// one step and trying to identify a token there
		return new Token(
			eTokenType.ttUnrecognizedToken,
			1,
			asETokenClass.asTC_UNKNOWN
		);
	}

	IsWhiteSpace(source: string): Omit<Token, 'tokenClass'> | null {
		// Treat UTF8 byte-order-mark (EF BB BF) as whitespace
		if (source.length >= 1 && source[0] == '\uFEFF') {
			return {
				tokenType: eTokenType.ttWhiteSpace,
				length: 1,
			};
		}

		// Group all other white space characters into one
		let n = 0;
		for (; n < source.length; n++) {
			let isWhiteSpace = false;

			if (whiteSpace.includes(source[n])) {
				isWhiteSpace = true;
			}

			if (!isWhiteSpace) break;
		}

		if (n) {
			return {
				tokenType: eTokenType.ttWhiteSpace,
				length: n,
			};
		}

		return null;
	}

	IsComment(source: string): Omit<Token, 'tokenClass'> | null {
		if (source.length < 2) {
			return null;
		}

		if (source[0] != '/') {
			return null;
		}

		if (source[1] == '/') {
			// One-line comment

			// Find the length
			let n = 2;
			for (; n < source.length; n++) {
				if (source[n] == '\n') break;
			}

			return {
				tokenType: eTokenType.ttOnelineComment,
				length: n < source.length ? n + 1 : n,
			};
		}

		if (source[1] == '*') {
			// Multi-line comment

			// Find the length
			let n = 2;
			for (; n < source.length - 1; ) {
				if (source[n++] == '*' && source[n] == '/') break;
			}

			return {
				tokenType: eTokenType.ttMultilineComment,
				length: n + 1,
			};
		}

		return null;
	}

	IsConstant(source: string): Omit<Token, 'tokenClass'> | null {
		// Starting with number
		if (
			(source[0] >= '0' && source[0] <= '9') ||
			(source[0] == '.' &&
				source.length > 1 &&
				source[1] >= '0' &&
				source[1] <= '9')
		) {
			// Is it a based number?
			if (source[0] == '0' && source.length > 1) {
				// Determine the radix for the constant
				let radix = 0;
				switch (source[1]) {
					case 'b':
					case 'B':
						radix = 2;
						break;
					case 'o':
					case 'O':
						radix = 8;
						break;
					case 'd':
					case 'D':
						radix = 10;
						break;
					case 'x':
					case 'X':
						radix = 16;
						break;
				}

				if (radix) {
					let n = 2;
					for (; n < source.length; n++) {
						if (!this.IsDigitInRadix(source[n], radix)) break;
					}

					return {
						tokenType: eTokenType.ttBitsConstant,
						length: n,
					};
				}
			}

			let n = 0;
			for (; n < source.length; n++) {
				if (source[n] < '0' || source[n] > '9') break;
			}

			if (
				n < source.length &&
				(source[n] == '.' || source[n] == 'e' || source[n] == 'E')
			) {
				if (source[n] == '.') {
					n++;
					for (; n < source.length; n++) {
						if (source[n] < '0' || source[n] > '9') break;
					}
				}

				if (
					n < source.length &&
					(source[n] == 'e' || source[n] == 'E')
				) {
					n++;
					if (
						n < source.length &&
						(source[n] == '-' || source[n] == '+')
					)
						n++;

					for (; n < source.length; n++) {
						if (source[n] < '0' || source[n] > '9') break;
					}
				}

				if (
					n < source.length &&
					(source[n] == 'f' || source[n] == 'F')
				) {
					return {
						tokenType: eTokenType.ttFloatConstant,
						length: n + 1,
					};
				} else {
					return {
						tokenType: eTokenType.ttDoubleConstant,
						length: n,
					};
				}
			}

			return {
				tokenType: eTokenType.ttIntConstant,
				length: n,
			};
		}

		// String constant between double or single quotes
		if (source[0] == '"' || source[0] == "'") {
			// Is it a normal string constant or a heredoc string constant?
			if (
				source.length >= 6 &&
				source[0] == '"' &&
				source[1] == '"' &&
				source[2] == '"'
			) {
				// Heredoc string constant (spans multiple lines, no escape sequences)

				// Find the length
				let n = 3;
				for (; n < source.length - 2; n++) {
					if (
						source[n] == '"' &&
						source[n + 1] == '"' &&
						source[n + 2] == '"'
					) {
						break;
					}
				}

				return {
					tokenType: eTokenType.ttHeredocStringConstant,
					length: n + 3,
				};
			} else {
				// Normal string constant
				let tokenType = eTokenType.ttStringConstant;
				let quote = source[0];
				let evenSlashes = true;
				let n = 1;

				for (; n < source.length; n++) {
					if (source[n] == '\n') {
						tokenType = eTokenType.ttMultilineStringConstant;
					}
					if (source[n] == quote && evenSlashes) {
						return {
							tokenType,
							length: n + 1,
						};
					}
					if (source[n] == '\\') evenSlashes = !evenSlashes;
					else evenSlashes = true;
				}

				return {
					tokenType: eTokenType.ttNonTerminatedStringConstant,
					length: n,
				};
			}
		}

		return null;
	}

	IsKeyWord(source: string): Omit<Token, 'tokenClass'> | null {
		let start = source[0];

		const arr = this.keywordTable.get(start);

		if (arr) {
			for (let e of arr) {
				let wlen = e.wordLength;

				if (source.length >= wlen && source.slice(0, wlen) === e.word) {
					if (
						wlen < source.length &&
						((source[wlen - 1] >= 'a' && source[wlen - 1] <= 'z') ||
							(source[wlen - 1] >= 'A' &&
								source[wlen - 1] <= 'Z') ||
							(source[wlen - 1] >= '0' &&
								source[wlen - 1] <= '9')) &&
						((source[wlen] >= 'a' && source[wlen] <= 'z') ||
							(source[wlen] >= 'A' && source[wlen] <= 'Z') ||
							(source[wlen] >= '0' && source[wlen] <= '9') ||
							source[wlen] == '_')
					) {
						continue;
					}

					return {
						tokenType: e.tokenType,
						length: wlen,
					};
				}
			}
		}

		return null;
	}

	IsIdentifier(source: string): Omit<Token, 'tokenClass'> | null {
		let c = source.charAt(0);

		// Starting with letter or underscore
		if (
			(c >= 'a' && c <= 'z') ||
			(c >= 'A' && c <= 'Z') ||
			c == '_' ||
			c.charCodeAt(0) > 255 // && engine->ep.allowUnicodeIdentifiers
		) {
			let tokenLength = 1;

			for (let n = 1; n < source.length; n++) {
				c = source[n];
				if (
					(c >= 'a' && c <= 'z') ||
					(c >= 'A' && c <= 'Z') ||
					c == '_' ||
					c.charCodeAt(0) > 255 // && engine->ep.allowUnicodeIdentifiers
				) {
					tokenLength++;
				} else {
					break;
				}
			}

			// Make sure the identifier isn't a reserved keyword
			if (this.IsKeyWord(source.slice(0, tokenLength))) {
				return null;
			}

			return {
				tokenType: eTokenType.ttIdentifier,
				length: tokenLength,
			};
		}

		return null;
	}

	IsDigitInRadix(ch: string, radix: number): boolean {
		if (ch >= '0' && ch <= '9') return '0'.charCodeAt(0) < radix;
		if (ch >= 'A' && ch <= 'Z') return 'A'.charCodeAt(0) - 10 < radix;
		if (ch >= 'a' && ch <= 'z') return 'a'.charCodeAt(0) - 10 < radix;
		return false;
	}
}
