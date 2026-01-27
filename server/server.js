const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// ==============================
// PATHS
// ==============================
const PUBLIC_DIR = path.join(__dirname, "../public");
const APPS_DIR = path.join(PUBLIC_DIR, "apps");
const SOFTWARE_DIR = path.join(__dirname, "uploads");
const USER_CONFIG_FILE = path.join(__dirname, "userConfig.json");
const STATE_FILE = path.join(__dirname, "desktopState.json");
const OS_FILE = path.join(__dirname, "os", "FrutigerAeroOS.exe");

// ==============================
// MIDDLEWARE
// ==============================
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// ==============================
// HELPERS
// ==============================
function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function ensureFile(file, defaultValue) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaultValue, null, 2));
  }
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

// ==============================
// BOOTSTRAP FILES
// ==============================
ensureFile(USER_CONFIG_FILE, { installedApps: {} });
ensureFile(STATE_FILE, { windows: [], zIndexCounter: 1 });

// ==============================
// API: SOFTWARE LIST
// ==============================
app.get("/api/software", (req, res) => {
  if (!fs.existsSync(SOFTWARE_DIR)) return res.json([]);

  const files = fs.readdirSync(SOFTWARE_DIR);
  res.json(
    files.map(file => {
      const fullPath = path.join(SOFTWARE_DIR, file);
      const stats = fs.statSync(fullPath);
      return {
        file,
        name: path.parse(file).name,
        version: "1.0.0",
        size: `${Math.round(stats.size / 1024 / 1024)} MB`,
        sha: sha256File(fullPath),
        icon: "⬇️"
      };
    })
  );
});

// ==============================
// API: COMMUNITY APPS
// ==============================
app.get("/api/apps", (req, res) => {
  if (!fs.existsSync(APPS_DIR)) return res.json([]);

  const DEFAULT_RULES = {
    maxInstances: 1,
    stack: false,
    resizable: true,
    minimize: true,
    maximize: true,
    taskbarIcon: false,
    addToTaskbar: false
  };

  const apps = fs.readdirSync(APPS_DIR)
    .filter(name => fs.statSync(path.join(APPS_DIR, name)).isDirectory())
    .map(name => {
      const propsPath = path.join(APPS_DIR, name, "app.properties.json");
      const rules = fs.existsSync(propsPath)
        ? { ...DEFAULT_RULES, ...readJSON(propsPath, {}) }
        : DEFAULT_RULES;

      return { name, rules };
    });

  res.json(apps);
});

// ==============================
// API: USER CONFIG
// ==============================
app.get("/api/user-config", (req, res) => {
  res.json(readJSON(USER_CONFIG_FILE, { installedApps: {} }));
});

app.post("/api/install", (req, res) => {
  const { appId, addedTo } = req.body;
  const config = readJSON(USER_CONFIG_FILE, { installedApps: {} });

  config.installedApps[appId] = {
    installed: true,
    addedTo,
    asked: true
  };

  fs.writeFileSync(USER_CONFIG_FILE, JSON.stringify(config, null, 2));
  res.json({ success: true });
});

// ==============================
// API: DESKTOP STATE
// ==============================
app.post("/api/save-state", (req, res) => {
  fs.writeFileSync(STATE_FILE, JSON.stringify(req.body, null, 2));
  res.json({ success: true });
});

app.get("/api/load-state", (req, res) => {
  res.json(readJSON(STATE_FILE, { windows: [], zIndexCounter: 1 }));
});

// ==============================
// API: APP JS FILES
// ==============================
app.get("/api/apps/:appname", (req, res) => {
  const appDir = path.join(APPS_DIR, req.params.appname);
  if (!fs.existsSync(appDir)) {
    return res.status(404).json({ error: "App not found" });
  }

  const jsFiles = fs.readdirSync(appDir).filter(f => f.endsWith(".js"));
  res.json(jsFiles);
});

// ==============================
// DOWNLOADS
// ==============================
app.get("/apps/os", (req, res) => {
  res.download(OS_FILE);
});

app.get("/download/software/:file", (req, res) => {
  res.download(path.join(SOFTWARE_DIR, req.params.file));
});

// ==============================
// FALLBACK (SPA ROUTING)
// ==============================
app.get("*", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// ==============================
// START SERVER
// ==============================
app.listen(PORT, () => {
  console.log(`🚀 FrutigerLinux WEB-OS running at http://localhost:${PORT}`);
});
