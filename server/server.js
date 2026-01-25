const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// -----------------------------
// NEW: Community Apps Folder
// -----------------------------
const APPS_DIR = path.join(__dirname, "../public/apps");
const USER_CONFIG_FILE = path.join(__dirname, "userConfig.json");

// -----------------------------
// Existing Directories
// -----------------------------
const SOFTWARE_DIR = path.join(__dirname, "uploads");
const OS_FILE = path.join(__dirname, "os", "FrutigerAeroOS.exe");

// Generate SHA256 for file
function sha256File(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash("sha256");
  hashSum.update(fileBuffer);
  return hashSum.digest("hex");
}

// Ensure user config exists
function ensureUserConfig() {
  if (!fs.existsSync(USER_CONFIG_FILE)) {
    fs.writeFileSync(
      USER_CONFIG_FILE,
      JSON.stringify({ installedApps: {} }, null, 2)
    );
  }
}

// Read user config
function readUserConfig() {
  ensureUserConfig();
  return JSON.parse(fs.readFileSync(USER_CONFIG_FILE, "utf8"));
}

// Save user config
function saveUserConfig(config) {
  fs.writeFileSync(USER_CONFIG_FILE, JSON.stringify(config, null, 2));
}

// API - list software
app.get("/api/software", (req, res) => {
  const files = fs.readdirSync(SOFTWARE_DIR);
  const software = files.map((file) => {
    const fullPath = path.join(SOFTWARE_DIR, file);
    const stats = fs.statSync(fullPath);
    const sha = sha256File(fullPath);

    return {
      file,
      name: path.parse(file).name,
      version: "1.0.0",
      size: `${Math.round(stats.size / 1024 / 1024)} MB`,
      sha,
      icon: "⬇️",
    };
  });

  res.json(software);
});

// -----------------------------
// NEW: API - list community apps
// -----------------------------
app.get("/api/apps", (req, res) => {
  const folders = fs.readdirSync(APPS_DIR).filter((f) => {
    return fs.statSync(path.join(APPS_DIR, f)).isDirectory();
  });

  const apps = folders.map((folder) => {
    const propsPath = path.join(APPS_DIR, folder, `${folder}.properties`);

    const props = fs.existsSync(propsPath)
      ? JSON.parse(fs.readFileSync(propsPath, "utf8"))
      : {};

    return {
      name: folder,
      rules: props.rules || {
        maxInstances: 1,
        stack: false,
        resizable: true,
        minimize: true,
        maximize: true,
        taskbarIcon: false
      },
      icon: props.icon || "⬇️",
      title: props.title || folder
    };
  });

  res.json(apps);
});

// -----------------------------
// NEW: API - get user config
// -----------------------------
app.get("/api/user-config", (req, res) => {
  res.json(readUserConfig());
});

// -----------------------------
// NEW: API - install app
// -----------------------------
app.post("/api/install", (req, res) => {
  const { appId, addedTo } = req.body;
  const config = readUserConfig();

  config.installedApps[appId] = {
    installed: true,
    addedTo,
    asked: true
  };

  saveUserConfig(config);
  res.json({ success: true });
});

// -----------------------------
// NEW: API - update install location
// -----------------------------
app.post("/api/update", (req, res) => {
  const { appId, addedTo } = req.body;
  const config = readUserConfig();

  if (!config.installedApps[appId]) {
    return res.status(400).json({ error: "App not installed" });
  }

  config.installedApps[appId].addedTo = addedTo;
  saveUserConfig(config);
  res.json({ success: true });
});

// -----------------------------
// API - list js files in app
// -----------------------------
app.get("/api/apps/:appname", (req, res) => {
  const appname = req.params.appname;
  const appDir = path.join(APPS_DIR, appname);

  if (!fs.existsSync(appDir)) {
    return res.status(404).json({ error: "App not found" });
  }

  fs.readdir(appDir, (err, files) => {
    if (err) return res.status(500).json({ error: "Error reading directory" });
    const jsFiles = files.filter(f => f.endsWith('.js'));
    res.json(jsFiles);
  });
});

// NEW: Serve apps static files (CORRECTED)
app.use("/apps", express.static(APPS_DIR));

// Download OS
app.get("/apps/os", (req, res) => {
  res.download(OS_FILE);
});

// Download software
app.get("/apps/software/:file", (req, res) => {
  const file = req.params.file;
  const fullPath = path.join(SOFTWARE_DIR, file);
  res.download(fullPath);
});


// fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
