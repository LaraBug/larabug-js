import { getCurrentClient } from '@larabug/browser';

export { ErrorBoundary } from './ErrorBoundary';
export { useLaraBugUser, useLaraBugContext, useLaraBugTag } from './hooks';
export * from '@larabug/browser';

// Automatically tag errors as React
const client = getCurrentClient();
if (client) {
  client.setTag('framework', 'react');
}
