import "@fontsource/source-sans-3/400.css";
import "@fontsource/source-sans-3/600.css";
import "@fontsource/source-sans-3/700.css";
import "@fontsource/source-sans-3/900.css";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./design-system/tokens.css";
import "./design-system/components.css";
import "./styles.css";

createRoot(document.getElementById("root")).render(<App />);
