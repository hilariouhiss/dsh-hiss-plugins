/**
 * The QR encoder's contract: standard version selection, finder/timing
 * structure, a locked module layout for the LAN URL shape, and an SVG that
 * sizes itself by the chosen quiet zone.
 *
 * The locked hash was verified module-for-module against an independent
 * encoder (qrcode 1.5.4 with a forced byte segment) across versions 1-10 and
 * all eight masks; that equipment is not a dependency of this package.
 *
 * @module dsh-hiss-plugins/test/lan-access/qr
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { qrMatrix, qrSvg } from "../../lib/lan-access/qr.js";

/** A URL of the shape a phone scans: lowercase text forces byte mode. */
const SAMPLE = "http://192.168.102.124:7505/?token=TESTTOKEN-0123456789-abcdefghijklmnopqrst";

/** Flatten the matrix into one bit string. */
function bitsOf(matrix) {
	return matrix.modules.map((row) => row.map((value) => (value ? "1" : "0")).join("")).join("");
}

test("the LAN URL sample encodes as the verified version 5, mask 3 matrix", () => {
	const matrix = qrMatrix(SAMPLE);
	assert.equal(matrix.version, 5);
	assert.equal(matrix.mask, 3);
	assert.equal(matrix.size, 37);
	assert.equal(
		createHash("sha256").update(bitsOf(matrix)).digest("hex"),
		"45bbdb51d92ece52a00bf85247ded4b07b8a8a1db862728f6bdfb3fa9fe7f3a3",
	);
});

test("version selection follows the level-M byte capacity", () => {
	assert.equal(qrMatrix("a").version, 1);
	assert.equal(qrMatrix("a".repeat(62)).version, 4);
	assert.equal(qrMatrix("a".repeat(63)).version, 5);
	assert.equal(qrMatrix("a".repeat(200)).version, 10);
	assert.equal(qrMatrix("a".repeat(213)).version, 10);
	assert.throws(() => qrMatrix("a".repeat(214)), /no version/u);
});

test("every matrix keeps the three finder patterns and the timing lines", () => {
	const { modules, size } = qrMatrix("a".repeat(20), { mask: 0 });
	const finderAt = (originX, originY) => {
		for (let y = 0; y < 7; y += 1) {
			for (let x = 0; x < 7; x += 1) {
				const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
				assert.equal(modules[originY + y][originX + x], ring !== 2, `finder ${originX},${originY} cell ${x},${y}`);
			}
		}
	};
	finderAt(0, 0);
	finderAt(size - 7, 0);
	finderAt(0, size - 7);
	for (let index = 8; index < size - 8; index += 1) {
		assert.equal(modules[6][index], index % 2 === 0, `timing row ${index}`);
		assert.equal(modules[index][6], index % 2 === 0, `timing column ${index}`);
	}
	assert.equal(modules[size - 8][8], true, "the dark module is always dark");
});

test("the format bits carry the level-M marker and the chosen mask", () => {
	const first = qrMatrix("a".repeat(20), { mask: 0 });
	const last = qrMatrix("a".repeat(20), { mask: 7 });
	assert.notDeepEqual(first.modules[8].slice(0, 9), last.modules[8].slice(0, 9), "the mask changes the format bits");
	// Module (8, size-8) is the always-dark module, not a format bit.
	assert.equal(first.modules[first.size - 8][8], true);
});

test("versions 7 and up carry the version information blocks", () => {
	const { modules, size, version } = qrMatrix("a".repeat(110));
	assert.ok(version >= 7);
	assert.notDeepEqual(modules[0].slice(size - 11, size - 8), [false, false, false], "the top-right version block is painted");
});

test("the SVG scales every module by the requested factor plus the quiet zone", () => {
	const matrix = qrMatrix("a".repeat(20), { mask: 0 });
	const svg = qrSvg(matrix, { scale: 3, border: 4 });
	const dimension = (matrix.size + 8) * 3;
	assert.match(svg, new RegExp(`width="${String(dimension)}" height="${String(dimension)}"`, "u"));
	assert.match(svg, /<rect width="100%" height="100%" fill="#ffffff"\/>/u);
	assert.match(svg, /<path fill="#000000" d="M/u);
	assert.ok(!svg.includes("NaN"), "every path coordinate is numeric");
});
