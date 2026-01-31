# Getting Started with LaraBug JavaScript SDK

## Prerequisites

- Node.js 16+ and npm/yarn
- A LaraBug account and project key

## Building the Project

Since this is a monorepo with multiple packages, you'll need to build all packages:

```bash
# Install dependencies
npm install

# Build all packages
npm run build
```

This will compile all TypeScript files and create distribution files for each package.

## Development Workflow

```bash
# Watch mode - auto-rebuild on file changes
npm run build:watch

# Run linter
npm run lint

# Fix linting issues
npm run lint:fix

# Clean build artifacts
npm run clean
```

## Publishing Packages

The project uses Lerna for managing the monorepo:

```bash
# Publish all changed packages
npx lerna publish

# Publish a specific version
npx lerna publish minor

# Publish with custom message
npx lerna publish --message "chore: release new version"
```

## Testing Locally

To test packages locally before publishing:

### Option 1: npm link

```bash
# In the package directory (e.g., packages/browser)
cd packages/browser
npm link

# In your test project
npm link @larabug/browser
```

### Option 2: Local path in package.json

```json
{
  "dependencies": {
    "@larabug/browser": "file:../larabug-javascript/packages/browser"
  }
}
```

### Option 3: Verdaccio (Local npm registry)

```bash
# Install Verdaccio
npm install -g verdaccio

# Run local registry
verdaccio

# Publish to local registry
npm publish --registry http://localhost:4873
```

## Package Structure

Each package follows this structure:

```
packages/[package-name]/
├── src/               # TypeScript source files
│   ├── index.ts      # Main entry point
│   └── ...           # Other source files
├── dist/             # Compiled output (git-ignored)
│   ├── index.js      # CommonJS bundle
│   ├── index.esm.js  # ES modules bundle
│   └── index.d.ts    # TypeScript definitions
├── package.json      # Package configuration
├── tsconfig.json     # TypeScript config
└── rollup.config.mjs # Build configuration
```

## Adding a New Package

1. Create package directory:
```bash
mkdir -p packages/new-package/src
```

2. Create `package.json`:
```json
{
  "name": "@larabug/new-package",
  "version": "1.0.0",
  "main": "dist/index.js",
  "module": "dist/index.esm.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "rollup -c",
    "build:watch": "rollup -c -w"
  },
  "dependencies": {
    "@larabug/core": "^1.0.0"
  }
}
```

3. Create source files in `src/`

4. Add build configuration (`tsconfig.json`, `rollup.config.mjs`)

5. Build and test:
```bash
cd packages/new-package
npm run build
```

## Best Practices

### TypeScript

- Use strict type checking
- Export types from `@larabug/core` for consistency
- Document public APIs with JSDoc comments

### Error Handling

- Never throw errors from error reporting code
- Fail silently if LaraBug API is unreachable
- Use `console.error` for debugging in development

### Bundle Size

- Keep packages small and focused
- Use tree-shaking friendly exports
- Avoid large dependencies
- Mark framework packages as peer dependencies

### Testing

- Test with actual error scenarios
- Verify breadcrumbs are captured correctly
- Test with different environments (dev/prod)
- Validate TypeScript types compile correctly

## Common Issues

### Build Errors

If you encounter TypeScript errors:
```bash
# Clean and rebuild
npm run clean
npm install
npm run build
```

### Linking Issues

If `npm link` doesn't work:
```bash
# Unlink and re-link
npm unlink @larabug/browser
cd packages/browser && npm link
```

### Lerna Issues

If Lerna can't find packages:
```bash
# Bootstrap all packages
npx lerna bootstrap

# Force reinstall
npx lerna clean -y
npm install
npx lerna bootstrap
```

## Support

- Documentation: https://docs.larabug.com
- Issues: https://github.com/LaraBug/larabug-javascript/issues
- Email: support@larabug.com
