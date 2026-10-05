import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// In a plain browser during development, fake the Rust backend (see devmock.ts).
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) await import("./devmock");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
