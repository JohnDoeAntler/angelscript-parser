export class asCScriptCode {
	public code = '';
	public linePositions: number[] = [];

	public SetCode(in_code: string) {
		this.linePositions.length = 0;

		if (!in_code) {
			throw new Error();
		}

		this.code = in_code;

		this.linePositions.push(0);
		for (let n = 0; n < in_code.length; n++) {
			if (in_code[n] == '\n') {
				this.linePositions.push(n + 1);
			}
		}
		this.linePositions.push(in_code.length);
	}

	public ConvertPosToRowCol(pos: number) {
		if (this.linePositions.length == 0) {
			return {
				row: 0,
				col: 1,
			};
		}

		// Do a binary search in the buffer
		let max = this.linePositions.length - 1;
		let min = 0;
		let i = Math.floor(max / 2);

		while (true) {
			if (this.linePositions[i] < pos) {
				// Have we found the largest number < programPosition?
				if (min == i) break;

				min = i;
				i = Math.floor((max + min) / 2);
			} else if (this.linePositions[i] > pos) {
				// Have we found the smallest number > programPoisition?
				if (max == i) break;

				max = i;
				i = Math.floor((max + min) / 2);
			} else {
				// We found the exact position
				break;
			}
		}

		return {
			row: i + 1,
			col: pos - this.linePositions[i] + 1,
		};
	}

	public TokenEquals(pos: number, len: number, str: string) {
		return this.code.substr(pos, len) === str;
	}
}
