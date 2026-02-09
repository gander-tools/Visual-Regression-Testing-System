#!/usr/bin/env node
import { spawn } from 'child_process';

// Parse arguments: node script.mjs [path]
const path = process.argv[2];

const args = ['test', 'tests/visual/'];

if (path) {
  // Single path mode - use grep to filter tests
  if (!path.startsWith('/')) {
    console.error('❌ Error: Path must start with /');
    console.log('\nUsage:');
    console.log('  npm run visual:test           # Run all tests');
    console.log('  npm run visual:test /media    # Run tests for /media only');
    process.exit(1);
  }

  console.log(`🎯 Running tests for: ${path}\n`);
  // Match exact path: space + full path + no slash after + space + should
  // /artykuly(?!/) should matches " /artykuly should" not " /artykuly/..."
  const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  args.push('--grep', ` ${escapedPath}(?!/) should`);
} else {
  console.log('🧪 Running all visual regression tests\n');
}

// Run playwright
const playwright = spawn('npx', ['playwright', ...args], {
  stdio: 'inherit'
});

playwright.on('close', (code) => {
  process.exit(code);
});
