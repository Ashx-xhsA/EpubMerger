import { parseArgs } from 'node:util';
import { CORE_VERSION, describeMerge } from '@epubmerger/core';

const USAGE = 'Usage: pnpm cli merge <en.epub> <zh.epub> -o <out.epub>';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: 'string', short: 'o' },
    version: { type: 'boolean', short: 'v' },
  },
});

if (values.version) {
  console.log(`epubmerger core ${CORE_VERSION}`);
  process.exit(0);
}

const [command, enPath, zhPath] = positionals;
if (command !== 'merge' || !enPath || !zhPath || !values.output) {
  console.error(USAGE);
  process.exit(1);
}

console.log(`${describeMerge(enPath, zhPath)} -> ${values.output} (not implemented yet)`);
