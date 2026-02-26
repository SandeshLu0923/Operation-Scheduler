import { Component } from "react";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Error caught by boundary:", error, errorInfo);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <section className="card" style={{ maxWidth: "600px", margin: "2rem auto" }}>
          <h2>⚠️ Something went wrong</h2>
          <p className="muted">The application encountered an unexpected error.</p>
          <details style={{ marginBottom: "1rem" }}>
            <summary style={{ cursor: "pointer", color: "#e34b4b" }}>
              Error Details
            </summary>
            <pre style={{
              background: "rgba(0,0,0,0.3)",
              padding: "0.8rem",
              borderRadius: "6px",
              overflow: "auto",
              fontSize: "12px",
              marginTop: "0.5rem"
            }}>
              {this.state.error?.toString()}
            </pre>
          </details>
          <button onClick={this.reset}>
            Try Again
          </button>
          <button onClick={() => window.location.href = "/"} style={{ marginLeft: "0.5rem" }}>
            Go to Home
          </button>
        </section>
      );
    }

    return this.props.children;
  }
}
