import { Component } from "react";
import { STORAGE_KEY } from "../constants.js";
import Icon from "./Icon.jsx";

/**
 * Catches render/lifecycle errors anywhere below it so one broken screen shows a
 * recoverable message instead of a blank page.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[ui] render error:", error, info?.componentStack);
  }

  handleReset = () => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    this.setState({ error: null });
    // A hard reload is the safest way back to a known-good state.
    window.location.assign(window.location.pathname);
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="app-shell">
        <div className="error-banner" role="alert">
          <Icon name="alert" />
          <span>Something broke while showing this page. Your saved interviews are safe.</span>
          <button className="btn-ghost" onClick={this.handleReset}>
            Reload and start over
          </button>
        </div>
      </div>
    );
  }
}
