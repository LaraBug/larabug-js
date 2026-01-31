# LaraBug JavaScript SDK

Official JavaScript SDK for [LaraBug](https://larabug.com) - Error tracking and monitoring for modern web applications.

## Features

- 🚀 **Automatic error capturing** - Catches unhandled errors and promise rejections
- 🔍 **Rich context** - Captures breadcrumbs, user info, and custom context
- ⚛️ **Framework support** - First-class integrations for React, Vue, and Inertia.js
- 📦 **Lightweight** - Tree-shakeable and optimized for bundle size
- 🎯 **TypeScript** - Full TypeScript support with type definitions
- 🔌 **Extensible** - Easy to customize and extend

## Packages

This is a monorepo containing multiple packages:

- [`@larabug/core`](./packages/core) - Core SDK with types and base client
- [`@larabug/browser`](./packages/browser) - Browser SDK with automatic instrumentation
- [`@larabug/react`](./packages/react) - React integration with Error Boundary
- [`@larabug/vue`](./packages/vue) - Vue 3 integration with error handler
- [`@larabug/inertia`](./packages/inertia) - Inertia.js plugin for Laravel apps

## Installation

### Vanilla JavaScript / TypeScript

```bash
npm install @larabug/browser
# or
yarn add @larabug/browser
```

### React

```bash
npm install @larabug/react
# or
yarn add @larabug/react
```

### Vue 3

```bash
npm install @larabug/vue
# or
yarn add @larabug/vue
```

### Inertia.js

```bash
npm install @larabug/inertia
# or
yarn add @larabug/inertia
```

## Quick Start

### Vanilla JavaScript

```javascript
import * as LaraBug from '@larabug/browser';

LaraBug.init({
  key: 'your-larabug-project-key',
  environment: 'production',
  release: '1.0.0',
});

// Manually capture an error
try {
  throw new Error('Something went wrong!');
} catch (error) {
  LaraBug.captureException(error);
}

// Capture a message
LaraBug.captureMessage('User clicked checkout button', 'info');

// Set user context
LaraBug.setUser({
  id: 1,
  email: 'user@example.com',
  name: 'John Doe',
});
```

### React

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import * as LaraBug from '@larabug/react';
import { ErrorBoundary } from '@larabug/react';
import App from './App';

// Initialize LaraBug
LaraBug.init({
  key: 'your-larabug-project-key',
  environment: 'production',
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <ErrorBoundary
    fallback={<div>Something went wrong. Please try again.</div>}
    onError={(error, errorInfo) => {
      console.log('Error caught by boundary:', error);
    }}
  >
    <App />
  </ErrorBoundary>
);
```

**With Hooks:**

```tsx
import { useLaraBugUser } from '@larabug/react';

function MyComponent() {
  const user = useAuthUser(); // Your auth hook

  // Automatically sync user with LaraBug
  useLaraBugUser(user);

  return <div>Hello {user.name}</div>;
}
```

### Vue 3

```typescript
import { createApp } from 'vue';
import { LaraBugVuePlugin } from '@larabug/vue';
import App from './App.vue';

const app = createApp(App);

app.use(LaraBugVuePlugin, {
  key: 'your-larabug-project-key',
  environment: 'production',
  attachProps: true,
  trackLifecycleHooks: false,
});

app.mount('#app');
```

**With Composables:**

```vue
<script setup>
import { useLaraBugUser, useLaraBug } from '@larabug/vue';
import { computed } from 'vue';

const user = computed(() => ({
  id: 1,
  email: 'user@example.com',
}));

// Sync user context
useLaraBugUser(user);

// Or use the client directly
const larabug = useLaraBug();
larabug.captureMessage('Component mounted');
</script>
```

### Inertia.js (with Vue)

```typescript
import { createApp, h } from 'vue';
import { createInertiaApp } from '@inertiajs/vue3';
import * as LaraBug from '@larabug/browser';
import { LaraBugVuePlugin } from '@larabug/vue';
import { createInertiaLaraBugPlugin, setUserFromInertia } from '@larabug/inertia';

// Initialize LaraBug first
LaraBug.init({
  key: 'your-larabug-project-key',
  environment: import.meta.env.MODE,
});

createInertiaApp({
  resolve: (name) => {
    const pages = import.meta.glob('./Pages/**/*.vue', { eager: true });
    return pages[`./Pages/${name}.vue`];
  },
  setup({ el, App, props, plugin }) {
    const app = createApp({ render: () => h(App, props) });
    
    app.use(plugin);
    app.use(LaraBugVuePlugin, {
      key: 'your-larabug-project-key',
      environment: import.meta.env.MODE,
    });
    app.use(createInertiaLaraBugPlugin({
      trackPageVisits: true,
      trackErrors: true,
    }));

    // Set user from Inertia props
    if (props.initialPage.props.auth?.user) {
      setUserFromInertia(props.initialPage.props.auth.user);
    }

    app.mount(el);
  },
});
```

### Inertia.js (with React)

```tsx
import { createRoot } from 'react-dom/client';
import { createInertiaApp } from '@inertiajs/react';
import * as LaraBug from '@larabug/react';
import { ErrorBoundary } from '@larabug/react';
import { createInertiaLaraBugPlugin } from '@larabug/inertia';

// Initialize LaraBug
LaraBug.init({
  key: 'your-larabug-project-key',
  environment: import.meta.env.MODE,
});

createInertiaApp({
  resolve: (name) => {
    const pages = import.meta.glob('./Pages/**/*.tsx', { eager: true });
    return pages[`./Pages/${name}.tsx`];
  },
  setup({ el, App, props }) {
    createRoot(el).render(
      <ErrorBoundary>
        <App {...props} />
      </ErrorBoundary>
    );
  },
});
```

## Configuration Options

```typescript
interface LaraBugOptions {
  /** Your LaraBug project key (required) */
  key: string;

  /** API endpoint (defaults to https://api.larabug.com) */
  endpoint?: string;

  /** Release version for tracking deployments */
  release?: string;

  /** Environment name (e.g., production, staging) */
  environment?: string;

  /** Whether to report errors in the current environment */
  enabled?: boolean;

  /** Sample rate for error reporting (0.0 to 1.0) */
  sampleRate?: number;

  /** Maximum breadcrumbs to capture (default: 100) */
  maxBreadcrumbs?: number;

  /** Custom user context */
  user?: {
    id?: string | number;
    email?: string;
    name?: string;
    [key: string]: any;
  };

  /** Additional context data */
  context?: Record<string, any>;

  /** Error filtering callback */
  beforeSend?: (event: ErrorEvent) => ErrorEvent | null;

  /** Transport options */
  transport?: {
    timeout?: number;
    retries?: number;
    headers?: Record<string, string>;
  };
}
```

## Advanced Usage

### Custom Context

```javascript
import * as LaraBug from '@larabug/browser';

// Add custom context
LaraBug.setContext('checkout', {
  cart_total: 99.99,
  items_count: 3,
});

// Add tags
LaraBug.setTag('page', 'checkout');
LaraBug.setTag('experiment', 'new-ui-v2');
```

### Filtering Errors

```javascript
LaraBug.init({
  key: 'your-key',
  beforeSend: (event) => {
    // Don't send errors from third-party scripts
    if (event.exception?.stacktrace?.some(frame => 
      frame.filename?.includes('third-party.js')
    )) {
      return null; // Drop the event
    }

    // Scrub sensitive data
    if (event.context?.password) {
      delete event.context.password;
    }

    return event;
  },
});
```

### Breadcrumbs

Breadcrumbs are automatically captured for:
- Navigation events
- Console logs
- Network requests (fetch & XHR)
- User interactions (coming soon)

You can also add custom breadcrumbs:

```javascript
LaraBug.getCurrentClient()?.addBreadcrumb({
  type: 'user',
  category: 'auth',
  message: 'User logged in',
  level: 'info',
  data: {
    user_id: 123,
  },
});
```

## Laravel Integration

For seamless integration with Laravel, combine the JavaScript SDK with the [LaraBug PHP package](https://github.com/LaraBug/larabug):

**Backend (PHP):**
```php
// config/larabug.php
return [
    'key' => env('LARABUG_KEY'),
    'environments' => ['production', 'staging'],
];
```

**Frontend (JavaScript):**
```javascript
// Share the same project key
LaraBug.init({
  key: import.meta.env.VITE_LARABUG_KEY,
  environment: import.meta.env.MODE,
});
```

This gives you full-stack error tracking with correlated frontend and backend errors.

## Development

### Setup

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Watch mode (auto-rebuild on changes)
npm run build:watch

# Run linter
npm run lint

# Run tests
npm run test
```

### Project Structure

```
larabug-javascript/
├── packages/
│   ├── core/          # Core types and base client
│   ├── browser/       # Browser SDK with auto-instrumentation
│   ├── react/         # React integration
│   ├── vue/           # Vue 3 integration
│   └── inertia/       # Inertia.js plugin
├── package.json       # Root package
├── lerna.json         # Lerna config
└── tsconfig.json      # TypeScript config
```

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)
- IE 11+ (with polyfills)

## License

MIT © [LaraBug](https://larabug.com)

## Links

- [Documentation](https://docs.larabug.com)
- [Website](https://larabug.com)
- [PHP Package](https://github.com/LaraBug/larabug)
- [Support](https://larabug.com/support)
