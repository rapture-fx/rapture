import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommand, Option } from '../index.js';

const parse = (configure, argv) => {
  const command = createCommand('demo').exitOverride();
  configure(command);
  command.parse(['node', 'demo', ...argv]);
  return command.opts();
};

test('boolean options are absent until given, then true', () => {
  assert.deepEqual(parse((c) => c.option('-v, --verbose', 'be loud'), []), { verbose: false });
  assert.deepEqual(parse((c) => c.option('-v, --verbose', 'be loud'), ['-v']), {
    verbose: true,
  });
  assert.deepEqual(parse((c) => c.option('-v, --verbose', 'be loud'), ['--verbose']), {
    verbose: true,
  });
});

test('options with a required value capture that value', () => {
  assert.deepEqual(parse((c) => c.option('-n, --number <n>', 'a number'), ['-n', '42']), {
    number: '42',
  });
  assert.deepEqual(parse((c) => c.option('-n, --number <n>', 'a number'), ['--number=42']), {
    number: '42',
  });
  assert.deepEqual(parse((c) => c.option('-n, --number <n>', 'a number'), ['--number', '7']), {
    number: '7',
  });
});

test('defaults apply only when the option is absent', () => {
  assert.deepEqual(parse((c) => c.option('-p, --port <n>', 'port', '8080'), []), {
    port: '8080',
  });
  assert.deepEqual(parse((c) => c.option('-p, --port <n>', 'port', '8080'), ['-p', '99']), {
    port: '99',
  });
});

test('long flag names are camelcased into attribute names', () => {
  assert.equal(new Option('--check-updates').attributeName(), 'checkUpdates');
  assert.equal(new Option('-v, --verbose').attributeName(), 'verbose');
  assert.equal(new Option('--dry-run-only').attributeName(), 'dry-run-only');
  assert.deepEqual(parse((c) => c.option('--check-updates', 'check'), ['--check-updates']), {
    checkUpdates: true,
  });
});

test('option kind is reported correctly', () => {
  assert.equal(new Option('-v, --verbose').isBoolean(), true);
  assert.equal(new Option('-n, --number <n>').isBoolean(), true);
  assert.equal(new Option('-n, --number [n]').isBoolean(), false);
  assert.equal(new Option('-n, --number <n>').required, true);
  assert.equal(new Option('-n, --number [n]').optional, true);
  assert.equal(new Option('-v, --verbose').required, false);
});

test('an option recognises only its own flags', () => {
  const option = new Option('-n, --number <n>');
  assert.equal(option.is('-n'), true);
  assert.equal(option.is('--number'), true);
  assert.equal(option.is('-x'), true);
  assert.equal(option.is('--other'), false);
  assert.equal(new Option('--long-only').is('--long-only'), true);
  assert.equal(new Option('--long-only').is('-l'), false);
});

test('flags are split into short and long forms', () => {
  const both = new Option('-n, --number <n>');
  assert.equal(both.short, '-n');
  assert.equal(both.long, '--number');
  assert.equal(both.name(), 'number');
  const longOnly = new Option('--number <n>');
  assert.equal(longOnly.short, '--number');
  assert.equal(longOnly.long, '--number');
});

test('choices restrict the accepted values', () => {
  assert.deepEqual(
    parse((c) => c.addOption(new Option('--size <s>').choices(['small', 'large'])), [
      '--size',
      'small',
    ]),
    { size: 'small' },
  );
  assert.throws(() =>
    parse((c) => c.addOption(new Option('--size <s>').choices(['small', 'large'])), [
      '--size',
      'huge',
    ]),
  );
});
