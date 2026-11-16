/**
 * A small QR Code encoder for the LAN page: byte mode, error-correction level M,
 * versions 1-10, every mask evaluated by the standard penalty score. It exists
 * because the package ships no dependencies and a phone camera needs real
 * modules, not text art.
 *
 * The placement, Reed-Solomon, format and version-bit code follows the ISO/IEC
 * 18004 layout that every encoder implements; the output is verified against an
 * independent encoder rather than by eyeballing a picture.
 *
 * @module dsh-hiss-plugins/lan-access/qr
 */

/** Error-correction level M codewords per block, index 0 = version 1. */
const ECC_CODEWORDS_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
/** Error-correction level M block counts, index 0 = version 1. */
const NUM_BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
/** Format bits for level M. */
const ECC_FORMAT_BITS = 0b00;
/** The largest version this encoder builds. */
const MAX_VERSION = 10;

/** Multiplication and log tables over GF(256) with the QR polynomial. */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
	let value = 1;
	for (let index = 0; index < 255; index += 1) {
		EXP[index] = value;
		LOG[value] = index;
		value <<= 1;
		if (value & 0x100) value ^= 0x11d;
	}
	for (let index = 255; index < 512; index += 1) EXP[index] = EXP[index - 255];
}

/**
 * Multiply two GF(256) values.
 * @param left - first field element.
 * @param right - second field element.
 * @returns the product.
 */
function multiply(left, right) {
	return left === 0 || right === 0 ? 0 : EXP[LOG[left] + LOG[right]];
}

/**
 * The number of data modules a version carries before error correction.
 * @param version - QR version 1-10.
 * @returns the raw data-module count.
 */
function rawDataModules(version) {
	let result = (16 * version + 128) * version + 64;
	if (version >= 2) {
		const alignment = Math.floor(version / 7) + 2;
		result -= (25 * alignment - 10) * alignment - 55;
		if (version >= 7) result -= 36;
	}
	return result;
}

/**
 * The total data codewords a version carries at level M.
 * @param version - QR version 1-10.
 * @returns the data codeword count.
 */
