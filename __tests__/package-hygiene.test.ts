import { execFileSync } from 'child_process';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, extname } from 'path';

/**
 * What leaves in the tarball is a public surface — the package is on npm.
 *
 * Today nothing leaks: `files: ["dist"]` keeps sources out, `removeComments` strips comments
 * and the source maps carry no `sourcesContent`. None of that is guaranteed by anything but
 * three settings in tsconfig, and turning on `inlineSources` one day would publish every
 * comment silently. This test is the guard.
 */
describe('published package hygiene', () => {
	let root: string;

	beforeAll(() => {
		root = mkdtempSync(join(tmpdir(), 'apipay-pack-'));
		const tarball = execFileSync('npm', ['pack', '--silent', '--pack-destination', root], {
			encoding: 'utf8',
		}).trim();
		execFileSync('tar', ['xzf', join(root, tarball), '-C', root]);
	}, 120_000);

	afterAll(() => {
		if (root) rmSync(root, { recursive: true, force: true });
	});

	/** Every published file, optionally narrowed to a set of extensions. */
	function published(...extensions: string[]): string[] {
		const walk = (dir: string): string[] =>
			readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
				const full = join(dir, entry.name);
				return entry.isDirectory() ? walk(full) : [full];
			});

		const files = walk(join(root, 'package'));
		if (!extensions.length) return files;
		return files.filter((f) => extensions.includes(extname(f)));
	}

	test('should ship no TypeScript sources', () => {
		expect(published('.ts').filter((f) => !f.endsWith('.d.ts'))).toEqual([]);
	});

	test('should ship no comments in the built code', () => {
		for (const file of published('.js')) {
			// The `//# sourceMappingURL=` pragma is machinery, not a comment someone wrote.
			const code = readFileSync(file, 'utf8').replace(/^\/\/#.*$/gm, '');
			expect(code).not.toMatch(/\/\*/);
			expect(code).not.toMatch(/^\s*\/\//m);
		}
	});

	test('⛔ should ship no source text inside the maps', () => {
		const maps = published('.map');
		expect(maps.length).toBeGreaterThan(0);
		for (const file of maps) {
			expect(JSON.parse(readFileSync(file, 'utf8')).sourcesContent).toBeUndefined();
		}
	});

	test('should mention no internal hosts or repository paths', () => {
		const forbidden = [/bazarbay\.site/, /kaspi-pay-laravel/, /PhpstormProjects/, /gitlab\.com/];
		for (const file of published('.js', '.map', '.json', '.md')) {
			const text = readFileSync(file, 'utf8');
			for (const pattern of forbidden) {
				expect(text).not.toMatch(pattern);
			}
		}
	});

	test('should ship no Cyrillic in what the user reads', () => {
		for (const file of published('.js', '.json', '.md')) {
			expect(readFileSync(file, 'utf8')).not.toMatch(/[а-яА-ЯёЁ]/);
		}
	});
});
