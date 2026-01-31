import React, { Component, ReactNode, ErrorInfo } from 'react';
import { getCurrentClient } from '@larabug/browser';

export interface ErrorBoundaryProps {
  /** Fallback component to render when an error occurs */
  fallback?: ReactNode | ((error: Error, errorInfo: ErrorInfo, resetError: () => void) => ReactNode);
  
  /** Callback when an error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  
  /** Show error dialog in development */
  showDialog?: boolean;
  
  /** Custom context to attach to the error */
  context?: Record<string, any>;
  
  /** Children components */
  children: ReactNode;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * React Error Boundary component for LaraBug
 * 
 * Automatically captures React component errors and sends them to LaraBug
 * 
 * @example
 * ```tsx
 * import { ErrorBoundary } from '@larabug/react';
 * 
 * function App() {
 *   return (
 *     <ErrorBoundary fallback={<div>Something went wrong</div>}>
 *       <MyComponent />
 *     </ErrorBoundary>
 *   );
 * }
 * ```
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const { onError, context } = this.props;

    // Update state with error info
    this.setState({ errorInfo });

    // Call custom error handler
    if (onError) {
      onError(error, errorInfo);
    }

    // Send to LaraBug
    const client = getCurrentClient();
    if (client) {
      client.captureException(error, {
        mechanism: 'react-error-boundary',
        componentStack: errorInfo.componentStack,
        ...context,
      });
    }
  }

  resetError = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render(): ReactNode {
    const { hasError, error, errorInfo } = this.state;
    const { fallback, showDialog = false, children } = this.props;

    if (hasError && error) {
      // Render custom fallback
      if (typeof fallback === 'function') {
        return fallback(error, errorInfo!, this.resetError);
      }

      if (fallback) {
        return fallback;
      }

      // Default fallback UI
      if (showDialog || process.env.NODE_ENV === 'development') {
        return (
          <div style={{ padding: '20px', fontFamily: 'monospace' }}>
            <h2 style={{ color: '#d32f2f' }}>Something went wrong</h2>
            <details style={{ whiteSpace: 'pre-wrap', marginTop: '10px' }}>
              <summary style={{ cursor: 'pointer', marginBottom: '10px' }}>
                Click to see error details
              </summary>
              <p style={{ color: '#d32f2f' }}>
                <strong>{error.name}:</strong> {error.message}
              </p>
              {error.stack && (
                <pre style={{ 
                  background: '#f5f5f5', 
                  padding: '10px', 
                  overflow: 'auto',
                  fontSize: '12px',
                }}>
                  {error.stack}
                </pre>
              )}
              {errorInfo && errorInfo.componentStack && (
                <div>
                  <strong>Component Stack:</strong>
                  <pre style={{ 
                    background: '#f5f5f5', 
                    padding: '10px', 
                    overflow: 'auto',
                    fontSize: '12px',
                  }}>
                    {errorInfo.componentStack}
                  </pre>
                </div>
              )}
              <button
                onClick={this.resetError}
                style={{
                  marginTop: '10px',
                  padding: '8px 16px',
                  background: '#1976d2',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Try again
              </button>
            </details>
          </div>
        );
      }

      return null;
    }

    return children;
  }
}