function dataCodewords(version) {
	const blocks = NUM_BLOCKS[version - 1];
	return Math.floor(rawDataModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK[version - 1] * blocks;
}

/**
 * The smallest version that holds a byte payload at level M.
 * @param length - payload length in bytes.
 * @returns the version, or 0 when the payload does not fit.
 */
function versionFor(length) {
	for (let version = 1; version <= MAX_VERSION; version += 1) {
		// Mode indicator (4 bits) plus an 8-bit character count for versions 1-9.
		const header = version <= 9 ? 12 : 20;
		if (length * 8 + header <= dataCodewords(version) * 8) return version;
	}
	return 0;
}

/**
 * The Reed-Solomon divisor for one block's error-correction length.
 * @param degree - error-correction codewords per block.
 * @returns the divisor coefficients, highest power first.
 */
function divisor(degree) {
	const result = new Uint8Array(degree);
	result[degree - 1] = 1;
	let root = 1;
	for (let index = 0; index < degree; index += 1) {
		for (let position = 0; position < degree; position += 1) {
			result[position] = multiply(result[position], root);
			if (position + 1 < degree) result[position] ^= result[position + 1];
		}
		root = multiply(root, 2);
	}
	return result;
}

/**
 * The error-correction codewords for one block.
 * @param data - the block's data codewords.
 * @param coefficients - the divisor from {@link divisor}.
 * @returns the error-correction codewords.
 */
function remainder(data, coefficients) {
	const result = new Uint8Array(coefficients.length);
	for (const value of data) {
		const factor = value ^ result[0];
		result.copyWithin(0, 1);
		result[result.length - 1] = 0;
		for (let index = 0; index < result.length; index += 1) result[index] ^= multiply(coefficients[index], factor);
	}
	return result;
}

/**
 * Encode a byte payload into the full codeword sequence.
 * @param bytes - payload bytes.
 * @param version - QR version 1-10.
 * @returns interleaved data and error-correction codewords.
 */
function codewords(bytes, version) {
	const capacity = dataCodewords(version);
	const countBits = version <= 9 ? 8 : 16;
	if (bytes.length * 8 + 4 + countBits > capacity * 8) throw new Error("qr: payload does not fit the chosen version");

	const bits = [];
	const push = (value, length) => {
		for (let index = length - 1; index >= 0; index -= 1) bits.push((value >>> index) & 1);
	};
	push(0b0100, 4);
	push(bytes.length, countBits);
	for (const byte of bytes) push(byte, 8);
	push(0, Math.min(4, capacity * 8 - bits.length));
	while (bits.length % 8 !== 0) bits.push(0);
	const data = new Uint8Array(capacity);
	for (let index = 0; index < bits.length; index += 8) {
		let byte = 0;
		for (let offset = 0; offset < 8; offset += 1) byte = (byte << 1) | bits[index + offset];
		data[index / 8] = byte;
	}
	for (let index = bits.length / 8, pad = 0xec; index < capacity; index += 1, pad ^= 0xec ^ 0x11) data[index] = pad;

	const blockCount = NUM_BLOCKS[version - 1];
	const eccLength = ECC_CODEWORDS_PER_BLOCK[version - 1];
	const totalCodewords = Math.floor(rawDataModules(version) / 8);
	const shortLength = Math.floor(totalCodewords / blockCount);
	const shortCount = blockCount - (totalCodewords % blockCount);
	const coefficients = divisor(eccLength);
	const blocks = [];
	for (let index = 0, offset = 0; index < blockCount; index += 1) {
		const length = shortLength - eccLength + (index < shortCount ? 0 : 1);
		const block = data.subarray(offset, offset + length);
		offset += length;
		blocks.push({ data: block, ecc: remainder(block, coefficients) });
	}
	const result = [];
	for (let index = 0; index < shortLength - eccLength + 1; index += 1) {
		for (const block of blocks) if (index < block.data.length) result.push(block.data[index]);
	}
	for (let index = 0; index < eccLength; index += 1) for (const block of blocks) result.push(block.ecc[index]);
	return Uint8Array.from(result);
}

/**
 * The alignment-pattern centre coordinates of a version.
 * @param version - QR version 1-10.
 * @returns sorted centre coordinates.
 */
function alignmentCentres(version) {
	if (version === 1) return [];
	const count = Math.floor(version / 7) + 2;
	const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
	const result = [6];
	for (let position = version * 4 + 10; result.length < count; position -= step) result.splice(1, 0, position);
	return result;
}

/** A matrix under construction; `null` marks a module no data paints. */
function emptyMatrix(size) {
	return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}

/**
 * Paint the fixed patterns: finders, separators, timing, and the dark module.
 * @param modules - the matrix to paint.
 */
function drawFixedPatterns(modules) {
	const size = modules.length;
	const set = (x, y, dark) => {
		modules[y][x] = dark;
	};
	for (const [originX, originY] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
		for (let dy = -1; dy <= 7; dy += 1) {
			for (let dx = -1; dx <= 7; dx += 1) {
				const x = originX + dx;
				const y = originY + dy;
				if (x < 0 || x >= size || y < 0 || y >= size) continue;
				const distance = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
				set(x, y, distance !== 2 && distance !== 4);
			}
		}
	}
	for (let index = 8; index < size - 8; index += 1) {
		const dark = index % 2 === 0;
		set(index, 6, dark);
		set(6, index, dark);
	}
	set(8, size - 8, true);
}

/**
 * Paint every alignment pattern the version carries.
 * @param modules - the matrix to paint.
 * @param version - QR version 1-10.
 */
function drawAlignment(modules, version) {
	const centres = alignmentCentres(version);
	const last = centres.length - 1;
	for (let row = 0; row <= last; row += 1) {
		for (let column = 0; column <= last; column += 1) {
			const centreX = centres[column];
			const centreY = centres[row];
			if ((column === 0 && row === 0) || (column === 0 && row === last) || (column === last && row === 0)) continue;
			for (let dy = -2; dy <= 2; dy += 1) {
				for (let dx = -2; dx <= 2; dx += 1) {
					modules[centreY + dy][centreX + dx] = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
				}
			}
		}
	}
}

/**
 * The 15-bit format information for a level and mask, BCH protected.
 * @param mask - mask pattern 0-7.
 * @returns the 15 bits, most significant first.
 */
function formatBits(mask) {
	const data = (ECC_FORMAT_BITS << 3) | mask;
	let remainderBits = data;
	for (let index = 0; index < 10; index += 1) remainderBits = (remainderBits << 1) ^ ((remainderBits >>> 9) * 0x537);
	return ((data << 10) | remainderBits) ^ 0x5412;
}

/**
 * The 18-bit version information for a version at least 7, BCH protected.
 * @param version - QR version 7-10.
 * @returns the 18 bits, most significant first.
 */
function versionBits(version) {
	let remainderBits = version;
	for (let index = 0; index < 12; index += 1) remainderBits = (remainderBits << 1) ^ ((remainderBits >>> 11) * 0x1f25);
	return (version << 12) | remainderBits;
}

/**
 * Paint the format bits around the finders and the version bits beside them.
 * @param modules - the matrix to paint.
 * @param mask - mask pattern 0-7.
 * @param version - QR version 1-10.
 */
function drawMetadata(modules, mask, version) {
	const size = modules.length;
	const bits = formatBits(mask);
	const set = (x, y, dark) => {
		modules[y][x] = dark;
	};
	for (let index = 0; index < 6; index += 1) set(8, index, ((bits >>> index) & 1) !== 0);
	set(8, 7, ((bits >>> 6) & 1) !== 0);
	set(8, 8, ((bits >>> 7) & 1) !== 0);
	set(7, 8, ((bits >>> 8) & 1) !== 0);
	for (let index = 9; index < 15; index += 1) set(14 - index, 8, ((bits >>> index) & 1) !== 0);
	for (let index = 0; index < 8; index += 1) set(size - 1 - index, 8, ((bits >>> index) & 1) !== 0);
	for (let index = 8; index < 15; index += 1) set(8, size - 15 + index, ((bits >>> index) & 1) !== 0);
	set(8, size - 8, true);

	if (version < 7) return;
	const versionInfo = versionBits(version);
	for (let index = 0; index < 18; index += 1) {
		const dark = ((versionInfo >>> index) & 1) !== 0;
		const a = size - 11 + (index % 3);
		const b = Math.floor(index / 3);
		set(a, b, dark);
		set(b, a, dark);
	}
}

/**
 * Paint the payload in the standard zigzag order, skipping reserved modules.
 * @param modules - the matrix to paint.
 * @param data - interleaved codewords.
 * @param mask - mask pattern 0-7.
 */
function drawData(modules, data, mask) {
	const size = modules.length;
	const bits = [];
	for (const byte of data) {
		for (let index = 7; index >= 0; index -= 1) bits.push((byte >>> index) & 1);
	}
	let index = 0;
	for (let right = size - 1; right >= 1; right -= 2) {
		if (right === 6) right = 5;
		for (let vertical = 0; vertical < size; vertical += 1) {
			for (let offset = 0; offset < 2; offset += 1) {
				const x = right - offset;
				const upward = ((right + 1) & 2) === 0;
				const y = upward ? size - 1 - vertical : vertical;
				if (modules[y][x] !== null) continue;
				modules[y][x] = maskedBit(bits[index] ?? 0, mask, x, y);
				index += 1;
			}
		}
	}
	// A version leaves 0-7 remainder bits after its codewords; they stay light
	// payload bits and the mask still applies to them.
	if (index < bits.length || index - bits.length > 7) throw new Error("qr: payload and matrix disagree on the data-module count");
}

/**
 * Apply one mask pattern's inversion predicate.
 * @param bit - the payload bit.
 * @param mask - mask pattern 0-7.
 * @param x - module column.
 * @param y - module row.
 * @returns the module colour.
 */
function maskedBit(bit, mask, x, y) {
	const inverted = [
		(x + y) % 2 === 0,
		y % 2 === 0,
		x % 3 === 0,
		(x + y) % 3 === 0,
		(Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
		((x * y) % 2) + ((x * y) % 3) === 0,
		(((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
		(((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
	][mask];
	return (inverted ? bit ^ 1 : bit) === 1;
}

/**
 * Score a masked matrix with the four standard penalty rules; the lowest wins.
 * @param modules - a boolean matrix.
 * @returns the penalty score.
 */
function penalty(modules) {
	const size = modules.length;
	const dark = (x, y) => modules[y][x] === true;
	let score = 0;
	// Rules 1 and 3 read every row and column once.
	for (const vertical of [false, true]) {
		const line = (index) => (vertical ? dark(index[0], index[1]) : dark(index[1], index[0]));
		for (let offset = 0; offset < size; offset += 1) {
			let run = 1;
			let previous = line([0, offset]);
			for (let step = 1; step < size; step += 1) {
				const value = line([step, offset]);
				if (value === previous) run += 1;
				else {
					if (run >= 5) score += 3 + (run - 5);
					run = 1;
					previous = value;
				}
			}
			if (run >= 5) score += 3 + (run - 5);
			for (let step = 0; step + 11 <= size; step += 1) {
				let bits = "";
				for (let index = 0; index < 11; index += 1) bits += line([step + index, offset]) ? "1" : "0";
				if (bits === "10111010000" || bits === "00001011101") score += 40;
			}
		}
	}
	// Rule 2: every same-colour 2x2 block.
	for (let y = 0; y < size - 1; y += 1) {
		for (let x = 0; x < size - 1; x += 1) {
			const value = dark(x, y);
			if (value === dark(x + 1, y) && value === dark(x, y + 1) && value === dark(x + 1, y + 1)) score += 3;
		}
	}
	// Rule 4: distance of the dark ratio from half, in 5% steps.
	let darkCount = 0;
	for (const row of modules) for (const value of row) if (value === true) darkCount += 1;
	const total = size * size;
	score += Math.floor(Math.abs(darkCount * 20 - total * 10) / total) * 10;
	return score;
}

/**
 * Build the module matrix for a text payload.
 * @param text - the payload; encoded as UTF-8.
 * @param options - optional fixed `mask` and `version` for verification.
 * @returns `{ size, modules, version, mask }`, modules as `true` for dark.
 */
export function qrMatrix(text, options = {}) {
	const bytes = new TextEncoder().encode(text);
	const version = options.version ?? versionFor(bytes.length);
	if (version < 1 || version > MAX_VERSION) throw new Error(`qr: no version up to ${MAX_VERSION} holds this payload`);
	const size = version * 4 + 17;
	const data = codewords(bytes, version);
	const masks = options.mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [options.mask];
	let best;
	for (const mask of masks) {
		const modules = emptyMatrix(size);
		drawFixedPatterns(modules);
		drawAlignment(modules, version);
		drawMetadata(modules, mask, version);
		drawData(modules, data, mask);
		const score = penalty(modules);
		if (best === undefined || score < best.score) best = { modules, mask, score };
	}
	return { size, version, mask: best.mask, modules: best.modules };
}

/**
 * Render a matrix as a standalone SVG document body.
 * @param matrix - the result of {@link qrMatrix}.
 * @param options - `scale` pixels per module and `border` modules of quiet zone.
 * @returns the SVG markup.
 */
export function qrSvg(matrix, { scale = 8, border = 4 } = {}) {
	const dimension = (matrix.size + border * 2) * scale;
	const runs = [];
	for (let y = 0; y < matrix.size; y += 1) {
		let start = -1;
		for (let x = 0; x <= matrix.size; x += 1) {
			const dark = x < matrix.size && matrix.modules[y][x] === true;
			if (dark && start === -1) start = x;
			else if (!dark && start !== -1) {
				runs.push(`M${(start + border) * scale} ${(y + border) * scale}h${(x - start) * scale}v${scale}h${-(x - start) * scale}z`);
				start = -1;
			}
		}
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${dimension}" height="${dimension}" viewBox="0 0 ${dimension} ${dimension}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#ffffff"/><path fill="#000000" d="${runs.join("")}"/></svg>`;
}
