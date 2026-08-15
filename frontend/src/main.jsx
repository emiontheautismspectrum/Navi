import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import Landing from "./Landing.jsx";
import Chat from "./Chat.jsx";
import "./index.css";

function Root() {
  // Хеш-роутинг: работает на статическом хостинге без серверных правил
  const [route, setRoute] = useState(() => (location.hash === "#/app" ? "app" : "landing"));
  const [lang, setLang] = useState("ru");
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    const onHash = () => setRoute(location.hash === "#/app" ? "app" : "landing");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dataset.theme = theme;
    document.body.dataset.theme = theme;
  }, [lang, theme]);

  const go = (r) => { location.hash = r === "app" ? "#/app" : "#/"; setRoute(r); };

  const shared = { lang, setLang, theme, setTheme };

  return (
    <div data-theme={theme} data-agent="student" style={{ height: "100%" }}>
      <div className="bg" />
      <div className="grain" />
      {route === "app"
        ? <Chat {...shared} onHome={() => go("landing")} />
        : <Landing {...shared} onEnter={() => go("app")} />}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<StrictMode><Root /></StrictMode>);
