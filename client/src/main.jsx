import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { AuthProvider } from "./auth/AuthProvider.jsx";
import { greetConsole } from "./consoleGreeting.js";
import { wakeServer } from "./api/wake.js";
import "./index.css";

greetConsole();
// Start a sleeping API server now, while the visitor reads or signs in.
wakeServer(import.meta.env.VITE_API_BASE_URL || "");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
