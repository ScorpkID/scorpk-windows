import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import Overlay from "./ui/Overlay";

// La misma app sirve a dos ventanas: la principal y el overlay (?view=overlay, ver tauri.conf.json).
const isOverlay = new URLSearchParams(window.location.search).get("view") === "overlay";
if (isOverlay) document.documentElement.classList.add("overlay");

createRoot(document.getElementById("root")!).render(<StrictMode>{isOverlay ? <Overlay /> : <App />}</StrictMode>);
